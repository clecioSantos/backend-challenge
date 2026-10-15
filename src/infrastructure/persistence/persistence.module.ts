import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import type { AppConfig } from '../../config/env';
import { UNIT_OF_WORK } from '../../application/ports/tokens';
import { APP_CONFIG } from '../config/app-config.provider';
import { buildMikroOrmConfig } from './mikro-orm.config';
import { MikroOrmUnitOfWork } from './mikro-orm-unit-of-work';

/**
 * Owns the MikroORM lifecycle and exposes the `UnitOfWork` port. The ORM
 * instance is provided directly (instead of going through `MikroOrmModule`) so
 * the application fully controls connection and shutdown semantics and no
 * request-scoped EntityManager is created behind our back.
 */
@Module({
  providers: [
    {
      provide: MikroORM,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => MikroORM.init(buildMikroOrmConfig(config.database)),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [MikroORM],
      useFactory: (orm: MikroORM) => new MikroOrmUnitOfWork(orm),
    },
  ],
  exports: [MikroORM, UNIT_OF_WORK],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    if (await this.orm.isConnected()) {
      await this.orm.close(true);
    }
  }
}
