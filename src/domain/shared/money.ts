import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors';

// Todo o serviço trabalha com decimais exatos. O `Decimal` é configurado uma
// única vez, no carregamento do módulo, para que toda instância compartilhe a
// mesma precisão e política de arredondamento. Entradas com 2 casas decimais
// nunca arredondam, mas a política ainda protege contra aritmética acidental
// de precisão maior.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

/** Representação wire/DTO. Money é serializado como uma string decimal. */
export interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_PATTERN = /^\d{1,18}(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Value object imutável para valores monetários.
 *
 * Contrato:
 *  - `amount` é uma string decimal com escala fixa de 2 (`"25.00"`);
 *  - valores negativos são rejeitados na entrada; a aritmética ainda pode
 *    produzi-los internamente (ex.: `subtract`) para que os chamadores possam
 *    comparar com zero;
 *  - todas as operações binárias exigem moedas correspondentes;
 *  - o tipo nunca depende de primitivas de ORM ou framework.
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
   * Factory confiável, apenas interna, para valores que podem legitimamente ter
   * sinal (ex.: uma diferença de conciliação ou um saldo derivado do ledger).
   * Ela ainda valida moeda e finitude, mas ignora a regra de entrada apenas
   * positiva.
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
   * Construtor interno usado pela aritmética. Mantém o sinal para que
   * resultados intermediários possam ser negativos; revalidado no caminho de
   * volta para dentro do sistema.
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
