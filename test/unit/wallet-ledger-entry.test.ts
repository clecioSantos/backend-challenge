import { describe, expect, it } from 'bun:test';
import { InvalidLedgerEntryError } from '../../src/domain/shared/errors';
import { Money } from '../../src/domain/shared/money';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction';
import { WalletLedgerEntry } from '../../src/domain/wallet/wallet-ledger-entry';

const at = new Date('2026-01-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('WalletLedgerEntry', () => {
  it('accepts a balanced DEBIT entry', () => {
    const entry = WalletLedgerEntry.create({
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: brl('80.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('20.00'),
      createdAt: at,
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
  });

  it('accepts a balanced CREDIT entry', () => {
    const entry = WalletLedgerEntry.create({
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Credit,
      money: brl('25.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('125.00'),
      createdAt: at,
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects entries whose arithmetic does not hold', () => {
    expect(() =>
      WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: brl('80.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('30.00'),
        createdAt: at,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rejects negative balances', () => {
    const negative = brl('20.00').subtract(brl('50.00'));
    expect(() =>
      WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Credit,
        money: brl('80.00'),
        balanceBefore: brl('50.00'),
        balanceAfter: negative,
        createdAt: at,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });
});
