import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event';
import { WagerTransactionPendingReference } from '../../domain/events/wager-transaction-pending-reference.event';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejected } from '../../domain/events/wager-transaction-rejected.event';
import type { EventContext } from '../../domain/events/integration-event';
import { InboxMessage } from '../../domain/inbox/inbox-message';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { FailureCode } from '../../domain/shared/failure-code';
import {
  IdempotencyConflictError,
  InfrastructureError,
  InsufficientFundsError,
  WalletNotFoundError,
} from '../../domain/shared/errors';
import type { BackoffPolicy } from '../../domain/shared/backoff';
import { newId } from '../../domain/shared/identifier';
import { Money, type MoneyProps } from '../../domain/shared/money';
import { LedgerDirection } from '../../domain/wallet/ledger-direction';
import type { Wallet } from '../../domain/wallet/wallet';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager-transaction/wager-transaction';
import { hashWagerPayload } from '../crypto/canonical-json';
import type { PendingReferenceConfig } from '../../config/env';
import type { Clock } from '../../domain/shared/clock.port';
import type { TransactionContext, UnitOfWork } from '../ports/unit-of-work.port';

export interface ProcessWagerTransactionConsumerContext {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface ProcessWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
  correlationId: string;
  causationId?: string | undefined;
  consumer?: ProcessWagerTransactionConsumerContext | undefined;
}

export type ProcessWagerTransactionOutcome =
  | {
      outcome: 'processed';
      transactionId: string;
      status: WagerTransactionStatus.Processed;
      balance: Money;
      idempotentReplay: boolean;
      referenceTransactionId?: string | undefined;
    }
  | {
      outcome: 'pending_reference';
      transactionId: string;
      status: WagerTransactionStatus.PendingReference;
      idempotentReplay: boolean;
    }
  | {
      outcome: 'rejected';
      transactionId: string;
      status: WagerTransactionStatus.Rejected;
      failureCode: FailureCode;
      idempotentReplay: boolean;
    }
  | {
      outcome: 'failed';
      transactionId: string;
      status: WagerTransactionStatus.Failed;
      failureCode: FailureCode;
      idempotentReplay: boolean;
    };

/** Terminal resume result used by the scheduled reference worker. */
export type ResumeOutcome = 'processed' | 'pending' | 'rejected' | 'ignored';

/**
 * Central application service. It is shared verbatim by the HTTP ingress and
 * the SQS consumer (challenge section 10), which guarantees both entry points
 * enforce the same domain rules and produce the same ledger effects.
 *
 * Concurrency: the wallet row is locked (`SELECT ... FOR UPDATE`) before the
 * idempotency key is inspected, so two requests carrying the same key are
 * serialised on the wallet and the loser observes the winner's committed row
 * and replays it instead of racing on the unique index.
 */
