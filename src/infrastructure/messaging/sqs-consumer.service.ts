import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { hashWagerPayload } from '../../application/crypto/canonical-json';
import type { MetricsPort } from '../../application/ports/metrics.port';
import { METRICS } from '../../application/ports/tokens';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionCommand,
} from '../../application/use-cases/process-wager-transaction.use-case';
import { computeBackoffDelay } from '../../domain/shared/backoff';
import { isDomainError, InfrastructureError } from '../../domain/shared/errors';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../config/app-config.provider';
import { SQS_CLIENT } from './sqs.providers';
import {
  parseWagerTransactionRequested,
  type WagerTransactionRequestedEnvelope,
} from './inbound/wager-transaction-requested.message';

const TRANSIENT_BACKOFF = { baseMs: 2_000, maxMs: 300_000 };

/**
 * Consumidor SQS para `wager-transactions.fifo`.
 *
 * Garantias:
 *  - a mensagem só é excluída após o commit da transação de negócio;
 *  - a deduplicação é delegada ao inbox persistente indexado por
 *    `(consumerName, messageId)`, então uma mensagem reentregue nunca é
 *    aplicada duas vezes;
 *  - payloads inválidos e rejeições de negócio/validação são encaminhados
 *    terminalmente para a DLQ, falhas transitórias são reprocessadas com
 *    backoff exponencial via `ChangeMessageVisibility`, e a redrive policy do
 *    broker é o último recurso.
 *
 * Em `SIGTERM` (`OnModuleDestroy`) o loop para de aceitar novas mensagens e
 * aguarda a que está em andamento; mensagens não confirmadas retornam para a
 * queue quando sua visibility expira.
 */
@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly config: AppConfig['sqs'];

  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly useCase: ProcessWagerTransactionUseCase,
  ) {
    this.config = config.sqs;
  }

  onModuleInit(): void {
    if (!this.config.pollEnabled) {
      this.logger.log('SQS polling disabled by configuration');
      return;
    }
    this.running = true;
    this.loop = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.loop) {
      await this.loop;
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
      } catch (error) {
        this.logger.error({ err: error }, 'SQS poll failed');
        await delay(1_000);
      }
    }
  }

  /** Recebe e processa um único lote de mensagens. Exposto para testes. */
  async poll(): Promise<void> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.config.queueUrl,
        MaxNumberOfMessages: this.config.batchSize,
        WaitTimeSeconds: this.config.waitTimeSeconds,
        VisibilityTimeout: this.config.visibilityTimeoutSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
      }),
    );

    // Um lote que já foi buscado é processado até o fim mesmo se um shutdown
    // foi solicitado em paralelo: ele está em andamento, não é trabalho novo.
    for (const message of response.Messages ?? []) {
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    const startedAt = Date.now();

    let envelope: WagerTransactionRequestedEnvelope;
    try {
      envelope = parseWagerTransactionRequested(message.Body ?? '');
    } catch (error) {
      this.logger.warn({ messageId: message.MessageId, err: error }, 'Discarding malformed SQS message');
      await this.deadLetter(message, receiveCount, 'invalid_payload');
      return;
    }

    try {
      const outcome = await this.useCase.execute(this.toCommand(envelope));
      this.metrics.recordTransaction(outcome.status);
      if (outcome.idempotentReplay) {
        this.metrics.recordDuplicate('sqs');
      }
      this.metrics.observeProcessingLatency((Date.now() - startedAt) / 1_000);
      await this.ack(message);
    } catch (error) {
      await this.handleFailure(message, envelope, receiveCount, error);
    }
  }

  private async handleFailure(
    message: Message,
    envelope: WagerTransactionRequestedEnvelope,
    receiveCount: number,
    error: unknown,
  ): Promise<void> {
    const context = { messageId: envelope.messageId, transaction: envelope.data.externalTransactionId };

    if (isDomainError(error)) {
      this.logger.warn({ ...context, code: error.code }, 'Rejecting poison message to DLQ');
      await this.deadLetter(message, receiveCount, error.code);
      return;
    }

    if (error instanceof InfrastructureError && !error.retryable) {
      this.logger.error({ ...context, err: error }, 'Permanent infrastructure failure; routing to DLQ');
      await this.deadLetter(message, receiveCount, 'infrastructure');
      return;
    }

    if (receiveCount >= this.config.maxReceiveCount) {
      this.logger.error({ ...context, receiveCount }, 'Retry budget exhausted; routing to DLQ');
      await this.deadLetter(message, receiveCount, 'max_receive_count');
      return;
    }

    // Falha transitória: oculta a mensagem por uma janela de backoff antes que o
    // broker a torne visível novamente. O receive count continua aumentando a
    // cada tentativa.
    const delayMs = computeBackoffDelay(receiveCount, TRANSIENT_BACKOFF);
    this.metrics.recordRetry('sqs');
    this.logger.warn({ ...context, receiveCount, delayMs, err: error }, 'Transient failure; scheduling retry');
    await this.defer(message, delayMs);
  }

  private async ack(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }

  private async defer(message: Message, delayMs: number): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.config.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: Math.ceil(delayMs / 1_000),
        }),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to defer message visibility');
    }
  }

  private async deadLetter(message: Message, receiveCount: number, reason: string): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.config.dlqUrl,
          MessageBody: message.Body ?? '{}',
          MessageGroupId: 'dlq',
          MessageDeduplicationId: `${message.MessageId ?? Date.now()}:${receiveCount}`,
          MessageAttributes: {
            reason: { DataType: 'String', StringValue: reason },
          },
        }),
      );
      this.metrics.recordDeadLetter('sqs');
      await this.ack(message);
    } catch (error) {
      // Se a escrita na DLQ falhar, mantém a mensagem para que a redrive policy
      // ainda tenha a chance de movê-la em vez de descartá-la silenciosamente.
      this.logger.error({ err: error }, 'Failed to route message to DLQ');
    }
  }

  private toCommand(envelope: WagerTransactionRequestedEnvelope): ProcessWagerTransactionCommand {
    const { data } = envelope;
    const idempotencyKey = data.idempotencyKey ?? `${data.providerId}:${data.externalTransactionId}`;

    return {
      providerId: data.providerId,
      externalTransactionId: data.externalTransactionId,
      idempotencyKey,
      walletId: data.walletId,
      playerId: data.playerId,
      roundId: data.roundId,
      gameId: data.gameId,
      kind: data.kind,
      money: data.money,
      referenceExternalTransactionId: data.referenceExternalTransactionId,
      correlationId: envelope.messageId,
      causationId: envelope.messageId,
      consumer: {
        consumerName: this.config.consumerName,
        messageId: envelope.messageId,
        payloadHash: hashWagerPayload({
          providerId: data.providerId,
          externalTransactionId: data.externalTransactionId,
          playerId: data.playerId,
          walletId: data.walletId,
          roundId: data.roundId,
          gameId: data.gameId,
          kind: data.kind,
          money: data.money,
          referenceExternalTransactionId: data.referenceExternalTransactionId,
        }),
        receivedAt: new Date(),
      },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
