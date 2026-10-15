import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/shared/errors';
import { Money } from '../../src/domain/shared/money';

describe('Money', () => {
  describe('construction and scale', () => {
    it('normalises amounts to a fixed scale of 2', () => {
      expect(Money.from({ amount: '25', currency: 'BRL' }).toString()).toBe('25.00');
      expect(Money.from({ amount: '25.5', currency: 'BRL' }).toString()).toBe('25.50');
      expect(Money.from({ amount: '1000.00', currency: 'BRL' }).toString()).toBe('1000.00');
      expect(Money.from({ amount: '0.05', currency: 'BRL' }).toString()).toBe('0.05');
    });

    it('serialises with an exact decimal string', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    });

    it('rejects empty, signed, exponent, fractional or malformed amounts', () => {
      const invalid = ['', '  ', '-1.00', '+1.00', '1e3', '1.234', '.50', '25.', 'NaN', 'Infinity', '0x10'];
      for (const amount of invalid) {
        expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyError);
      }
    });

    it('rejects amounts wider than the persistence column', () => {
      expect(() => Money.from({ amount: '1234567890123456789', currency: 'BRL' })).toThrow(InvalidMoneyError);
    });

    it('rejects non ISO-4217 currencies', () => {
      expect(() => Money.from({ amount: '1.00', currency: 'reais' })).toThrow(InvalidMoneyError);
      expect(() => Money.from({ amount: '1.00', currency: 'BR' })).toThrow(InvalidMoneyError);
      expect(() => Money.from({ amount: '1.00', currency: '' })).toThrow(InvalidMoneyError);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts without floating point drift', () => {
      const a = Money.from({ amount: '0.10', currency: 'BRL' });
      const b = Money.from({ amount: '0.20', currency: 'BRL' });
      expect(a.add(b).toString()).toBe('0.30');

      const total = Money.from({ amount: '100.00', currency: 'BRL' });
      expect(total.subtract(Money.from({ amount: '80.00', currency: 'BRL' })).toString()).toBe('20.00');
    });

    it('allows negative intermediate results (e.g. over-debit detection)', () => {
      const result = Money.from({ amount: '10.00', currency: 'BRL' }).subtract(
        Money.from({ amount: '25.00', currency: 'BRL' }),
      );
      expect(result.isNegative()).toBe(true);
      expect(result.toString()).toBe('-15.00');
      expect(result.negate().toString()).toBe('15.00');
    });

    it('is immutable: operations return new instances', () => {
      const original = Money.from({ amount: '10.00', currency: 'BRL' });
      const sum = original.add(Money.from({ amount: '5.00', currency: 'BRL' }));
      expect(original.toString()).toBe('10.00');
      expect(sum.toString()).toBe('15.00');
      expect(sum.equals(original)).toBe(false);
    });

    it('rejects mixed-currency operations', () => {
      const brl = Money.from({ amount: '10.00', currency: 'BRL' });
      const usd = Money.from({ amount: '10.00', currency: 'USD' });
      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe('comparisons', () => {
    it('compares values ignoring representation padding', () => {
      const a = Money.from({ amount: '25', currency: 'BRL' });
      const b = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(a.equals(b)).toBe(true);
      expect(a.compare(b)).toBe(0);
    });

    it('reports sign and zero', () => {
      expect(Money.zero('BRL').isZero()).toBe(true);
      expect(Money.from({ amount: '0.01', currency: 'BRL' }).isPositive()).toBe(true);
      expect(Money.zero('BRL').isNegative()).toBe(false);
    });
  });
});
