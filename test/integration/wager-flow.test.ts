import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { IdempotencyConflictError } from '../../src/domain/shared/errors';
import { FailureCode } from '../../src/domain/shared/failure-code';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/wager-transaction/wager-transaction';
import { createHarness, wagerCommand, type Harness } from '../support/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

async function openWallet(balance = '1000.00'): Promise<{ walletId: string; playerId: string }> {
  const result = await h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: balance, currency: 'BRL' },
  });
  return { walletId: result.id, playerId: result.playerId };
}

describe('wallet creation', () => {
  it('records an OPENING credit and reconciles with the ledger', async () => {
    const { walletId } = await openWallet('1000.00');

    const ledger = await h.listLedger.execute({ walletId, limit: 50 });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.direction).toBe(LedgerDirection.Credit);
    expect(ledger.entries[0]!.money.toString()).toBe('1000.00');

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.toString()).toBe('1000.00');
    expect(reconciliation.calculatedBalance.toString()).toBe('1000.00');
  });

  it('rejects a second wallet for the same player and currency', async () => {
    const { playerId } = await openWallet();
    await expect(
      h.createWallet.execute({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } }),
    ).rejects.toMatchObject({ code: 'WALLET_ALREADY_EXISTS' });
  });
});

describe('wager lifecycle', () => {
  it('debits BET, credits WIN, records LOSS without moving balance and ends consistent', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const bet = await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'BET', '25.00'));
    expect(bet.outcome).toBe('processed');
    if (bet.outcome === 'processed') {
      expect(bet.balance.toString()).toBe('75.00');
    }

    const win = await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'WIN', '50.00'));
    expect(win.outcome).toBe('processed');
    if (win.outcome === 'processed') {
      expect(win.balance.toString()).toBe('125.00');
    }

    const loss = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'LOSS', '10.00', { roundId: 'round-loss' }),
    );
    expect(loss.outcome).toBe('processed');
    if (loss.outcome === 'processed') {
      expect(loss.balance.toString()).toBe('125.00');
    }

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.toString()).toBe('125.00');
    // OPENING + BET + WIN = 3 lançamentos; LOSS não produz nenhum.
    expect(reconciliation.checkedEntries).toBe(3);
  });

  it('replays an identical request with the original balance and no extra ledger entry', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = wagerCommand(walletId, playerId, 'BET', '25.00', {
      idempotencyKey: 'provider-a:fixed-key',
      externalTransactionId: 'fixed-key',
    });

    const first = await h.processWagerTransaction.execute(command);
    const second = await h.processWagerTransaction.execute(command);

    expect(first.outcome).toBe('processed');
    expect(second.outcome).toBe('processed');
    if (first.outcome === 'processed' && second.outcome === 'processed') {
      expect(second.idempotentReplay).toBe(true);
      expect(second.balance.toString()).toBe(first.balance.toString());
      expect(second.transactionId).toBe(first.transactionId);
    }

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.checkedEntries).toBe(2);
    expect(reconciliation.storedBalance.toString()).toBe('75.00');
  });

  it('treats the same idempotency key with a different payload as a conflict, not a replay', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const base = wagerCommand(walletId, playerId, 'BET', '25.00', {
      idempotencyKey: 'provider-a:conflict-key',
      externalTransactionId: 'conflict-key',
    });

    await h.processWagerTransaction.execute(base);

    const conflicting = { ...base, money: { amount: '30.00', currency: 'BRL' } };
    await expect(h.processWagerTransaction.execute(conflicting)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('rejects a BET without funds and produces no ledger entry', async () => {
    const { walletId, playerId } = await openWallet('10.00');

    const outcome = await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'BET', '25.00'));
    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.failureCode).toBe(FailureCode.InsufficientFunds);
    }

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.storedBalance.toString()).toBe('10.00');
    expect(reconciliation.checkedEntries).toBe(1);
  });

  it('rejects a transaction whose currency differs from the wallet', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = wagerCommand(walletId, playerId, 'BET', '10.00');
    command.money = { amount: '10.00', currency: 'USD' };

    const outcome = await h.processWagerTransaction.execute(command);
    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome === 'rejected') {
      expect(outcome.failureCode).toBe(FailureCode.WalletCurrencyMismatch);
    }
  });
});