export class ProcessWagerTransactionUseCase {
  private readonly referenceBackoff: BackoffPolicy;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly pendingReference: PendingReferenceConfig,
  ) {
    this.referenceBackoff = {
      baseMs: pendingReference.baseBackoffMs,
      maxMs: pendingReference.maxBackoffMs,
    };
  }

  async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionOutcome> {
    const at = this.clock.now();
    const money = Money.from(command.money);
    const payloadHash = hashWagerPayload({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
    const ctx: EventContext = { correlationId: command.correlationId, causationId: command.causationId };

    return this.uow.run(async (tx) => {
      if (command.consumer) {
        const claimed = await tx.inbox.insertIfAbsent(
          InboxMessage.receive({
            messageId: command.consumer.messageId,
            consumerName: command.consumer.consumerName,
            payloadHash: command.consumer.payloadHash,
            receivedAt: command.consumer.receivedAt,
          }),
        );

        if (!claimed) {
          const existingInbox = await tx.inbox.find(command.consumer.consumerName, command.consumer.messageId);
          if (existingInbox?.isProcessed()) {
            const replay = await tx.wagerTransactions.findByIdempotencyKey(command.idempotencyKey);
            if (replay) {
              return this.toReplayResult(replay);
            }
            throw new InfrastructureError('Inbox marked as processed but transaction is missing', {
              retryable: true,
            });
          }
          throw new InfrastructureError('Inbox message is being processed concurrently', { retryable: true });
        }
      }

      const wallet = await tx.wallets.findByIdForUpdate(command.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(command.walletId);
      }

      const existing = await tx.wagerTransactions.findByIdempotencyKey(command.idempotencyKey);
      if (existing) {
        if (!existing.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(command.idempotencyKey, existing.id);
        }
        return this.finish(tx, command, at, this.toReplayResult(existing));
      }

      const byExternal = await tx.wagerTransactions.findByProviderAndExternalId(
        command.providerId,
        command.externalTransactionId,
      );
      if (byExternal) {
        throw new IdempotencyConflictError(command.idempotencyKey, byExternal.id);
      }

      const transaction = WagerTransaction.create({
        id: newId(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt: at,
      });

      await tx.wagerTransactions.insert(transaction);

      if (wallet.playerId !== command.playerId) {
        return this.finish(tx, command, at, await this.reject(tx, transaction, FailureCode.WalletPlayerMismatch, ctx, at));
      }
      if (wallet.currency !== money.currency) {
        return this.finish(tx, command, at, await this.reject(tx, transaction, FailureCode.WalletCurrencyMismatch, ctx, at));
      }

      let reference: WagerTransaction | undefined;
      if (transaction.requiresReference()) {
        const referenceExternalId = transaction.referenceExternalTransactionId as string;
        reference =
          (await tx.wagerTransactions.findByProviderAndExternalId(command.providerId, referenceExternalId)) ??
          undefined;

        if (!reference) {
          return this.finish(tx, command, at, await this.markPending(tx, transaction, ctx, at));
        }
        if (reference.status !== WagerTransactionStatus.Processed) {
          if (reference.status === WagerTransactionStatus.Rejected || reference.status === WagerTransactionStatus.Failed) {
            return this.finish(tx, command, at, await this.reject(tx, transaction, FailureCode.ReferenceNotProcessed, ctx, at));
          }
          return this.finish(tx, command, at, await this.markPending(tx, transaction, ctx, at));
        }

        const referenceFailure = this.validateReference(transaction, reference, wallet);
        if (referenceFailure) {
          return this.finish(tx, command, at, await this.reject(tx, transaction, referenceFailure, ctx, at));
        }

        const alreadyReversed = await this.hasReversal(tx, reference.id, transaction.kind);
        if (alreadyReversed) {
          return this.finish(tx, command, at, await this.reject(tx, transaction, FailureCode.ReferenceAlreadyReversed, ctx, at));
        }
      }

      if (!transaction.affectsBalance()) {
        transaction.markProcessed(undefined, wallet.balance, at);
        await tx.wagerTransactions.save(transaction);
        await tx.outbox.insert(
          OutboxMessage.enqueue(
            WagerTransactionProcessed.from({
              transaction,
              balanceAfter: wallet.balance,
              walletVersion: wallet.version,
              ctx,
            }),
          ),
        );
        return this.finish(tx, command, at, {
          outcome: 'processed',
          transactionId: transaction.id,
          status: WagerTransactionStatus.Processed,
          balance: wallet.balance,
          idempotentReplay: false,
        });
      }

      return this.finish(tx, command, at, await this.settle(tx, transaction, wallet, reference, ctx, at));
    });
  }

  /**
   * Re-drives a transaction parked as `PENDING_REFERENCE`. Called by the
   * scheduled worker. Each call runs in its own transaction so one failure
   * cannot block the rest of the batch.
   */
  async resume(transactionId: string): Promise<ResumeOutcome> {
    const at = this.clock.now();

    return this.uow.run(async (tx) => {
      const initial = await tx.wagerTransactions.findById(transactionId);
      if (!initial || initial.status !== WagerTransactionStatus.PendingReference) {
        return 'ignored';
      }

      const ctx: EventContext = { correlationId: `resume:${transactionId}`, causationId: transactionId };

      // Lock order is always wallet -> transaction, mirroring the ingress path.
      // Re-reading the transaction with a row lock after the wallet lock closes
      // the window where two workers could otherwise resume the same row.
      const wallet = await tx.wallets.findByIdForUpdate(initial.walletId);
      const transaction = await tx.wagerTransactions.findByIdForUpdate(transactionId);
      if (!transaction || transaction.status !== WagerTransactionStatus.PendingReference) {
        return 'ignored';
      }

      if (!wallet) {
        await this.reject(tx, transaction, FailureCode.WalletNotFound, ctx, at);
        return 'rejected';
      }

      const referenceExternalId = transaction.referenceExternalTransactionId as string;
      const reference = await tx.wagerTransactions.findByProviderAndExternalId(
        transaction.providerId,
        referenceExternalId,
      );

      if (!reference) {
        if (transaction.referenceAttempts >= this.pendingReference.maxAttempts) {
          await this.reject(tx, transaction, FailureCode.ReferenceNotFound, ctx, at);
          return 'rejected';
        }
        transaction.scheduleReferenceRetry(at, this.referenceBackoff);
        await tx.wagerTransactions.save(transaction);
        return 'pending';
      }

      if (reference.status !== WagerTransactionStatus.Processed) {
        if (reference.status === WagerTransactionStatus.Rejected || reference.status === WagerTransactionStatus.Failed) {
          await this.reject(tx, transaction, FailureCode.ReferenceNotProcessed, ctx, at);
          return 'rejected';
        }
        transaction.scheduleReferenceRetry(at, this.referenceBackoff);
        await tx.wagerTransactions.save(transaction);
        return 'pending';
      }

      const referenceFailure = this.validateReference(transaction, reference, wallet);
      if (referenceFailure) {
        await this.reject(tx, transaction, referenceFailure, ctx, at);
        return 'rejected';
      }

      if (await this.hasReversal(tx, reference.id, transaction.kind)) {
        await this.reject(tx, transaction, FailureCode.ReferenceAlreadyReversed, ctx, at);
        return 'rejected';
      }

      const outcome = await this.settle(tx, transaction, wallet, reference, ctx, at);
      return outcome.outcome === 'processed' ? 'processed' : 'rejected';
    });
  }

  // -- internals -------------------------------------------------------------

  private async finish(
    tx: TransactionContext,
    command: ProcessWagerTransactionCommand,
    at: Date,
    result: ProcessWagerTransactionOutcome,
  ): Promise<ProcessWagerTransactionOutcome> {
    if (command.consumer) {
      await tx.inbox.markProcessed(command.consumer.consumerName, command.consumer.messageId, at);
    }
    return result;
  }

  private async settle(
    tx: TransactionContext,
    transaction: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | undefined,
    ctx: EventContext,
    at: Date,
  ): Promise<ProcessWagerTransactionOutcome> {
    const previousVersion = wallet.version;
    let entry;

    try {
      const direction =
        transaction.kind === WagerTransactionKind.Rollback
          ? transaction.ledgerDirectionFor(reference)
          : transaction.ledgerDirectionFor();

      entry =
        direction === LedgerDirection.Debit
          ? wallet.debit(transaction.money, transaction.id, at)
          : wallet.credit(transaction.money, transaction.id, at);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        const code =
          transaction.kind === WagerTransactionKind.Bet
            ? FailureCode.InsufficientFunds
            : FailureCode.ReversalWouldGoNegative;
        return this.reject(tx, transaction, code, ctx, at);
      }
      throw error;
    }

    await tx.ledger.insert(entry);
    await tx.wallets.save(wallet, previousVersion);

    transaction.markProcessed(reference?.id, wallet.balance, at);
    await tx.wagerTransactions.save(transaction);

    await tx.outbox.insert(
      OutboxMessage.enqueue(
        WagerTransactionProcessed.from({
          transaction,
          balanceAfter: wallet.balance,
          walletVersion: wallet.version,
          ctx,
        }),
      ),
    );
    await tx.outbox.insert(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, ctx)));

    return {
      outcome: 'processed',
      transactionId: transaction.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance,
      idempotentReplay: false,
      referenceTransactionId: reference?.id,
    };
  }

  private async reject(
    tx: TransactionContext,
    transaction: WagerTransaction,
    code: FailureCode,
    ctx: EventContext,
    at: Date,
  ): Promise<ProcessWagerTransactionOutcome> {
    transaction.reject(code, at);
    await tx.wagerTransactions.save(transaction);
    await tx.outbox.insert(OutboxMessage.enqueue(WagerTransactionRejected.from({ transaction, failureCode: code, ctx })));

    return {
      outcome: 'rejected',
      transactionId: transaction.id,
      status: WagerTransactionStatus.Rejected,
      failureCode: code,
      idempotentReplay: false,
    };
  }

  private async markPending(
    tx: TransactionContext,
    transaction: WagerTransaction,
    ctx: EventContext,
    at: Date,
  ): Promise<ProcessWagerTransactionOutcome> {
    transaction.markPendingReference(at);
    transaction.scheduleReferenceRetry(at, this.referenceBackoff);
    await tx.wagerTransactions.save(transaction);
    await tx.outbox.insert(OutboxMessage.enqueue(WagerTransactionPendingReference.from(transaction, ctx)));

    return {
      outcome: 'pending_reference',
      transactionId: transaction.id,
      status: WagerTransactionStatus.PendingReference,
      idempotentReplay: false,
    };
  }

  private validateReference(
    transaction: WagerTransaction,
    reference: WagerTransaction,
    wallet: Wallet,
  ): FailureCode | undefined {
    if (!transaction.canReference(reference)) {
      return FailureCode.ReferenceKindNotAllowed;
    }
    if (reference.playerId !== transaction.playerId) {
      return FailureCode.ReferenceMismatch;
    }
    if (reference.walletId !== wallet.id) {
      return FailureCode.ReferenceMismatch;
    }
    if (reference.money.currency !== transaction.money.currency) {
      return FailureCode.ReferenceMismatch;
    }
    if (reference.roundId !== transaction.roundId) {
      return FailureCode.ReferenceMismatch;
    }
    if (!reference.money.equals(transaction.money)) {
      return FailureCode.ReferenceAmountMismatch;
    }
    return undefined;
  }

  private async hasReversal(
    tx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    const reversals = await tx.wagerTransactions.findReversalsOf(referenceTransactionId);
    return reversals.some(
      (reversal) => reversal.kind === kind && reversal.status === WagerTransactionStatus.Processed,
    );
  }

  private toReplayResult(transaction: WagerTransaction): ProcessWagerTransactionOutcome {
    switch (transaction.status) {
      case WagerTransactionStatus.Processed:
        return {
          outcome: 'processed',
          transactionId: transaction.id,
          status: WagerTransactionStatus.Processed,
          balance: transaction.balanceAfter ?? Money.zero(transaction.money.currency),
          idempotentReplay: true,
          referenceTransactionId: transaction.referenceTransactionId,
        };
      case WagerTransactionStatus.PendingReference:
        return {
          outcome: 'pending_reference',
          transactionId: transaction.id,
          status: WagerTransactionStatus.PendingReference,
          idempotentReplay: true,
        };
      case WagerTransactionStatus.Rejected:
        return {
          outcome: 'rejected',
          transactionId: transaction.id,
          status: WagerTransactionStatus.Rejected,
          failureCode: transaction.failureCode ?? FailureCode.InternalError,
          idempotentReplay: true,
        };
      case WagerTransactionStatus.Failed:
        return {
          outcome: 'failed',
          transactionId: transaction.id,
          status: WagerTransactionStatus.Failed,
          failureCode: transaction.failureCode ?? FailureCode.InternalError,
          idempotentReplay: true,
        };
      default:
        throw new InfrastructureError('Transaction is still pending; retry later', { retryable: true });
    }
  }
}
