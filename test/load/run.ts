/**
 * Experimento de carga.
 *
 * Executa o caminho real de processamento (use case -> transações PostgreSQL) com um
 * pool de workers fixo, depois reporta throughput, percentis de latência, taxa de erro,
 * conflitos de lock, lag do outbox e uma reconciliação final do ledger. Ele conversa com o
 * mesmo código que o ingress HTTP usa e nunca faz mock do banco de dados.
 *
 * Uso:
 *   bun run test:load
 *
 * Ambiente (valores padrão mostrados):
 *   LOAD_WALLETS=20  LOAD_OPERATIONS=2000  LOAD_CONCURRENCY=50  LOAD_AMOUNT=1.00
 */
import { createHarness, wagerCommand } from '../support/harness';

const walletsCount = Number(process.env.LOAD_WALLETS ?? '20');
const operations = Number(process.env.LOAD_OPERATIONS ?? '2000');
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? '50');
const amount = process.env.LOAD_AMOUNT ?? '1.00';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const harness = await createHarness();
  await harness.reset();

  const wallets = await Promise.all(
    Array.from({ length: walletsCount }, () =>
      harness.createWallet.execute({
        playerId: crypto.randomUUID(),
        initialBalance: { amount: '1000000.00', currency: 'BRL' },
      }),
    ),
  );

  const latencies: number[] = [];
  let processed = 0;
  let rejected = 0;
  let errors = 0;
  let lockConflicts = 0;
  let next = 0;

  const startedAt = performance.now();

  const worker = async (): Promise<void> => {
    const processor = harness.fork();
    while (true) {
      const index = next++;
      if (index >= operations) {
        return;
      }

      const wallet = wallets[index % wallets.length]!;
      const externalTransactionId = `load-${index}`;
      const operationStartedAt = performance.now();

      try {
        const outcome = await processor.execute(
          wagerCommand(wallet.id, wallet.playerId, 'BET', amount, {
            externalTransactionId,
            roundId: `round-${index}`,
          }),
        );
        if (outcome.outcome === 'processed') {
          processed += 1;
        } else {
          rejected += 1;
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
          lockConflicts += 1;
        } else {
          errors += 1;
        }
      } finally {
        latencies.push(performance.now() - operationStartedAt);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const elapsedMs = performance.now() - startedAt;
  const sorted = [...latencies].sort((a, b) => a - b);

  const snapshot = await harness.uow.read(async (tx) => ({
    pending: await tx.outbox.countPending(),
    lagMs: await tx.outbox.oldestPendingAgeMs(harness.clock.now()),
  }));

  let inconsistent = 0;
  for (const wallet of wallets) {
    const reconciliation = await harness.reconcile.execute(wallet.id);
    if (!reconciliation.consistent) {
      inconsistent += 1;
    }
  }

  const report = {
    environment: {
      wallets: walletsCount,
      operations,
      concurrency,
      amount,
      currency: harness.config.defaultCurrency,
    },
    throughput: {
      operationsPerSecond: Number(((operations / elapsedMs) * 1000).toFixed(2)),
      elapsedMs: Number(elapsedMs.toFixed(2)),
    },
    latencyMs: {
      p50: Number(percentile(sorted, 50).toFixed(3)),
      p95: Number(percentile(sorted, 95).toFixed(3)),
      p99: Number(percentile(sorted, 99).toFixed(3)),
      max: Number((sorted.at(-1) ?? 0).toFixed(3)),
    },
    outcomes: {
      processed,
      rejected,
      errors,
      errorRate: Number(((errors / operations) * 100).toFixed(3)),
      lockConflicts,
    },
    outbox: {
      pending: snapshot.pending,
      oldestLagMs: snapshot.lagMs,
    },
    reconciliation: {
      walletsChecked: wallets.length,
      inconsistent,
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  await harness.close();

  if (inconsistent > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
