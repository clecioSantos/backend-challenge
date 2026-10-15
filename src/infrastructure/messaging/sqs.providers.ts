import { SQSClient } from '@aws-sdk/client-sqs';
import type { Provider } from '@nestjs/common';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../config/app-config.provider';

/** Token de injeção para o cliente SQS compartilhado. */
export const SQS_CLIENT = Symbol('SQS_CLIENT');

export const sqsClientProvider: Provider = {
  provide: SQS_CLIENT,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): SQSClient =>
    new SQSClient({
      region: config.sqs.region,
      endpoint: config.sqs.endpoint,
      credentials: {
        accessKeyId: config.sqs.accessKeyId,
        secretAccessKey: config.sqs.secretAccessKey,
      },
    }),
};
