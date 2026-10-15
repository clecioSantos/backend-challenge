import type { Clock } from '../../domain/shared/clock.port';

/** Default clock backed by the host system time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
