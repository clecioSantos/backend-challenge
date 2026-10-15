import { InvalidLedgerEntryError } from '../shared/errors';
import { newId } from '../shared/identifier';
import type { Money } from '../shared/money';
import { LedgerDirection } from './ledger-direction';

export interface CreateLedgerEntryProps {
  /** Optional so the aggregate can mint the identifier; tests may pin it. */
  id?: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/**
 * Append-only ledger record. Immutability is structural: there are no setters
 * and no transition methods, and the persistence layer enforces it at the
 * schema level (the row cannot be updated or deleted).
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError('money must be strictly positive');
    }
    if (props.balanceBefore.isNegative() || props.balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError('balances must not be negative');
    }
    if (
      props.money.currency !== props.balanceBefore.currency ||
      props.balanceBefore.currency !== props.balanceAfter.currency
    ) {
      throw new InvalidLedgerEntryError('money, balanceBefore and balanceAfter must share a currency');
    }

    const entry = new WalletLedgerEntry(
      props.id ?? newId(),
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError(
        `${props.balanceBefore} ${props.direction === LedgerDirection.Debit ? '-' : '+'} ${props.money} != ${props.balanceAfter}`,
      );
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /** `balanceBefore ± money === balanceAfter` for the recorded direction. */
  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Debit
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expected.equals(this.balanceAfter);
  }
}
