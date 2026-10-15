import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/env';
import { UNIT_OF_WORK, CLOCK, PROVIDER_IDENTITY } from '../application/ports/tokens';
import type { UnitOfWork } from '../application/ports/unit-of-work.port';
import type { Clock } from '../domain/shared/clock.port';
import { CreateWalletUseCase } from '../application/use-cases/create-wallet.use-case';
import { GetWalletUseCase } from '../application/use-cases/get-wallet.use-case';
import { ListWalletLedgerUseCase } from '../application/use-cases/list-wallet-ledger.use-case';
import { ReconcileWalletUseCase } from '../application/use-cases/reconcile-wallet.use-case';
import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionUseCase,
} from '../application/use-cases/get-wager-transaction.use-case';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/process-wager-transaction.use-case';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { APP_CONFIG } from '../infrastructure/config/app-config.provider';
import { AnonymousProviderIdentityAdapter } from '../infrastructure/auth/anonymous-provider-identity.adapter';
import { SystemClock } from '../infrastructure/time/system-clock';
import { WalletsController } from '../http/controllers/wallets.controller';
import { WageringController } from '../http/controllers/wagering.controller';
import { ProvidersController } from '../http/controllers/providers.controller';
import { ProviderIdentityGuard } from '../http/guards/provider-identity.guard';

/**
 * Wires the application use cases and the HTTP ingress. Use cases are built
 * with explicit factories so their ports (interfaces, no runtime value) can be
 * injected by token.
 */
@Module({
  imports: [PersistenceModule],
  controllers: [WalletsController, WageringController, ProvidersController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: PROVIDER_IDENTITY, useClass: AnonymousProviderIdentityAdapter },
    ProviderIdentityGuard,
    {
      provide: CreateWalletUseCase,
      inject: [UNIT_OF_WORK, CLOCK],
      useFactory: (uow: UnitOfWork, clock: Clock) => new CreateWalletUseCase(uow, clock),
    },
    {
      provide: ProcessWagerTransactionUseCase,
      inject: [UNIT_OF_WORK, CLOCK, APP_CONFIG],
      useFactory: (uow: UnitOfWork, clock: Clock, config: AppConfig) =>
        new ProcessWagerTransactionUseCase(uow, clock, config.pendingReference),
    },
    {
      provide: GetWalletUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (uow: UnitOfWork) => new GetWalletUseCase(uow),
    },
    {
      provide: ListWalletLedgerUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (uow: UnitOfWork) => new ListWalletLedgerUseCase(uow),
    },
    {
      provide: ReconcileWalletUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (uow: UnitOfWork) => new ReconcileWalletUseCase(uow),
    },
    {
      provide: GetWagerTransactionUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (uow: UnitOfWork) => new GetWagerTransactionUseCase(uow),
    },
    {
      provide: GetProviderWagerTransactionUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (uow: UnitOfWork) => new GetProviderWagerTransactionUseCase(uow),
    },
  ],
  exports: [
    ProcessWagerTransactionUseCase,
    CreateWalletUseCase,
    GetWalletUseCase,
    ListWalletLedgerUseCase,
    ReconcileWalletUseCase,
    GetWagerTransactionUseCase,
    GetProviderWagerTransactionUseCase,
    CLOCK,
  ],
})
export class WageringModule {}
