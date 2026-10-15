import { computeBackoffDelay, type BackoffPolicy } from '../shared/backoff';
import type { IntegrationEvent, IntegrationEventEnvelope } from '../events/integration-event';

export const DEFAULT_OUTBOX_BACKOFF: BackoffPolicy = { baseMs: 1000, maxMs: 60_000 };

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

/**
 * Transactional outbox record. Written in the same SQL transaction as the
 * financial mutation, then published asynchronously by a worker. Concurrency
 * between publishers is handled by `SELECT ... FOR UPDATE SKIP LOCKED` in the
 * repository, so several instances can drain the same table safely.
 */
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const envelope = event.toJSON() as IntegrationEventEnvelope<unknown>;

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      envelope as unknown as Record<string, unknown>,
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    return this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    this._publishedAt = at;
  }

  /**
   * Increments `attempts` and computes the next attempt time using exponential
   * backoff capped at `policy.maxMs`.
   */
  scheduleRetry(now: Date, policy: BackoffPolicy = DEFAULT_OUTBOX_BACKOFF): void {
    this._attempts += 1;
    this._nextAttemptAt = new Date(now.getTime() + computeBackoffDelay(this._attempts, policy));
  }
}
