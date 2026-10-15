import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MetricsPort } from '../../application/ports/metrics.port';
import { METRICS, UNIT_OF_WORK } from '../../application/ports/tokens';
import type { UnitOfWork } from '../../application/ports/unit-of-work.port';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case';
import { WagerTransactionStatus } from '../../domain/wager-transaction/wager-transaction';
import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../config/app-config.provider';
import { startIntervalLoop, type IntervalLoop } from './interval-loop';

/**
 * Impulsiona transações `PENDING_REFERENCE` adiante.
 *
 * Ele apenas descobre ids vencidos em uma transação curta e então reproduz cada
 * um através do mesmo use case dos caminhos de ingresso. O use case trava
 * novamente a wallet e a linha da transação, então dois workers disputando o
 * mesmo id são serializados e o perdedor observa o estado terminal e não faz
 * nada.
 */
@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private readonly config: AppConfig['pendingReference'];
  private loop: IntervalLoop | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly useCase: ProcessWagerTransactionUseCase,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.config = config.pendingReference;
  }

  onModuleInit(): void {
    this.loop = startIntervalLoop({
      intervalMs: this.config.pollIntervalMs,
      run: () => this.tick(),
      onError: (error) => this.logger.error({ err: error }, 'Pending reference worker tick failed'),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop?.stop();
  }

  private async tick(): Promise<void> {
    const due = await this.uow.read(async (tx) =>
      tx.wagerTransactions.findPendingReferenceDue({ now: new Date(), limit: 100 }),
    );

    for (const transaction of due) {
      try {
        const outcome = await this.useCase.resume(transaction.id);
        if (outcome === 'processed') {
          this.metrics.recordTransaction(WagerTransactionStatus.Processed);
        } else if (outcome === 'rejected') {
          this.metrics.recordTransaction(WagerTransactionStatus.Rejected);
        }
      } catch (error) {
        this.logger.error(
          { transactionId: transaction.id, err: error },
          'Failed to resume pending-reference transaction',
        );
      }
    }
  }
}
