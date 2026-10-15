import { Module } from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { AppConfig } from '../config/env';
import { MESSAGE_PUBLISHER } from '../application/ports/tokens';
import { APP_CONFIG } from '../infrastructure/config/app-config.provider';
import { SQS_CLIENT, sqsClientProvider } from '../infrastructure/messaging/sqs.providers';
import { SqsMessagePublisher } from '../infrastructure/messaging/sqs-message-publisher';
import { SqsConsumerService } from '../infrastructure/messaging/sqs-consumer.service';
import { WageringModule } from './wagering.module';

@Module({
  imports: [WageringModule],
  providers: [
    sqsClientProvider,
    {
      provide: MESSAGE_PUBLISHER,
      inject: [SQS_CLIENT, APP_CONFIG],
      useFactory: (client: SQSClient, config: AppConfig) =>
        new SqsMessagePublisher(client, config.sqs.queueUrl),
    },
    SqsConsumerService,
  ],
  exports: [SQS_CLIENT, MESSAGE_PUBLISHER],
})
export class MessagingModule {}
