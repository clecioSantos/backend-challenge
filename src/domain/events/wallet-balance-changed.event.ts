import { newId } from '../shared/identifier';
import type { MoneyProps } from '../shared/money';
import type { Wallet } from '../wallet/wallet';
import type { LedgerDirection } from '../wallet/ledger-direction';
import type { WalletLedgerEntry } from '../wallet/wallet-ledger-entry';
import { IntegrationEvent, type EventContext } from './integration-event';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/**
 * Emitted exactly once per ledger entry — i.e. only when the balance actually
 * changes. Balance-neutral outcomes (`LOSS`) never produce this event.
 */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: newId(),
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: entry.createdAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}
