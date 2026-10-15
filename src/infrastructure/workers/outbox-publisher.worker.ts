import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MessagePublisher } from '../../application/ports/message-publisher.port';
import type { MetricsPort } from '../../application/ports/metrics.port';
import { MESSAGE_PUBLISHER, METRICS, UNIT_OF_WORK } from '../../application/ports/tokens';
import type { UnitOfWork } from '../../application/ports/unit-of-work.port';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../config/app-config.provider';
import { startIntervalLoop, type IntervalLoop } from './interval-loop';

/**
 * Transactional outbox publisher.
 *
 * Each tick claims a batch of due rows with `FOR UPDATE SKIP LOCKED`, publishes
 * them, marks them published and commits. Because the row lock is held for the
 * whole publish+mark cycle, concurrent publishers never send the same row, and
 * a crash after commit but before publish leaves the row unpublished for the
 * next tick. A publish that succeeds but whose commit fails is simply retried,
 * which is safe: consumers deduplicate.
 */
@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private readonly config: AppConfig['outbox'];
  private loop: IntervalLoop | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.config = config.outbox;
  }

  onModuleInit(): void {
    this.loop = startIntervalLoop({
      intervalMs: this.config.pollIntervalMs,
      run: () => this.drain(),
      onError: (error) => this.logger.error({ err: error }, 'Outbox drain failed'),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop?.stop();
  }

  private async drain(): Promise<void> {
    const now = new Date();
    let published = 0;

    await this.uow.run(async (tx) => {
      const messages = await tx.outbox.lockDueForUpdate(now, this.config.batchSize);

      for (const message of messages) {
        const attempt = message.attempts + 1;
        try {
          await this.publisher.publish({
            id: message.id,
            eventType: message.eventType,
            aggregateId: message.aggregateId,
            payload: message.payload,
          });
          message.markPublished(new Date());
          published += 1;
        } catch (error) {
          message.scheduleRetry(new Date(), {
            baseMs: this.config.baseBackoffMs,
            maxMs: this.config.maxBackoffMs,
          });
          this.metrics.recordRetry('outbox');
          if (attempt >= this.config.maxAttempts) {
            this.logger.error(
              { eventId: message.id, attempts: message.attempts, err: error },
              'Outbox message exceeded max attempts; will keep retrying with capped backoff',
            );
          }
        }
        await tx.outbox.save(message);
      }
    });

    if (published > 0) {
      this.logger.debug({ published }, 'Outbox batch published');
    }

    await this.refreshLag();
  }

  private async refreshLag(): Promise<void> {
    const now = new Date();
    const snapshot = await this.uow.read(async (tx) => ({
      pending: await tx.outbox.countPending(),
      oldestAgeMs: await tx.outbox.oldestPendingAgeMs(now),
    }));

    this.metrics.setOutboxPending(snapshot.pending);
    if (snapshot.oldestAgeMs !== null) {
      this.metrics.setOutboxLag(snapshot.oldestAgeMs);
    }
  }
}
