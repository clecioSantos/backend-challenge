import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { MessagePublisher, PublishableMessage } from '../../src/application/ports/message-publisher.port';
import type { UnitOfWork } from '../../src/application/ports/unit-of-work.port';
import { newId } from '../../src/domain/shared/identifier';
import { Money } from '../../src/domain/shared/money';
import { Wallet } from '../../src/domain/wallet/wallet';
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

class RecordingPublisher implements MessagePublisher {
  readonly published: PublishableMessage[] = [];
  failNext = false;

  async publish(message: PublishableMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('broker unavailable');
    }
    this.published.push(message);
  }
}

/** Mirrors the worker's claim -> publish -> mark -> commit cycle. */
async function drainOutbox(uow: UnitOfWork, publisher: MessagePublisher): Promise<string[]> {
  return uow.run(async (tx) => {
    const messages = await tx.outbox.lockDueForUpdate(new Date(), 100);
    for (const message of messages) {
      await publisher.publish({
        id: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
        payload: message.payload,
      });
      message.markPublished(new Date());
      await tx.outbox.save(message);
    }
    return messages.map((message) => message.id);
  });
}

async function seedOutbox(): Promise<void> {
  const wallet = await h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  await h.processWagerTransaction.execute(wagerCommand(wallet.id, wallet.playerId, 'BET', '25.00'));
}

async function pendingCount(): Promise<string> {
  const rows = await h.orm.em.getConnection().execute<{ count: string }[]>(
    `select count(*)::text as count from "outbox_messages" where "published_at" is null`,
  );
  return rows[0]!.count;
}

async function walletCount(): Promise<string> {
  const rows = await h.orm.em.getConnection().execute<{ count: string }[]>(
    `select count(*)::text as count from "wallets"`,
  );
  return rows[0]!.count;
}

describe('transactional outbox', () => {
  it('writes the event in the same transaction as the financial change', async () => {
    await seedOutbox();
    // OPENING + BET, each producing a processed event and a balance-changed event.
    expect(await pendingCount()).toBe('4');
  });

  it('rolls back the whole unit of work when the transaction fails', async () => {
    const before = await walletCount();

    await expect(
      h.uow.run(async (tx) => {
        const wallet = Wallet.open({
          id: newId(),
          playerId: crypto.randomUUID(),
          initialBalance: Money.from({ amount: '5.00', currency: 'BRL' }),
          at: new Date(),
        });
        await tx.wallets.insert(wallet);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await walletCount()).toBe(before);
  });

  it('partitions the work between two concurrent publishers without loss or duplication', async () => {
    await seedOutbox();
    const publisher = new RecordingPublisher();
    const uow = h.forkUnitOfWork();

    const [first, second] = await Promise.all([drainOutbox(uow, publisher), drainOutbox(uow, publisher)]);

    const claimed = [...first, ...second];
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed).toHaveLength(4);
    expect(publisher.published).toHaveLength(4);
    expect(await pendingCount()).toBe('0');
  });

  it('leaves a failed publish unpublished for the next attempt', async () => {
    await seedOutbox();
    const publisher = new RecordingPublisher();
    const uow = h.forkUnitOfWork();

    publisher.failNext = true;
    await expect(drainOutbox(uow, publisher)).rejects.toThrow();

    // The entire transaction rolled back, so nothing was marked as published.
    expect(await pendingCount()).toBe('4');
    expect(publisher.published).toHaveLength(0);
  });
});
