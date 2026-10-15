import type { FailureCode } from '../shared/failure-code';
import { newId } from '../shared/identifier';
import type { MoneyProps } from '../shared/money';
import type { WagerTransaction, WagerTransactionKind } from '../wager-transaction/wager-transaction';
import { IntegrationEvent, type EventContext } from './integration-event';

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
}

export interface RejectedEventSource {
  transaction: WagerTransaction;
  failureCode: FailureCode;
  ctx: EventContext;
}

/** Emitted when a transaction is rejected by a business rule. */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from({ transaction, failureCode, ctx }: RejectedEventSource): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: newId(),
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: transaction.processedAt ?? transaction.createdAt,
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        failureCode,
      },
    });
  }
}
