import type { ProviderIdentity, ProviderIdentityPort } from '../../application/ports/provider-identity.port';

/**
 * Default adapter: no external identity provider is wired in this challenge, so
 * every caller is anonymous. Swapping this class for an OIDC/JWKS-backed
 * adapter (Keycloak, Zitadel, ...) is the only change required to enforce
 * authentication; the guard and the rest of the application stay the same.
 */
export class AnonymousProviderIdentityAdapter implements ProviderIdentityPort {
  async resolve(): Promise<ProviderIdentity | null> {
    return null;
  }
}
