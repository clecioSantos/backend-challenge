import { describe, expect, it } from 'bun:test';
import { FailureCode } from '../../src/domain/shared/failure-code';
import {
  InvalidTransactionStateError,
  ReferenceRequiredError,
  UnexpectedReferenceError,
  UnsupportedTransactionKindError,
} from '../../src/domain/shared/errors';
import { Money } from '../../src/domain/shared/money';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wager-transaction/wager-transaction';

const at = new Date('2026-01-01T00:00:00.000Z');
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

function build(kind: WagerTransactionKind, overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) {
  return WagerTransaction.create({
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl('25.00'),
    createdAt: at,
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  describe('creation', () => {
    it('is born PENDING', () => {
      const tx = build(WagerTransactionKind.Bet);
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.affectsBalance()).toBe(true);
      expect(tx.requiresReference()).toBe(false);
    });

    it('cannot be created as OPENING through the public factory', () => {
      expect(() => build(WagerTransactionKind.Opening)).toThrow(UnsupportedTransactionKindError);
    });

    it('requires a reference for REFUND and ROLLBACK', () => {
      expect(() => build(WagerTransactionKind.Refund)).toThrow(ReferenceRequiredError);
      expect(() => build(WagerTransactionKind.Rollback)).toThrow(ReferenceRequiredError);

      const refund = build(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'bet-1' });
      expect(refund.requiresReference()).toBe(true);
    });

    it('rejects references on non-reversing kinds', () => {
      expect(() => build(WagerTransactionKind.Bet, { referenceExternalTransactionId: 'bet-1' })).toThrow(
        UnexpectedReferenceError,
      );
    });

    it('rejects non-positive amounts', () => {
      expect(() => build(WagerTransactionKind.Bet, { money: Money.zero('BRL') })).toThrow();
    });
  });

  describe('transitions', () => {
    it('marks processed with the observed balance', () => {
      const tx = build(WagerTransactionKind.Bet);
      tx.markProcessed(undefined, brl('75.00'), at);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.balanceAfter?.toString()).toBe('75.00');
      expect(tx.isTerminal()).toBe(true);
    });

    it('supports the out-of-order path via PENDING_REFERENCE', () => {
      const tx = build(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'bet-1' });
      tx.markPendingReference(at);
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);

      tx.markProcessed('bet-internal', brl('100.00'), at);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe('bet-internal');
    });

    it('rejects and fails with a failure code', () => {
      const rejected = build(WagerTransactionKind.Bet);
      rejected.reject(FailureCode.InsufficientFunds, at);
      expect(rejected.status).toBe(WagerTransactionStatus.Rejected);
      expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);

      const failed = build(WagerTransactionKind.Bet);
      failed.fail(FailureCode.InternalError, at);
      expect(failed.status).toBe(WagerTransactionStatus.Failed);
    });

    it('refuses to transition out of a terminal state', () => {
      const tx = build(WagerTransactionKind.Bet);
      tx.markProcessed(undefined, brl('75.00'), at);
      expect(() => tx.markProcessed(undefined, brl('75.00'), at)).toThrow(InvalidTransactionStateError);
      expect(() => tx.reject(FailureCode.InternalError, at)).toThrow(InvalidTransactionStateError);
      expect(() => tx.fail(FailureCode.InternalError, at)).toThrow(InvalidTransactionStateError);
    });

    it('schedules reference retries with exponential backoff', () => {
      const tx = build(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'bet-1' });
      tx.markPendingReference(at);

      const first = new Date(at.getTime() + 1000);
      tx.scheduleReferenceRetry(first);
      expect(tx.referenceAttempts).toBe(1);
      expect(tx.nextReferenceAttemptAt?.getTime()).toBe(first.getTime() + 2000);

      const second = new Date(at.getTime() + 5000);
      tx.scheduleReferenceRetry(second);
      expect(tx.referenceAttempts).toBe(2);
      expect(tx.nextReferenceAttemptAt?.getTime()).toBe(second.getTime() + 4000);
    });
  });

  describe('domain queries', () => {
    it('reports balance neutrality for LOSS', () => {
      const loss = build(WagerTransactionKind.Loss);
      expect(loss.affectsBalance()).toBe(false);
    });

    it('matches the payload hash', () => {
      const tx = build(WagerTransactionKind.Bet);
      expect(tx.matchesPayload('hash-1')).toBe(true);
      expect(tx.matchesPayload('hash-2')).toBe(false);
    });

    it('derives ledger direction per kind', () => {
      expect(build(WagerTransactionKind.Bet).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
      expect(build(WagerTransactionKind.Win).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
      expect(
        build(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'bet-1' }).ledgerDirectionFor(),
      ).toBe(LedgerDirection.Credit);
    });

    it('inverts the reference direction for ROLLBACK', () => {
      const bet = build(WagerTransactionKind.Bet);
      const win = build(WagerTransactionKind.Win);

      const rollbackOfBet = build(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'bet-1' });
      const rollbackOfWin = build(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'win-1' });

      expect(rollbackOfBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
      expect(rollbackOfWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it('validates which kinds may be referenced', () => {
      const bet = build(WagerTransactionKind.Bet);
      const win = build(WagerTransactionKind.Win);

      const refund = build(WagerTransactionKind.Refund, { referenceExternalTransactionId: 'bet-1' });
      expect(refund.canReference(bet)).toBe(true);
      expect(refund.canReference(win)).toBe(false);

      const rollback = build(WagerTransactionKind.Rollback, { referenceExternalTransactionId: 'bet-1' });
      expect(rollback.canReference(bet)).toBe(true);
      expect(rollback.canReference(win)).toBe(true);
    });
  });
});
