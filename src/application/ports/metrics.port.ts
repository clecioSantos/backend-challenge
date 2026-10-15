/**
 * Application-facing metrics port. The application never imports a metrics
 * library directly; the infrastructure adapter maps these calls to the chosen
 * backend (Prometheus here).
 */
export interface MetricsPort {
  recordTransaction(status: string): void;
  recordDuplicate(source: string): void;
  recordRetry(component: string): void;
  recordLockConflict(component: string): void;
  recordDeadLetter(component: string): void;
  observeProcessingLatency(seconds: number): void;
  setOutboxPending(count: number): void;
  setOutboxLag(milliseconds: number): void;
}
