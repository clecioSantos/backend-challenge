import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { MetricsPort } from '../../application/ports/metrics.port';

/** Token for the raw Prometheus registry, exposed by the `/metrics` endpoint. */
export const PROMETHEUS_REGISTRY = Symbol('PROMETHEUS_REGISTRY');

export class PrometheusMetrics implements MetricsPort {
  readonly registry = new Registry();

  private readonly transactions: Counter<'status'>;
  private readonly duplicates: Counter<'source'>;
  private readonly retries: Counter<'component'>;
  private readonly lockConflicts: Counter<'component'>;
  private readonly deadLetters: Counter<'component'>;
  private readonly processingLatency: Histogram;
  private readonly outboxPending: Gauge;
  private readonly outboxLag: Gauge;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'wagering_' });

    this.transactions = new Counter({
      name: 'wagering_transactions_total',
      help: 'Wager transactions observed by terminal status',
      labelNames: ['status'],
      registers: [this.registry],
    });
    this.duplicates = new Counter({
      name: 'wagering_duplicates_total',
      help: 'Duplicated deliveries detected before applying effects',
      labelNames: ['source'],
      registers: [this.registry],
    });
    this.retries = new Counter({
      name: 'wagering_retries_total',
      help: 'Retries scheduled by component',
      labelNames: ['component'],
      registers: [this.registry],
    });
    this.lockConflicts = new Counter({
      name: 'wagering_lock_conflicts_total',
      help: 'Optimistic lock conflicts observed by component',
      labelNames: ['component'],
      registers: [this.registry],
    });
    this.deadLetters = new Counter({
      name: 'wagering_dead_letters_total',
      help: 'Messages routed to the dead letter queue',
      labelNames: ['component'],
      registers: [this.registry],
    });
    this.processingLatency = new Histogram({
      name: 'wagering_processing_seconds',
      help: 'End-to-end transaction processing latency',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({
      name: 'wagering_outbox_pending',
      help: 'Unpublished outbox messages',
      registers: [this.registry],
    });
    this.outboxLag = new Gauge({
      name: 'wagering_outbox_lag_seconds',
      help: 'Age of the oldest unpublished outbox message',
      registers: [this.registry],
    });
  }

  recordTransaction(status: string): void {
    this.transactions.inc({ status });
  }

  recordDuplicate(source: string): void {
    this.duplicates.inc({ source });
  }

  recordRetry(component: string): void {
    this.retries.inc({ component });
  }

  recordLockConflict(component: string): void {
    this.lockConflicts.inc({ component });
  }

  recordDeadLetter(component: string): void {
    this.deadLetters.inc({ component });
  }

  observeProcessingLatency(seconds: number): void {
    this.processingLatency.observe(seconds);
  }

  setOutboxPending(count: number): void {
    this.outboxPending.set(count);
  }

  setOutboxLag(milliseconds: number): void {
    this.outboxLag.set(milliseconds / 1000);
  }
}
