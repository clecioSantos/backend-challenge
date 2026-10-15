import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from './config/env';
import { ConfigurationModule } from './infrastructure/config/configuration.module';
import { APP_CONFIG } from './infrastructure/config/app-config.provider';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { buildLoggerParams } from './infrastructure/observability/logger.config';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { HealthModule } from './modules/health.module';
import { MessagingModule } from './modules/messaging.module';
import { WageringModule } from './modules/wagering.module';
import { WorkersModule } from './modules/workers.module';

@Module({
  imports: [
    ConfigurationModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildLoggerParams(config.logLevel, config.appName),
    }),
    ObservabilityModule,
    PersistenceModule,
    WageringModule,
    MessagingModule,
    WorkersModule,
    HealthModule,
  ],
})
export class AppModule {}
