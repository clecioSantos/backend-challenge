import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid', fieldName: 'id' })
  id!: string;

  @Property({ type: 'string', length: 128, fieldName: 'aggregate_id' })
  aggregateId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'event_type' })
  eventType!: string;

  @Property({ type: 'json', columnType: 'jsonb', fieldName: 'payload' })
  payload!: Record<string, unknown>;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'occurred_at' })
  occurredAt!: Date;

  @Index({ name: 'outbox_messages_pending_idx' })
  @Property({ type: 'integer', fieldName: 'attempts', default: 0 })
  attempts = 0;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'next_attempt_at', nullable: true })
  nextAttemptAt?: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'published_at', nullable: true })
  publishedAt?: Date | null;
}
