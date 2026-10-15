import type { EntityManager } from '@mikro-orm/postgresql';
import type { InboxMessage } from '../../../domain/inbox/inbox-message';
import type { InboxRepository } from '../../../domain/inbox/inbox.repository';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxMapper } from '../mappers/inbox.mapper';

export class MikroInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async find(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, { consumerName, messageId });
    return entity ? InboxMapper.toDomain(entity) : null;
  }

  async insertIfAbsent(message: InboxMessage): Promise<boolean> {
    // ON CONFLICT DO NOTHING keeps the surrounding transaction healthy when a
    // concurrent consumer already claimed the same message. `em.execute` runs on
    // the transaction context, so the claim commits and rolls back with the
    // financial effects it guards.
    const rows = await this.em.execute<{ inserted: number }[]>(
      `insert into "inbox_messages" ("consumer_name", "message_id", "payload_hash", "received_at", "processed_at")
       values (?, ?, ?, ?, ?)
       on conflict ("consumer_name", "message_id") do nothing
       returning 1 as inserted`,
      [
        message.consumerName,
        message.messageId,
        message.payloadHash,
        message.receivedAt,
        message.processedAt ?? null,
      ],
    );

    return rows.length > 0;
  }

  async markProcessed(consumerName: string, messageId: string, processedAt: Date): Promise<void> {
    await this.em.nativeUpdate(
      InboxMessageEntity,
      { consumerName, messageId },
      { processedAt },
    );
  }
}
