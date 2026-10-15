import { ReflectMetadataProvider } from '@mikro-orm/core';
import { defineConfig, type Options } from '@mikro-orm/postgresql';
import type { DatabaseConfig } from '../../config/env';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { WalletEntity } from './entities/wallet.entity';

export const entities = [
  WalletEntity,
  WagerTransactionEntity,
  WalletLedgerEntryEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];

export interface MikroOrmConfigOptions extends DatabaseConfig {
  debug?: boolean;
}

/**
 * MikroORM connection options. Schema is owned by versioned migrations under
 * `/migrations`; the entities only describe the mapping so the unit of work
 * and identity map can operate.
 */
export function buildMikroOrmConfig(options: MikroOrmConfigOptions): Options {
  return defineConfig({
    entities,
    metadataProvider: ReflectMetadataProvider,
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    dbName: options.name,
    pool: { min: options.poolMin, max: options.poolMax },
    driverOptions: {
      connection: {
        statement_timeout: options.statementTimeoutMs,
        lock_timeout: options.lockTimeoutMs,
      },
    },
    migrations: {
      path: './migrations',
      pathTs: './migrations',
      glob: '!(*.d).{js,ts}',
      transactional: true,
      allOrNothing: true,
      emit: 'ts',
      snapshot: true,
    },
    debug: options.debug ?? false,
    forceUtcTimezone: true,
    schemaGenerator: { disableForeignKeys: false },
  });
}
