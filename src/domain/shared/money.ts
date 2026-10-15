import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors';

// The whole service works with exact decimals. `Decimal` is configured once,
// at module load, so every instance shares the same precision and rounding
// policy. 2-decimal inputs never round, but the policy still protects against
// accidental higher-precision arithmetic.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

/** Wire/DTO representation. Money is serialized as a decimal string. */
export interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_PATTERN = /^\d{1,18}(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Immutable value object for monetary amounts.
 *
 * Contract:
 *  - `amount` is a decimal string with a fixed scale of 2 (`"25.00"`);
 *  - negative values are rejected on input; arithmetic may still produce them
 *    internally (e.g. `subtract`) so callers can compare against zero;
 *  - all binary operations require matching currencies;
 *  - the type never depends on ORM or framework primitives.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (typeof props.currency !== 'string' || !CURRENCY_PATTERN.test(props.currency)) {
      throw new InvalidMoneyError('currency must be an ISO-4217 alpha-3 code', props.currency);
    }

    if (typeof props.amount !== 'string' || props.amount.length === 0) {
      throw new InvalidMoneyError('amount must be a non-empty decimal string', props.amount);
    }

    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyError(
        'amount must be a positive decimal with at most 2 fraction digits (no sign, no exponent)',
        props.amount,
      );
    }

    return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError('currency must be an ISO-4217 alpha-3 code', currency);
    }
    return new Money(new Decimal(0), currency);
  }

  /**
   * Trusted, internal-only factory for values that may legitimately be signed
   * (e.g. a reconciliation difference or a ledger-derived balance). It still
   * validates currency and finiteness but skips the positive-only input rule.
   */
  static fromTrusted(amount: string, currency: string): Money {
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError('currency must be an ISO-4217 alpha-3 code', currency);
    }

    let value: Decimal;
    try {
      value = new Decimal(amount);
    } catch {
      throw new InvalidMoneyError('amount is not a valid decimal', amount);
    }

    if (!value.isFinite()) {
      throw new InvalidMoneyError('amount must be finite', amount);
    }

    return new Money(value, currency);
  }

  /**
   * Internal constructor used by arithmetic. Keeps the sign so intermediate
   * results can be negative; re-validated on the way back into the system.
   */
  private static of(value: Decimal, currency: string): Money {
    return new Money(value, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return Money.of(this.value.negated(), this.currency);
  }

  absolute(): Money {
    return Money.of(this.value.abs(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isLessThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  greaterThanOrEqualTo(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
