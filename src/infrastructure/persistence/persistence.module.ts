import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import type { AppConfig } from '../../config/env';
import type { MetricsPort } from '../../application/ports/metrics.port';
import { METRICS, UNIT_OF_WORK } from '../../application/ports/tokens';
import { APP_CONFIG } from '../config/app-config.provider';
import { buildMikroOrmConfig } from './mikro-orm.config';
import { MikroOrmUnitOfWork } from './mikro-orm-unit-of-work';

/**
 * É responsável pelo ciclo de vida do MikroORM e expõe a port `UnitOfWork`. A instância do ORM
 * é fornecida diretamente (em vez de passar pelo `MikroOrmModule`) para que
 * a aplicação controle totalmente a conexão e a semântica de shutdown e nenhum
 * EntityManager com escopo de requisição seja criado por trás dos panos.
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
      inject: [MikroORM, METRICS],
      useFactory: (orm: MikroORM, metrics: MetricsPort) => new MikroOrmUnitOfWork(orm, metrics),
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
