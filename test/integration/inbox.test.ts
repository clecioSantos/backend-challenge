import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { ProcessWagerTransactionCommand } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { InfrastructureError } from '../../src/domain/shared/errors';
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

function withConsumer(
  command: ReturnType<typeof wagerCommand>,
  messageId: string,
): ProcessWagerTransactionCommand {
  return {
    ...command,
    consumer: {
      consumerName: 'wager-transactions-consumer',
      messageId,
      payloadHash: `hash:${messageId}`,
      receivedAt: new Date(),
    },
  };
}

async function debitCount(walletId: string): Promise<string> {
  const rows = await h.orm.em.getConnection().execute<{ count: string }[]>(
    `select count(*)::text as count
       from "wallet_ledger_entries"
      where "wallet_id" = ? and "direction" = 'DEBIT'`,
    [walletId],
  );
  return rows[0]!.count;
}

describe('persistent inbox', () => {
  it('deduplicates a redelivered message without applying it twice', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = withConsumer(wagerCommand(walletId, playerId, 'BET', '20.00'), 'msg-redelivered');

    const first = await h.processWagerTransaction.execute(command);
    const redelivery = await h.processWagerTransaction.execute(command);

    expect(first.outcome).toBe('processed');
    expect(redelivery.outcome).toBe('processed');
    if (redelivery.outcome === 'processed') {
      expect(redelivery.idempotentReplay).toBe(true);
    }
    expect(await debitCount(walletId)).toBe('1');
  });

  it('lets exactly one concurrent duplicate win, the other replays or retries', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const command = withConsumer(wagerCommand(walletId, playerId, 'BET', '20.00'), 'msg-race');

    const results = await Promise.allSettled([
      h.fork().execute({ ...command }),
      h.fork().execute({ ...command }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    // Pelo menos o vencedor tem sucesso; um perdedor concorrente ou faz replay ou é instruído
    // a fazer retry (nunca é descartado silenciosamente).
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(InfrastructureError);
    }
    expect(await debitCount(walletId)).toBe('1');
  });

  it('keeps the inbox row transactional: nothing is marked processed on failure', async () => {
    const { walletId, playerId } = await openWallet('100.00');
    const invalid = withConsumer(
      wagerCommand(walletId, playerId, 'BET', '20.00', { referenceExternalTransactionId: 'unexpected' }),
      'msg-invalid',
    );

    await expect(h.processWagerTransaction.execute(invalid)).rejects.toMatchObject({
      code: 'UNEXPECTED_REFERENCE',
    });

    const inbox = await h.orm.em.getConnection().execute<{ count: string }[]>(
      `select count(*)::text as count from "inbox_messages" where "message_id" = 'msg-invalid'`,
    );
    // O claim sofreu rollback junto com a transação que falhou.
    expect(inbox[0]!.count).toBe('0');
    expect(await debitCount(walletId)).toBe('0');
  });
});
