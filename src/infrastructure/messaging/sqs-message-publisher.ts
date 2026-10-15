import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { MessagePublisher, PublishableMessage } from '../../application/ports/message-publisher.port';

/**
 * Publishes integration events to the FIFO queue.
 *
 * `aggregateId` is used as the message group id, which keeps all events for a
 * wallet/transaction ordered while still allowing different aggregates to be
 * processed in parallel. The event id doubles as the broker deduplication id:
 * a producer retry of the same outbox row cannot enqueue the message twice.
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
