import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { FailureCode } from '../../src/domain/shared/failure-code';
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

async function openWallet(balance: string): Promise<{ walletId: string; playerId: string }> {
  const result = await h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: balance, currency: 'BRL' },
  });
  return { walletId: result.id, playerId: result.playerId };
}

async function debitCount(transactionId: string): Promise<string> {
  const rows = await h.orm.em.getConnection().execute<{ count: string }[]>(
    `select count(*)::text as count from "wallet_ledger_entries" where "transaction_id" = ? and "direction" = 'DEBIT'`,
    [transactionId],
  );
  return rows[0]!.count;
}

describe('concurrency', () => {
  it('resolves two simultaneous bets on the same wallet deterministically (section 8)', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const [a, b] = await Promise.all([
      h.fork().execute(wagerCommand(walletId, playerId, 'BET', '80.00', { externalTransactionId: 'bet-a' })),
      h.fork().execute(wagerCommand(walletId, playerId, 'BET', '80.00', { externalTransactionId: 'bet-b' })),
    ]);

    const processed = [a, b].filter((outcome) => outcome.outcome === 'processed');
    const rejected = [a, b].filter((outcome) => outcome.outcome === 'rejected');

    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]!.outcome === 'rejected') {
      expect(rejected[0]!.failureCode).toBe(FailureCode.InsufficientFunds);
    }

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.storedBalance.toString()).toBe('20.00');
    expect(reconciliation.consistent).toBe(true);
    // OPENING + exatamente um débito.
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it('applies a single debit when the same bet is delivered 50 times in parallel', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = wagerCommand(walletId, playerId, 'BET', '10.00', {
      idempotencyKey: 'provider-a:storm',
      externalTransactionId: 'storm',
    });

    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () => h.fork().execute({ ...command })),
    );

    const processed = outcomes.filter((outcome) => outcome.outcome === 'processed');
    const replays = processed.filter((outcome) => outcome.outcome === 'processed' && outcome.idempotentReplay);

    expect(processed).toHaveLength(50);
    expect(replays).toHaveLength(49);

    const transactionId = processed[0]!.transactionId;
    expect(await debitCount(transactionId)).toBe('1');

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.storedBalance.toString()).toBe('90.00');
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it('keeps distinct wallets fully parallel and consistent', async () => {
    const wallets = await Promise.all([openWallet('50.00'), openWallet('50.00'), openWallet('50.00')]);

    const outcomes = await Promise.all(
      wallets.map((wallet) =>
        h.fork().execute(wagerCommand(wallet.walletId, wallet.playerId, 'BET', '10.00')),
      ),
    );

    expect(outcomes.every((outcome) => outcome.outcome === 'processed')).toBe(true);

    for (const wallet of wallets) {
      const reconciliation = await h.reconcile.execute(wallet.walletId);
      expect(reconciliation.storedBalance.toString()).toBe('40.00');
      expect(reconciliation.consistent).toBe(true);
    }
  });

  it('stays correct with three application instances competing for one wallet', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const outcomes = await Promise.all([
      h.fork().execute(wagerCommand(walletId, playerId, 'BET', '40.00', { externalTransactionId: 'i1' })),
      h.fork().execute(wagerCommand(walletId, playerId, 'BET', '40.00', { externalTransactionId: 'i2' })),
      h.fork().execute(wagerCommand(walletId, playerId, 'BET', '40.00', { externalTransactionId: 'i3' })),
    ]);

    const processed = outcomes.filter((outcome) => outcome.outcome === 'processed');
    expect(processed).toHaveLength(2);

    const reconciliation = await h.reconcile.execute(walletId);
    expect(reconciliation.storedBalance.toString()).toBe('20.00');
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.checkedEntries).toBe(3); // OPENING + dois débitos
  });
});
