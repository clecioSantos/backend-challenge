import type { Provider } from '@nestjs/common';
import { loadConfig, type AppConfig } from '../../config/env';

/** Injection token for the validated application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider: Provider = {
  provide: APP_CONFIG,
  useFactory: (): AppConfig => loadConfig(),
};
