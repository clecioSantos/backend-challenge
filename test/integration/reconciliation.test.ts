import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
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

describe('reconciliation', () => {
  it('reporta a wallet consistente com o número de lançamentos verificados', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'BET', '25.00'));

    const result = await h.reconcile.execute(walletId);

    expect(result.consistent).toBe(true);
    expect(result.storedBalance.toString()).toBe('75.00');
    expect(result.calculatedBalance.toString()).toBe('75.00');
    expect(result.difference.toString()).toBe('0.00');
    expect(result.checkedEntries).toBe(2);
  });

  it('sinaliza divergência entre saldo materializado e ledger sem corrigi-la', async () => {
    const { walletId } = await openWallet('100.00');

    // Simula uma escrita fora do ledger: o saldo materializado fica inconsistente.
    await h.orm.em
      .getConnection()
      .execute(`update "wallets" set "balance" = 50.00 where "id" = ?`, [walletId]);

    const divergencesBefore = h.metrics.reconciliationDivergences.length;
    const result = await h.reconcile.execute(walletId);

    expect(result.consistent).toBe(false);
    expect(result.storedBalance.toString()).toBe('50.00');
    expect(result.calculatedBalance.toString()).toBe('100.00');
    expect(result.difference.toString()).toBe('-50.00');

    // A divergência é contabilizada em métrica (mesma moeda) e não corrigida.
    expect(h.metrics.reconciliationDivergences.length).toBe(divergencesBefore + 1);
    expect(h.metrics.reconciliationDivergences.at(-1)).toBe('BRL');

    const after = await h.reconcile.execute(walletId);
    expect(after.consistent).toBe(false);
    expect(after.storedBalance.toString()).toBe('50.00');
  });
});
