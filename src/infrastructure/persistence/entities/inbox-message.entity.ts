import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'string', length: 128, fieldName: 'consumer_name' })
  consumerName!: string;

  @PrimaryKey({ type: 'string', length: 128, fieldName: 'message_id' })
  messageId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'received_at' })
  receivedAt!: Date;

  @Index({ name: 'inbox_messages_processed_at_idx' })
  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'processed_at', nullable: true })
  processedAt?: Date | null;
}
