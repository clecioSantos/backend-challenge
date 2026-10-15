import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { GetQueueAttributesCommand, PurgeQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { MetricsPort } from '../../src/application/ports/metrics.port';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { SqsMessagePublisher } from '../../src/infrastructure/messaging/sqs-message-publisher';
import { createHarness, type Harness } from '../support/harness';

let h: Harness;
let client: SQSClient;
let publisher: SqsMessagePublisher;

const metrics: MetricsPort = {
  recordTransaction: () => {},
  recordDuplicate: () => {},
  recordRetry: () => {},
  recordLockConflict: () => {},
  recordDeadLetter: () => {},
  observeProcessingLatency: () => {},
  setOutboxPending: () => {},
  setOutboxLag: () => {},
};

beforeAll(async () => {
  h = await createHarness();
  client = new SQSClient({
    region: h.config.sqs.region,
    endpoint: 'http://127.0.0.1:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  publisher = new SqsMessagePublisher(client, h.config.sqs.queueUrl);
});

afterAll(async () => {
  client.destroy();
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await client.send(new PurgeQueueCommand({ QueueUrl: h.config.sqs.queueUrl }));
  await client.send(new PurgeQueueCommand({ QueueUrl: h.config.sqs.dlqUrl }));
});

function buildConsumer(): SqsConsumerService {
  const config = {
    ...h.config,
    sqs: {
      ...h.config.sqs,
      endpoint: 'http://127.0.0.1:4566',
      waitTimeSeconds: 1,
      visibilityTimeoutSeconds: 5,
      pollEnabled: true,
      batchSize: 10,
    },
  };
  return new SqsConsumerService(client, config, metrics, h.processWagerTransaction);
}

async function visibleCount(queueUrl: string): Promise<number> {
  const response = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }),
  );
  return Number(response.Attributes?.ApproximateNumberOfMessages ?? '0');
}

describe('SQS ingress', () => {
  it('processes a WagerTransactionRequested message end to end and acks it', async () => {
    const wallet = await h.createWallet.execute({
      playerId: crypto.randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const externalTransactionId = 'sqs-transaction-1';
    await publisher.publish({
      id: crypto.randomUUID(),
      eventType: 'WagerTransactionRequested',
      aggregateId: wallet.id,
      payload: {
        messageId: 'msg-sqs-1',
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: {
          providerId: 'provider-a',
          externalTransactionId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: 'round-sqs',
          gameId: 'fortune-chimp',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        },
      },
    });

    const consumer = buildConsumer();
    await consumer.poll();
    await consumer.poll(); // a segunda passada prova que a mensagem foi deletada

    const transaction = await h.orm.em.getConnection().execute<{ status: string }[]>(
      `select "status" from "wager_transactions"
        where "provider_id" = 'provider-a' and "external_transaction_id" = ?`,
      [externalTransactionId],
    );
    expect(transaction).toHaveLength(1);
    expect(transaction[0]!.status).toBe('PROCESSED');
    expect(await visibleCount(h.config.sqs.queueUrl)).toBe(0);

    const reconciliation = await h.reconcile.execute(wallet.id);
    expect(reconciliation.storedBalance.toString()).toBe('75.00');
    expect(reconciliation.consistent).toBe(true);
  });

  it('routes a malformed message to the DLQ without retrying forever', async () => {
    await publisher.publish({
      id: crypto.randomUUID(),
      eventType: 'WagerTransactionRequested',
      aggregateId: 'unknown',
      payload: { messageId: 'msg-bad', type: 'WagerTransactionRequested', data: {} },
    });

    const consumer = buildConsumer();
    await consumer.poll();

    expect(await visibleCount(h.config.sqs.queueUrl)).toBe(0);
    expect(await visibleCount(h.config.sqs.dlqUrl)).toBe(1);
  });
});
