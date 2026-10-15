import type { Clock } from '../../domain/shared/clock.port';

/** Clock padrão respaldado pelo horário do sistema host. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
