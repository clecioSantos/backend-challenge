import { OutboxMessage } from '../../../domain/outbox/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export const OutboxMapper = {
  toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
    });
  },

  toNewEntity(message: OutboxMessage): OutboxMessageEntity {
    return OutboxMapper.apply(message, new OutboxMessageEntity());
  },

  apply(message: OutboxMessage, entity: OutboxMessageEntity): OutboxMessageEntity {
    entity.id = message.id;
    entity.aggregateId = message.aggregateId;
    entity.eventType = message.eventType;
    entity.payload = message.payload as Record<string, unknown>;
    entity.occurredAt = message.occurredAt;
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt ?? null;
    entity.publishedAt = message.publishedAt ?? null;
    return entity;
  },
};
