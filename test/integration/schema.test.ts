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

async function tableExists(name: string): Promise<boolean> {
  const rows = await h.orm.em
    .getConnection()
    .execute<{ exists: boolean }[]>(
      `select exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = ?
       ) as exists`,
      [name],
    );
  return rows[0]!.exists;
}

async function constraintExists(table: string, constraint: string): Promise<boolean> {
  const rows = await h.orm.em
    .getConnection()
    .execute<{ present: number }[]>(
      `select 1 as present from information_schema.table_constraints
       where table_schema = 'public' and table_name = ? and constraint_name = ?`,
      [table, constraint],
    );
  return rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await h.orm.em
    .getConnection()
    .execute<{ present: number }[]>(
      `select 1 as present from pg_indexes where schemaname = 'public' and indexname = ?`,
      [name],
    );
  return rows.length > 0;
}

async function openWallet(balance = '100.00'): Promise<{ walletId: string; playerId: string }> {
  const result = await h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: balance, currency: 'BRL' },
  });
  return { walletId: result.id, playerId: result.playerId };
}

describe('schema constraints', () => {
  it('rejeita duas wallets para o mesmo (playerId, currency), mas permite outra moeda', async () => {
    const playerId = crypto.randomUUID();

    const insert = (currency: string) =>
      h.orm.em.getConnection().execute(
        `insert into "wallets" ("id", "player_id", "currency", "balance", "version", "created_at", "updated_at")
         values (?, ?, ?, 0.00, 1, now(), now())`,
        [crypto.randomUUID(), playerId, currency],
      );

    await insert('BRL');
    await expect(insert('BRL')).rejects.toThrow(/wallets_player_currency_uq|duplicate key/i);
    await insert('USD'); // mesma pessoa, moeda diferente é permitido
  });

  it('impede saldo materializado negativo', async () => {
    const { walletId } = await openWallet('100.00');

    await expect(
      h.orm.em
        .getConnection()
        .execute(`update "wallets" set "balance" = -1.00 where "id" = ?`, [walletId]),
    ).rejects.toThrow(/wallets_balance_non_negative|check constraint/i);
  });

  it('impede lançamento de ledger com aritmética inválida', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    // LOSS não gera lançamento; usamos o id da transação para inserir um lançamento
    // inconsistente e provar que o CHECK do banco rejeita.
    const loss = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'LOSS', '5.00', { externalTransactionId: 'schema-loss' }),
    );
    if (loss.outcome !== 'processed') {
      throw new Error('expected LOSS to be processed');
    }

    await expect(
      h.orm.em.getConnection().execute(
        `insert into "wallet_ledger_entries"
           ("id", "wallet_id", "transaction_id", "direction", "amount", "currency", "balance_before", "balance_after", "created_at")
         values (?, ?, ?, 'CREDIT', 10.00, 'BRL', 100.00, 999.00, now())`,
        [crypto.randomUUID(), walletId, loss.transactionId],
      ),
    ).rejects.toThrow(/wallet_ledger_entries_arithmetic_check|check constraint/i);
  });

  it('impede UPDATE e DELETE no ledger (trigger append-only)', async () => {
    const { walletId } = await openWallet('100.00');
    const page = await h.listLedger.execute({ walletId, limit: 1 });
    const entryId = page.entries[0]!.id;

    await expect(
      h.orm.em.getConnection().execute(`update "wallet_ledger_entries" set "amount" = 1.00 where "id" = ?`, [entryId]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      h.orm.em.getConnection().execute(`delete from "wallet_ledger_entries" where "id" = ?`, [entryId]),
    ).rejects.toThrow(/append-only/i);
  });

  it('impede reversão dupla da mesma referência pelo mesmo tipo no banco', async () => {
    const { walletId, playerId } = await openWallet('100.00');

    const bet = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'BET', '10.00', { externalTransactionId: 'schema-bet' }),
    );
    if (bet.outcome !== 'processed') {
      throw new Error('expected BET to be processed');
    }

    await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'REFUND', '10.00', {
        externalTransactionId: 'schema-refund-1',
        referenceExternalTransactionId: 'schema-bet',
      }),
    );

    // Segunda REFUND já PROCESSED apontando para a mesma BET: o índice único
    // parcial deve barrar no banco, mesmo que a aplicação tentasse.
    await expect(
      h.orm.em.getConnection().execute(
        `insert into "wager_transactions"
           ("id", "provider_id", "wallet_id", "player_id", "external_transaction_id", "idempotency_key",
            "payload_hash", "round_id", "game_id", "kind", "amount", "currency",
            "reference_external_transaction_id", "reference_transaction_id", "status", "created_at")
         values (?, 'provider-a', ?, ?, 'schema-refund-2', 'provider-a:schema-refund-2',
            'hash', 'round-1', 'fortune-chimp', 'REFUND', 10.00, 'BRL',
            'schema-bet', ?, 'PROCESSED', now())`,
        [crypto.randomUUID(), walletId, playerId, bet.transactionId],
      ),
    ).rejects.toThrow(/wager_transactions_reversal_uq|duplicate key/i);
  });

  it('aplica e reverte todas as migrations, recriando o schema e as constraints', async () => {
    const migrator = h.orm.getMigrator();

    await migrator.down({ to: 0 });
    expect(await tableExists('wallets')).toBe(false);
    expect(await tableExists('wallet_ledger_entries')).toBe(false);

    await migrator.up();
    expect(await tableExists('wallets')).toBe(true);
    expect(await tableExists('wallet_ledger_entries')).toBe(true);
    expect(await tableExists('wager_transactions')).toBe(true);
    expect(await constraintExists('wallet_ledger_entries', 'wallet_ledger_entries_arithmetic_check')).toBe(true);
    expect(await indexExists('wager_transactions_reversal_uq')).toBe(true);
  });
});
