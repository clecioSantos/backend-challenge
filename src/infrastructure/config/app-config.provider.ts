import type { Provider } from '@nestjs/common';
import { loadConfig, type AppConfig } from '../../config/env';

/** Token de injeção para a configuração validada da aplicação. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export const appConfigProvider: Provider = {
  provide: APP_CONFIG,
  useFactory: (): AppConfig => loadConfig(),
};
