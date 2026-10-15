import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { OutboxPublisherWorker } from '../infrastructure/workers/outbox-publisher.worker';
import { PendingReferenceWorker } from '../infrastructure/workers/pending-reference.worker';
import { MessagingModule } from './messaging.module';
import { WageringModule } from './wagering.module';

/** Background workers that drain the outbox and retry pending references. */
@Module({
  imports: [PersistenceModule, WageringModule, MessagingModule],
  providers: [OutboxPublisherWorker, PendingReferenceWorker],
})
export class WorkersModule {}
