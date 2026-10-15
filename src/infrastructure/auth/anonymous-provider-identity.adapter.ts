import type { ProviderIdentity, ProviderIdentityPort } from '../../application/ports/provider-identity.port';

/**
 * Adapter padrão: nenhum provedor de identidade externo está conectado neste
 * desafio, então todo chamador é anônimo. Trocar esta classe por um adapter
 * respaldado em OIDC/JWKS (Keycloak, Zitadel, ...) é a única mudança
 * necessária para impor autenticação; o guard e o restante da aplicação
 * permanecem iguais.
 */
export class AnonymousProviderIdentityAdapter implements ProviderIdentityPort {
  async resolve(): Promise<ProviderIdentity | null> {
    return null;
  }
}
