import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, appConfigProvider } from './app-config.provider';

/**
 * Loads and validates the environment once, then exposes it as a single
 * immutable value. Marked global so feature modules do not have to import it
 * explicitly just to read configuration.
 */
@Global()
@Module({
  providers: [appConfigProvider],
  exports: [APP_CONFIG],
})
export class ConfigurationModule {}
