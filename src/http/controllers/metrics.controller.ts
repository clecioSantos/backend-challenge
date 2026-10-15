import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { Registry } from 'prom-client';
import { PROMETHEUS_REGISTRY } from '../../infrastructure/observability/prometheus-metrics';

@Controller()
export class MetricsController {
  constructor(@Inject(PROMETHEUS_REGISTRY) private readonly registry: Registry) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
