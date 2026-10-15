import { newId } from '../shared/identifier';
import type { MoneyProps } from '../shared/money';
import type { WagerTransaction, WagerTransactionKind } from '../wager-transaction/wager-transaction';
import { IntegrationEvent, type EventContext } from './integration-event';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

/** Emitido quando uma reversão chega antes da transação que ela referencia. */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    if (transaction.referenceExternalTransactionId === undefined) {
      throw new Error('WagerTransactionPendingReference requires a referenceExternalTransactionId');
    }

    return new WagerTransactionPendingReference({
      eventId: newId(),
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: transaction.createdAt,
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}
