import { InboxMessage } from '../../../domain/inbox/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export const InboxMapper = {
  toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt ?? undefined,
    });
  },

  toNewEntity(message: InboxMessage): InboxMessageEntity {
    const entity = new InboxMessageEntity();
    entity.messageId = message.messageId;
    entity.consumerName = message.consumerName;
    entity.payloadHash = message.payloadHash;
    entity.receivedAt = message.receivedAt;
    entity.processedAt = message.processedAt ?? null;
    return entity;
  },
};
