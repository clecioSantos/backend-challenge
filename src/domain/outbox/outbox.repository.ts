import type { OutboxMessage } from './outbox-message';

export interface OutboxRepository {
  insert(message: OutboxMessage): Promise<void>;

  /**
   * Locks up to `limit` due, unpublished rows with `FOR UPDATE SKIP LOCKED`,
   * oldest first. The lock is held until the surrounding transaction ends, so
   * concurrent publishers never pick the same row.
   */
  lockDueForUpdate(now: Date, limit: number): Promise<OutboxMessage[]>;

  save(message: OutboxMessage): Promise<void>;

  countPending(): Promise<number>;

  /** Age in milliseconds of the oldest unpublished row, or `null` when drained. */
  oldestPendingAgeMs(now: Date): Promise<number | null>;
}
