import { WagerTransactionNotFoundError } from '../../domain/shared/errors';
import type { FailureCode } from '../../domain/shared/failure-code';
import type { Money } from '../../domain/shared/money';
import type {
  WagerTransactionStatus} from '../../domain/wager-transaction/wager-transaction';
import {
  type WagerTransactionKind
} from '../../domain/wager-transaction/wager-transaction';
import type { UnitOfWork } from '../ports/unit-of-work.port';

export interface WagerTransactionView {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  money: Money;
  referenceTransactionId: string | undefined;
  referenceExternalTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  balanceAfter: Money | undefined;
  createdAt: Date;
  processedAt: Date | undefined;
}

function toView(transaction: {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  money: Money;
  referenceTransactionId: string | undefined;
  referenceExternalTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  balanceAfter: Money | undefined;
  createdAt: Date;
  processedAt: Date | undefined;
}): WagerTransactionView {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    status: transaction.status,
    money: transaction.money,
    referenceTransactionId: transaction.referenceTransactionId,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    failureCode: transaction.failureCode,
    balanceAfter: transaction.balanceAfter,
    createdAt: transaction.createdAt,
    processedAt: transaction.processedAt,
  };
}

export class GetWagerTransactionUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(transactionId: string): Promise<WagerTransactionView> {
    return this.uow.read(async (tx) => {
      const transaction = await tx.wagerTransactions.findById(transactionId);
      if (!transaction) {
        throw new WagerTransactionNotFoundError(transactionId);
      }
      return toView(transaction);
    });
  }
}

export class GetProviderWagerTransactionUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(providerId: string, externalTransactionId: string): Promise<WagerTransactionView> {
    return this.uow.read(async (tx) => {
      const transaction = await tx.wagerTransactions.findByProviderAndExternalId(
        providerId,
        externalTransactionId,
      );
      if (!transaction) {
        throw new WagerTransactionNotFoundError(externalTransactionId);
      }
      return toView(transaction);
    });
  }
}
