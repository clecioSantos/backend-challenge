import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InsufficientFundsError } from '../../src/domain/shared/errors';
import { Money } from '../../src/domain/shared/money';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction';
import { Wallet } from '../../src/domain/wallet/wallet';

const at = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-01T00:01:00.000Z');

function openWallet(balance = '1000.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from({ amount: balance, currency: 'BRL' }),
    at,
  });
}

describe('Wallet', () => {
  it('opens with the initial balance and version 1', () => {
    const wallet = openWallet('100.00');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
  });

  it('credits and records a balanced CREDIT ledger entry', () => {
    const wallet = openWallet('100.00');
    const entry = wallet.credit(Money.from({ amount: '25.00', currency: 'BRL' }), 'tx-1', later);

    expect(wallet.balance.toString()).toBe('125.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('125.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('debits and records a balanced DEBIT ledger entry', () => {
    const wallet = openWallet('100.00');
    const entry = wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }), 'tx-1', later);

    expect(wallet.balance.toString()).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
  });

  it('never allows the balance to go negative', () => {
    const wallet = openWallet('100.00');
    expect(() => wallet.debit(Money.from({ amount: '100.01', currency: 'BRL' }), 'tx-1', later)).toThrow(
      InsufficientFundsError,
    );
    // failed debit must not mutate state
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('allows debiting exactly the whole balance', () => {
    const wallet = openWallet('80.00');
    wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }), 'tx-1', later);
    expect(wallet.balance.toString()).toBe('0.00');
  });

  it('rejects movements in a different currency', () => {
    const wallet = openWallet('100.00');
    expect(() => wallet.credit(Money.from({ amount: '1.00', currency: 'USD' }), 'tx-1', later)).toThrow(
      CurrencyMismatchError,
    );
    expect(() => wallet.debit(Money.from({ amount: '1.00', currency: 'USD' }), 'tx-1', later)).toThrow(
      CurrencyMismatchError,
    );
  });

  it('rehydrates without re-running transitions', () => {
    const wallet = openWallet('100.00');
    wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }), 'tx-1', later);

    const rehydrated = Wallet.rehydrate({
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });

    expect(rehydrated.balance.toString()).toBe('70.00');
    expect(rehydrated.version).toBe(2);
    expect(rehydrated.updatedAt).toEqual(later);
  });
});