describe('reversals and references', () => {
  it('refunds a processed BET exactly once', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const bet = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'BET', '40.00', { externalTransactionId: 'bet-1' }),
    );
    expect(bet.outcome).toBe('processed');

    const refund = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'REFUND', '40.00', {
        externalTransactionId: 'refund-1',
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    expect(refund.outcome).toBe('processed');
    if (refund.outcome === 'processed') {
      expect(refund.balance.toString()).toBe('100.00');
    }

    const secondRefund = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'REFUND', '40.00', {
        externalTransactionId: 'refund-2',
        referenceExternalTransactionId: 'bet-1',
      }),
    );
    expect(secondRefund.outcome).toBe('rejected');
    if (secondRefund.outcome === 'rejected') {
      expect(secondRefund.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
    }
  });

  it('parks a reversal that arrives before its reference and resumes it later', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const rollback = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'ROLLBACK', '30.00', {
        externalTransactionId: 'rollback-1',
        referenceExternalTransactionId: 'win-late',
      }),
    );
    expect(rollback.outcome).toBe('pending_reference');

    const win = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'WIN', '30.00', { externalTransactionId: 'win-late' }),
    );
    expect(win.outcome).toBe('processed');

    if (rollback.outcome !== 'pending_reference') {
      throw new Error('expected a pending reference');
    }
    const resumed = await h.processWagerTransaction.resume(rollback.transactionId);
    expect(resumed).toBe('processed');

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.toString()).toBe('100.00');
  });

  it('rejects a reversal that would drive the balance negative with a distinct failure code', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'WIN', '50.00', { externalTransactionId: 'win-1' }),
    );
    await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'BET', '150.00', { externalTransactionId: 'bet-drain' }),
    );

    const rollback = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'ROLLBACK', '50.00', {
        externalTransactionId: 'rollback-win',
        referenceExternalTransactionId: 'win-1',
      }),
    );

    expect(rollback.outcome).toBe('rejected');
    if (rollback.outcome === 'rejected') {
      expect(rollback.failureCode).toBe(FailureCode.ReversalWouldGoNegative);
    }
  });

  it('does not allow a REFUND to reference a WIN', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'WIN', '20.00', { externalTransactionId: 'win-2' }),
    );

    const refund = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'REFUND', '20.00', {
        externalTransactionId: 'refund-win',
        referenceExternalTransactionId: 'win-2',
      }),
    );

    expect(refund.outcome).toBe('rejected');
    if (refund.outcome === 'rejected') {
      expect(refund.failureCode).toBe(FailureCode.ReferenceKindNotAllowed);
    }
  });

  it('marks LOSS as processed without emitting a balance change', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const loss = await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'LOSS', '5.00'));

    expect(loss.outcome).toBe('processed');
    if (loss.outcome === 'processed') {
      expect(loss.status).toBe(WagerTransactionStatus.Processed);
      expect(loss.balance.toString()).toBe('100.00');
    }

    const balanceEvents = await h.orm.em.getConnection().execute<{ count: string }[]>(
      `select count(*)::text as count from "outbox_messages" where "event_type" = 'WalletBalanceChanged'`,
    );
    expect(balanceEvents[0]!.count).toBe('1'); // apenas o crédito de OPENING
  });
});

describe('internal kinds', () => {
  it('refuses a BET submitted with the internal OPENING kind via the public factory', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = wagerCommand(walletId, playerId, WagerTransactionKind.Opening, '10.00');
    await expect(h.processWagerTransaction.execute(command)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TRANSACTION_KIND',
    });
  });
});
