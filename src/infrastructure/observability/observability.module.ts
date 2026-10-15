import { Global, Module } from '@nestjs/common';
import { METRICS } from '../../application/ports/tokens';
import { PROMETHEUS_REGISTRY, PrometheusMetrics } from './prometheus-metrics';

const metrics = new PrometheusMetrics();

@Global()
@Module({
  providers: [
    { provide: METRICS, useValue: metrics },
    { provide: PROMETHEUS_REGISTRY, useValue: metrics.registry },
  ],
  exports: [METRICS, PROMETHEUS_REGISTRY],
})
export class ObservabilityModule {}
