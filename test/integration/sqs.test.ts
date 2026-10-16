import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Logger } from '@nestjs/common';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  type QueueAttributeName,
} from '@aws-sdk/client-sqs';
import type { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import type { AppConfig } from '../../src/config/env';
import { InfrastructureError } from '../../src/domain/shared/errors';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { SqsMessagePublisher } from '../../src/infrastructure/messaging/sqs-message-publisher';
import { createHarness, type Harness } from '../support/harness';
import { noopMetrics } from '../support/metrics';

// Este arquivo envia de propósito payloads inválidos e provoca falhas; silenciamos
// o logger do Nest para que os WARN/ERROR esperados não poluam a saída da suíte.
Logger.overrideLogger([]);

let h: Harness;
let client: SQSClient;
let publisher: SqsMessagePublisher;

const metrics = noopMetrics;

beforeAll(async () => {
  h = await createHarness();
  client = new SQSClient({
    region: h.config.sqs.region,
    endpoint: 'http://127.0.0.1:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  publisher = new SqsMessagePublisher(client, h.config.sqs.queueUrl);
  await drainQueue(h.config.sqs.queueUrl);
  await drainQueue(h.config.sqs.dlqUrl);
});

afterAll(async () => {
  client.destroy();
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  await drainQueue(h.config.sqs.queueUrl);
  await drainQueue(h.config.sqs.dlqUrl);
});

/**
 * Esvazia a fila de verdade: o `PurgeQueue` do SQS é best-effort (pode levar até
 * 60s e é ignorado em chamadas repetidas), então recebemos e deletamos em loop
 * com `VisibilityTimeout=0` até não sobrar nada. Isso evita que mensagens de
 * execuções anteriores contaminem o teste.
 */
async function drainQueue(queueUrl: string): Promise<void> {
  for (let round = 0; round < 30; round += 1) {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 0,
      }),
    );

    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      return;
    }

    for (const message of messages) {
      if (message.ReceiptHandle) {
        await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    }
  }
}

interface StubUseCase {
  calls(): number;
  execute(): Promise<unknown>;
}

/**
 * Stub do use case que falha de forma transitória (`InfrastructureError`
 * retryable) nas primeiras `failures` chamadas e depois sucede. Usado para
 * exercitar o caminho de retry/backoff sem depender de erros reais de banco.
 */
function transientFailingUseCase(failures: number): StubUseCase {
  let calls = 0;
  return {
    calls: () => calls,
    execute: async () => {
      calls += 1;
      if (calls <= failures) {
        throw new InfrastructureError('transient failure', { retryable: true });
      }
      return {
        outcome: 'processed',
        transactionId: 'stub-transaction',
        status: 'PROCESSED',
        balance: { toJSON: () => ({ amount: '0.00', currency: 'BRL' }) },
        idempotentReplay: false,
      };
    },
  };
}

function buildConsumer(
  useCase: ProcessWagerTransactionUseCase = h.processWagerTransaction,
  overrides: Partial<AppConfig['sqs']> = {},
): SqsConsumerService {
  const config: AppConfig = {
    ...h.config,
    sqs: {
      ...h.config.sqs,
      endpoint: 'http://127.0.0.1:4566',
      waitTimeSeconds: 1,
      visibilityTimeoutSeconds: 5,
      maxReceiveCount: 5,
      pollEnabled: true,
      batchSize: 10,
      ...overrides,
    },
  };
  return new SqsConsumerService(client, config, metrics, useCase);
}

async function queueCount(queueUrl: string, attribute: QueueAttributeName): Promise<number> {
  const response = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: [attribute] }),
  );
  return Number(response.Attributes?.[attribute] ?? '0');
}

const visible = (queueUrl: string) => queueCount(queueUrl, 'ApproximateNumberOfMessages');
const invisible = (queueUrl: string) => queueCount(queueUrl, 'ApproximateNumberOfMessagesNotVisible');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chama `poll()` até a condição valer (ou estourar o deadline). Robusto a timing do broker. */
async function pollUntil(
  consumer: SqsConsumerService,
  predicate: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await consumer.poll();
  }
}

