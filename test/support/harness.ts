import { MikroORM } from '@mikro-orm/postgresql';
import { loadConfig, type AppConfig } from '../../src/config/env';
import type { Clock } from '../../src/domain/shared/clock.port';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ListWalletLedgerUseCase } from '../../src/application/use-cases/list-wallet-ledger.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { buildMikroOrmConfig } from '../../src/infrastructure/persistence/mikro-orm.config';
import { MikroOrmUnitOfWork } from '../../src/infrastructure/persistence/mikro-orm-unit-of-work';

class MutableClock implements Clock {
  private current = new Date('2026-01-01T00:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export interface Harness {
  orm: MikroORM;
  config: AppConfig;
  clock: MutableClock;
  uow: MikroOrmUnitOfWork;
  createWallet: CreateWalletUseCase;
  processWagerTransaction: ProcessWagerTransactionUseCase;
  listLedger: ListWalletLedgerUseCase;
  reconcile: ReconcileWalletUseCase;
  /** Simula uma instância independente da aplicação compartilhando o mesmo banco de dados. */
  fork(): ProcessWagerTransactionUseCase;
  forkUnitOfWork(): MikroOrmUnitOfWork;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const config = loadConfig();
  const orm = await MikroORM.init(buildMikroOrmConfig({ ...config.database, debug: false }));
  await orm.getMigrator().up();

  const uow = new MikroOrmUnitOfWork(orm);
  const clock = new MutableClock();

  const buildProcessor = (context: MikroOrmUnitOfWork) =>
    new ProcessWagerTransactionUseCase(context, clock, config.pendingReference);

  const reset = async (): Promise<void> => {
    await orm.em.getConnection().execute(
      'truncate table "wallet_ledger_entries", "wager_transactions", "outbox_messages", "inbox_messages", "wallets" cascade',
    );
  };

  return {
    orm,
    config,
    clock,
    uow,
    createWallet: new CreateWalletUseCase(uow, clock),
    processWagerTransaction: buildProcessor(uow),
    listLedger: new ListWalletLedgerUseCase(uow),
    reconcile: new ReconcileWalletUseCase(uow),
    fork: () => buildProcessor(new MikroOrmUnitOfWork(orm)),
    forkUnitOfWork: () => new MikroOrmUnitOfWork(orm),
    reset,
    close: () => orm.close(true),
  };
}

export interface WagerOverrides {
  providerId?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  roundId?: string;
  gameId?: string;
  referenceExternalTransactionId?: string;
}

export function wagerCommand(
  walletId: string,
  playerId: string,
  kind: string,
  amount: string,
  overrides: WagerOverrides = {},
): Parameters<ProcessWagerTransactionUseCase['execute']>[0] {
  const providerId = overrides.providerId ?? 'provider-a';
  const externalTransactionId = overrides.externalTransactionId ?? `tx-${Math.random().toString(36).slice(2)}`;

  return {
    providerId,
    externalTransactionId,
    idempotencyKey: overrides.idempotencyKey ?? `${providerId}:${externalTransactionId}`,
    walletId,
    playerId,
    roundId: overrides.roundId ?? 'round-1',
    gameId: overrides.gameId ?? 'fortune-chimp',
    kind: kind as never,
    money: { amount, currency: 'BRL' },
    referenceExternalTransactionId: overrides.referenceExternalTransactionId,
    correlationId: 'test-correlation',
  };
}
