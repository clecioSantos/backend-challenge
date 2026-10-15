/** Minimal, transport-agnostic description of an integration event to publish. */
export interface PublishableMessage {
  /** Stable event id; also used as the broker deduplication id. */
  id: string;
  eventType: string;
  /** Used as the FIFO message group id to preserve per-aggregate ordering. */
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface MessagePublisher {
  publish(message: PublishableMessage): Promise<void>;
}
