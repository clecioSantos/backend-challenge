import { CurrencyMismatchError, InsufficientFundsError, InvalidMoneyError } from '../shared/errors';
import type { Money } from '../shared/money';
import { LedgerDirection } from './ledger-direction';
import { WalletLedgerEntry } from './wallet-ledger-entry';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  at: Date;
}

/**
 * Wallet aggregate root.
 *
 * Invariants enforced here:
 *  - a wallet is single-currency; every movement must match it;
 *  - the balance is never negative;
 *  - every balance change produces exactly one ledger entry;
 *  - `version` starts at 1 and only advances when the balance changes.
 *
 * The aggregate deliberately knows nothing about `playerId + currency`
 * uniqueness: that is a cross-aggregate invariant owned by the database
 * (unique index) and surfaced by the repository as a conflict.
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError('initial balance must not be negative', props.initialBalance.toString());
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.at,
      props.at,
    );
  }

  /** Rebuilds a persisted wallet without re-running business validation. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  credit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidMoneyError('credit amount must be strictly positive', money.toString());
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = at;

    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });
  }

  debit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertSameCurrency(money);
    if (!money.isPositive()) {
      throw new InvalidMoneyError('debit amount must be strictly positive', money.toString());
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);

    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(this.id, balanceBefore.toString(), money.toString());
    }

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = at;

    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: at,
    });
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
