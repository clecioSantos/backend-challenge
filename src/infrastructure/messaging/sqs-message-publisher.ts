import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { MessagePublisher, PublishableMessage } from '../../application/ports/message-publisher.port';

/**
 * Publica eventos de integração na queue FIFO.
 *
 * `aggregateId` é usado como message group id, o que mantém todos os eventos de
 * uma wallet/transação ordenados, ao mesmo tempo que permite que aggregates
 * diferentes sejam processados em paralelo. O event id também serve como id de
 * deduplicação do broker: um retry do produtor da mesma linha do outbox não
 * consegue enfileirar a mensagem duas vezes.
 */
export class SqsMessagePublisher implements MessagePublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: PublishableMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: message.aggregateId,
        MessageDeduplicationId: message.id,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: message.eventType },
        },
      }),
    );
  }
}
