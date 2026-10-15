import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { HealthController } from '../http/controllers/health.controller';
import { MetricsController } from '../http/controllers/metrics.controller';
import { MessagingModule } from './messaging.module';

@Module({
  imports: [PersistenceModule, MessagingModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