async function publishValidEnvelope(externalTransactionId: string, walletId: string, playerId: string): Promise<void> {
  await publisher.publish({
    id: crypto.randomUUID(),
    eventType: 'WagerTransactionRequested',
    aggregateId: walletId,
    payload: {
      messageId: crypto.randomUUID(),
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'provider-a',
        externalTransactionId,
        playerId,
        walletId,
        roundId: 'round-sqs',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      },
    },
  });
}

async function openWallet(): Promise<{ id: string; playerId: string }> {
  return h.createWallet.execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
}

describe('SQS ingress', () => {
  it('processa uma mensagem WagerTransactionRequested de ponta a ponta e dá ack', async () => {
    const wallet = await openWallet();
    await publishValidEnvelope('sqs-transaction-1', wallet.id, wallet.playerId);

    const consumer = buildConsumer();
    await consumer.poll();
    await consumer.poll(); // a segunda passada prova que a mensagem foi deletada

    const transaction = await h.orm.em.getConnection().execute<{ status: string }[]>(
      `select "status" from "wager_transactions"
        where "provider_id" = 'provider-a' and "external_transaction_id" = ?`,
      ['sqs-transaction-1'],
    );
    expect(transaction).toHaveLength(1);
    expect(transaction[0]!.status).toBe('PROCESSED');
    expect(await visible(h.config.sqs.queueUrl)).toBe(0);

    const reconciliation = await h.reconcile.execute(wallet.id);
    expect(reconciliation.storedBalance.toString()).toBe('75.00');
    expect(reconciliation.consistent).toBe(true);
  });

  it('encaminha uma mensagem malformada para a DLQ sem reprocessar para sempre', async () => {
    await publisher.publish({
      id: crypto.randomUUID(),
      eventType: 'WagerTransactionRequested',
      aggregateId: 'unknown',
      payload: { messageId: 'msg-bad', type: 'WagerTransactionRequested', data: {} },
    });

    const consumer = buildConsumer();
    await consumer.poll();

    expect(await visible(h.config.sqs.queueUrl)).toBe(0);
    expect(await visible(h.config.sqs.dlqUrl)).toBe(1);
  });

  it('não dá ack em falha transitória e reprocessa com backoff', async () => {
    const wallet = await openWallet();
    await publishValidEnvelope('sqs-retry-1', wallet.id, wallet.playerId);

    const stub = transientFailingUseCase(1);
    const consumer = buildConsumer(stub as unknown as ProcessWagerTransactionUseCase);

    await pollUntil(consumer, () => stub.calls() >= 1); // 1ª tentativa: falha transitória
    expect(stub.calls()).toBe(1);
    expect(await visible(h.config.sqs.queueUrl)).toBe(0);
    expect(await invisible(h.config.sqs.queueUrl)).toBe(1);

    await sleep(2_500); // backoff base de 2s
    await pollUntil(consumer, () => stub.calls() >= 2); // 2ª tentativa: sucesso -> ack

    expect(stub.calls()).toBe(2);
    expect(await visible(h.config.sqs.queueUrl)).toBe(0);
    expect(await invisible(h.config.sqs.queueUrl)).toBe(0);
  });

  it('encaminha para a DLQ quando o orçamento de tentativas se esgota', async () => {
    const wallet = await openWallet();
    await publishValidEnvelope('sqs-exhaust-1', wallet.id, wallet.playerId);

    const stub = transientFailingUseCase(Number.MAX_SAFE_INTEGER);
    const consumer = buildConsumer(stub as unknown as ProcessWagerTransactionUseCase, {
      maxReceiveCount: 1,
    });

    await pollUntil(consumer, () => stub.calls() >= 1); // receiveCount 1 >= maxReceiveCount 1 -> DLQ

    expect(stub.calls()).toBe(1);
    expect(await visible(h.config.sqs.queueUrl)).toBe(0);
    expect(await visible(h.config.sqs.dlqUrl)).toBe(1);
  });
});
