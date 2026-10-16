/**
 * Port de métricas voltado para a aplicação. A aplicação nunca importa uma
 * biblioteca de métricas diretamente; o adapter de infraestrutura mapeia estas
 * chamadas para o backend escolhido (Prometheus aqui).
 */
export interface MetricsPort {
  recordTransaction(status: string): void;
  recordDuplicate(source: string): void;
  recordRetry(component: string): void;
  recordLockConflict(component: string): void;
  recordDeadLetter(component: string): void;
  recordReconciliationDivergence(currency: string): void;
  observeProcessingLatency(seconds: number): void;
  setOutboxPending(count: number): void;
  setOutboxLag(milliseconds: number): void;
}
