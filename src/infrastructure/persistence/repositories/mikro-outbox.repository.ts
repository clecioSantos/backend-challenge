import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/postgresql';
import type { OutboxMessage } from '../../../domain/outbox/outbox-message';
import type { OutboxRepository } from '../../../domain/outbox/outbox.repository';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';
import { OutboxMapper } from '../mappers/outbox.mapper';

export class MikroOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(message: OutboxMessage): Promise<void> {
    this.em.persist(OutboxMapper.toNewEntity(message));
  }

  async lockDueForUpdate(now: Date, limit: number): Promise<OutboxMessage[]> {
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: { occurredAt: 'asc' },
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );

    return entities.map((entity) => OutboxMapper.toDomain(entity));
  }

  async save(message: OutboxMessage): Promise<void> {
    const entity = await this.em.findOneOrFail(OutboxMessageEntity, { id: message.id });
    OutboxMapper.apply(message, entity);
  }

  async countPending(): Promise<number> {
    return this.em.count(OutboxMessageEntity, { publishedAt: null });
  }

  async oldestPendingAgeMs(now: Date): Promise<number | null> {
    const rows = await this.em.execute<{ oldest: Date | null }[]>(
      `select min("occurred_at") as oldest from "outbox_messages" where "published_at" is null`,
    );

    const oldest = rows[0]?.oldest;
    if (oldest === null || oldest === undefined) {
      return null;
    }

    return now.getTime() - new Date(oldest).getTime();
  }
}
