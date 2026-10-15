import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, appConfigProvider } from './app-config.provider';

/**
 * Carrega e valida o ambiente uma única vez, então o expõe como um único valor
 * imutável. Marcado como global para que os módulos de funcionalidade não
 * precisem importá-lo explicitamente apenas para ler configuração.
 */
@Global()
@Module({
  providers: [appConfigProvider],
  exports: [APP_CONFIG],
})
export class ConfigurationModule {}
