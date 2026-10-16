import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Logger } from '@nestjs/common';
import type { MessagePublisher, PublishableMessage } from '../../src/application/ports/message-publisher.port';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { OutboxPublisherWorker } from '../../src/infrastructure/workers/outbox-publisher.worker';
import { PendingReferenceWorker } from '../../src/infrastructure/workers/pending-reference.worker';
import { createHarness, wagerCommand, type Harness } from '../support/harness';
import { noopMetrics } from '../support/metrics';

Logger.overrideLogger([]);

let h: Harness;

const metrics = noopMetrics;

class RecordingPublisher implements MessagePublisher {
  readonly published: PublishableMessage[] = [];
  async publish(message: PublishableMessage): Promise<void> {
    this.published.push(message);
  }
}

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openWallet(balance = '100.00'): Promise<{ walletId: string; playerId: string }> {
  const result = await h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: balance, currency: 'BRL' },
  });
  return { walletId: result.id, playerId: result.playerId };
}

describe('background workers', () => {
  it('drena a outbox via worker e marca os eventos como publicados', async () => {
    const { walletId, playerId } = await openWallet();
    await h.processWagerTransaction.execute(wagerCommand(walletId, playerId, 'BET', '25.00'));

    const publisher = new RecordingPublisher();
    const worker = new OutboxPublisherWorker(h.uow, publisher, metrics, {
      ...h.config,
      outbox: { ...h.config.outbox, pollIntervalMs: 5, batchSize: 100 },
    });

    worker.onModuleInit();
    await sleep(300);
    await worker.onModuleDestroy();

    expect(publisher.published).toHaveLength(4); // OPENING + BET, cada um com processed + balance-changed
    const pending = await h.orm.em.getConnection().execute<{ count: string }[]>(
      `select count(*)::text as count from "outbox_messages" where "published_at" is null`,
    );
    expect(pending[0]!.count).toBe('0');
  });

  it('o worker de referências pendentes rejeita a transação quando o orçamento se esgota', async () => {
    const { walletId, playerId } = await openWallet();

    const pending = await h.processWagerTransaction.execute(
      wagerCommand(walletId, playerId, 'ROLLBACK', '10.00', {
        externalTransactionId: 'rollback-worker',
        referenceExternalTransactionId: 'never-arrives',
      }),
    );
    expect(pending.outcome).toBe('pending_reference');
    if (pending.outcome !== 'pending_reference') {
      throw new Error('expected a pending reference');
    }

    const useCase = new ProcessWagerTransactionUseCase(h.uow, h.clock, {
      ...h.config.pendingReference,
      maxAttempts: 1,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
    });

    const worker = new PendingReferenceWorker(h.uow, metrics, useCase, {
      ...h.config,
      pendingReference: { ...h.config.pendingReference, pollIntervalMs: 5 },
    });

    worker.onModuleInit();
    await sleep(300);
    await worker.onModuleDestroy();

    const rows = await h.orm.em.getConnection().execute<{ status: string; failure_code: string }[]>(
      `select "status", "failure_code" from "wager_transactions" where "id" = ?`,
      [pending.transactionId],
    );
    expect(rows[0]!.status).toBe('REJECTED');
    expect(rows[0]!.failure_code).toBe('REFERENCE_NOT_FOUND');
  });
});
