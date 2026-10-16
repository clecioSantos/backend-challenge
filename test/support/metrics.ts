import type { MetricsPort } from '../../src/application/ports/metrics.port';

/** Implementação no-op usada quando o teste não observa métricas. */
export const noopMetrics: MetricsPort = {
  recordTransaction: () => {},
  recordDuplicate: () => {},
  recordRetry: () => {},
  recordLockConflict: () => {},
  recordDeadLetter: () => {},
  recordReconciliationDivergence: () => {},
  observeProcessingLatency: () => {},
  setOutboxPending: () => {},
  setOutboxLag: () => {},
};

export interface RecordingMetrics extends MetricsPort {
  readonly lockConflicts: number;
  readonly reconciliationDivergences: readonly string[];
  readonly retries: number;
  readonly deadLetters: number;
}

/** Coleta as emissões de métricas para asserção nos testes. */
export function createRecordingMetrics(): RecordingMetrics {
  let lockConflicts = 0;
  let retries = 0;
  let deadLetters = 0;
  const reconciliationDivergences: string[] = [];

  return {
    get lockConflicts() {
      return lockConflicts;
    },
    get reconciliationDivergences() {
      return reconciliationDivergences;
    },
    get retries() {
      return retries;
    },
    get deadLetters() {
      return deadLetters;
    },
    recordTransaction: () => {},
    recordDuplicate: () => {},
    recordRetry: () => {
      retries += 1;
    },
    recordLockConflict: () => {
      lockConflicts += 1;
    },
    recordDeadLetter: () => {
      deadLetters += 1;
    },
    recordReconciliationDivergence: (currency) => {
      reconciliationDivergences.push(currency);
    },
    observeProcessingLatency: () => {},
    setOutboxPending: () => {},
    setOutboxLag: () => {},
  };
}
