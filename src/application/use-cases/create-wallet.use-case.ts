import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.event';
import { OutboxMessage } from '../../domain/outbox/outbox-message';
import { WalletAlreadyExistsError } from '../../domain/shared/errors';
import { newId } from '../../domain/shared/identifier';
import { Money, type MoneyProps } from '../../domain/shared/money';
import { LedgerDirection } from '../../domain/wallet/ledger-direction';
import { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry';
import { Wallet } from '../../domain/wallet/wallet';
import { WagerTransaction, WagerTransactionKind } from '../../domain/wager-transaction/wager-transaction';
import { hashWagerPayload } from '../crypto/canonical-json';
import type { Clock } from '../../domain/shared/clock.port';
import type { UnitOfWork } from '../ports/unit-of-work.port';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
}

/**
 * Opens a wallet. When the initial balance is positive it also records an
 * internal `OPENING` transaction and its `CREDIT` ledger entry **in the same
 * SQL transaction**, so the materialized balance can always be rebuilt from the
 * ledger. The wallet keeps `version = 1`, as defined by the aggregate.
 */
export class CreateWalletUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const at = this.clock.now();
    const initialBalance = Money.from(command.initialBalance);

    return this.uow.run(async (tx) => {
      const existing = await tx.wallets.findByPlayerAndCurrency(command.playerId, initialBalance.currency);
      if (existing) {
        throw new WalletAlreadyExistsError(command.playerId, initialBalance.currency);
      }

      const wallet = Wallet.open({
        id: newId(),
        playerId: command.playerId,
        initialBalance,
        at,
      });

      await tx.wallets.insert(wallet);

      if (initialBalance.isPositive()) {
        const opening = WagerTransaction.opening({
          id: newId(),
          providerId: 'internal',
          externalTransactionId: `opening:${wallet.id}`,
          idempotencyKey: `internal:opening:${wallet.id}`,
          payloadHash: hashWagerPayload({
            providerId: 'internal',
            externalTransactionId: `opening:${wallet.id}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'opening',
            gameId: 'opening',
            kind: WagerTransactionKind.Opening,
            money: initialBalance.toJSON(),
          }),
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: 'opening',
          gameId: 'opening',
          kind: WagerTransactionKind.Opening,
          money: initialBalance,
          createdAt: at,
        });

        await tx.wagerTransactions.insert(opening);

        const entry = WalletLedgerEntry.create({
          walletId: wallet.id,
          transactionId: opening.id,
          direction: LedgerDirection.Credit,
          money: initialBalance,
          balanceBefore: Money.zero(initialBalance.currency),
          balanceAfter: initialBalance,
          createdAt: at,
        });
        await tx.ledger.insert(entry);

        opening.markProcessed(undefined, initialBalance, at);
        await tx.wagerTransactions.save(opening);

        const ctx = { correlationId: `wallet:${wallet.id}`, causationId: opening.id };
        await tx.outbox.insert(
          OutboxMessage.enqueue(
            WagerTransactionProcessed.from({
              transaction: opening,
              balanceAfter: initialBalance,
              walletVersion: wallet.version,
              ctx,
            }),
          ),
        );
        await tx.outbox.insert(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, ctx)));
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance,
        version: wallet.version,
        createdAt: wallet.createdAt,
      };
    });
  }
}
