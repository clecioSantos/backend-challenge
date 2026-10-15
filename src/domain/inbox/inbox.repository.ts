import type { InboxMessage } from './inbox-message';

export interface InboxRepository {
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;

  /**
   * Atomically inserts the dedup record and returns `true` when this caller
   * won the race. Returns `false` when `(consumerName, messageId)` already
   * exists, meaning the message was (or is being) handled elsewhere.
   */
  insertIfAbsent(message: InboxMessage): Promise<boolean>;

  markProcessed(consumerName: string, messageId: string, processedAt: Date): Promise<void>;
}
