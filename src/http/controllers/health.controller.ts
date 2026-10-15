import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import type { Response } from 'express';
import type { AppConfig } from '../../config/env';
import { SQS_CLIENT } from '../../infrastructure/messaging/sqs.providers';
import { APP_CONFIG } from '../../infrastructure/config/app-config.provider';

interface ReadinessChecks {
  postgres: boolean;
  sqs: boolean;
}

/**
 * Liveness prova que o processo está de pé; readiness adicionalmente prova que as duas
 * dependências críticas (PostgreSQL e SQS) estão acessíveis. Endpoints de health são abertos —
 * eles intencionalmente não usam o guard de autenticação.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const checks = await this.check();

    if (!checks.postgres || !checks.sqs) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable', checks };
    }

    return { status: 'ok', checks };
  }

  private async check(): Promise<ReadinessChecks> {
    const [postgres, sqs] = await Promise.all([this.checkPostgres(), this.checkSqs()]);
    return { postgres, sqs };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.orm.em.getConnection().execute('select 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkSqs(): Promise<boolean> {
    try {
      await this.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.sqs.queueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
