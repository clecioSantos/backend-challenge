import type { FailureCode } from '../../../domain/shared/failure-code';
import { Money } from '../../../domain/shared/money';
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from '../../../domain/wager-transaction/wager-transaction';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export const WagerTransactionMapper = {
  toDomain(entity: WagerTransactionEntity): WagerTransaction {
    const balanceAfter =
      entity.balanceAfter !== null && entity.balanceAfter !== undefined
        ? Money.from({
            amount: entity.balanceAfter,
            currency: entity.balanceAfterCurrency ?? entity.currency,
          })
        : undefined;

    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from({ amount: entity.amount, currency: entity.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
      createdAt: entity.createdAt,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId ?? undefined,
      failureCode: (entity.failureCode ?? undefined) as FailureCode | undefined,
      balanceAfter,
      processedAt: entity.processedAt ?? undefined,
      referenceAttempts: entity.referenceAttempts,
      nextReferenceAttemptAt: entity.nextReferenceAttemptAt ?? undefined,
    });
  },

  toNewEntity(transaction: WagerTransaction): WagerTransactionEntity {
    return WagerTransactionMapper.apply(transaction, new WagerTransactionEntity());
  },

  apply(transaction: WagerTransaction, entity: WagerTransactionEntity): WagerTransactionEntity {
    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.walletId = transaction.walletId;
    entity.playerId = transaction.playerId;
    entity.externalTransactionId = transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;
    entity.kind = transaction.kind;
    entity.amount = transaction.money.toString();
    entity.currency = transaction.money.currency;
    entity.referenceExternalTransactionId = transaction.referenceExternalTransactionId ?? null;
    entity.referenceTransactionId = transaction.referenceTransactionId ?? null;
    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode ?? null;
    entity.balanceAfter = transaction.balanceAfter?.toString() ?? null;
    entity.balanceAfterCurrency = transaction.balanceAfter?.currency ?? null;
    entity.referenceAttempts = transaction.referenceAttempts;
    entity.nextReferenceAttemptAt = transaction.nextReferenceAttemptAt ?? null;
    entity.createdAt = transaction.createdAt;
    entity.processedAt = transaction.processedAt ?? null;
    return entity;
  },
};
