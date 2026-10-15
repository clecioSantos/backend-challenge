import { newId } from '../shared/identifier';
import type { MoneyProps } from '../shared/money';
import type { Money } from '../shared/money';
import type { WagerTransaction, WagerTransactionKind } from '../wager-transaction/wager-transaction';
import { WagerTransactionStatus } from '../wager-transaction/wager-transaction';
import { IntegrationEvent, type EventContext } from './integration-event';

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  money: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
  referenceTransactionId?: string;
}

export interface ProcessedEventSource {
  transaction: WagerTransaction;
  balanceAfter: Money;
  walletVersion: number;
  ctx: EventContext;
}

/** Emitted for every applied transaction, including balance-neutral `LOSS`. */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from({ transaction, balanceAfter, walletVersion, ctx }: ProcessedEventSource): WagerTransactionProcessed {
    const data: WagerTransactionProcessedData = {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: WagerTransactionStatus.Processed,
      money: transaction.money.toJSON(),
      balanceAfter: balanceAfter.toJSON(),
      walletVersion,
    };

    if (transaction.referenceTransactionId !== undefined) {
      data.referenceTransactionId = transaction.referenceTransactionId;
    }

    return new WagerTransactionProcessed({
      eventId: newId(),
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: transaction.processedAt ?? transaction.createdAt,
      data,
    });
  }
}
