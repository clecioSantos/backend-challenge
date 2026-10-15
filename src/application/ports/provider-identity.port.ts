/**
 * Authentication extension point (challenge section 2).
 *
 * Authentication is intentionally out of scope for scoring. Instead of a
 * hand-rolled user store, the code exposes this port: swap the no-op adapter
 * for an OIDC/JWKS-backed one (Keycloak, Zitadel, ...) and the rest of the
 * application is untouched. See ARCHITECTURE.md for the intended design.
 */
export interface ProviderIdentity {
  /** Subject of the authenticated provider, e.g. the `providerId`. */
  providerId: string;
  scopes: readonly string[];
}

export interface ProviderIdentityPort {
  /**
   * Resolves the caller identity from the transport context.
   * The default adapter always returns `null` (anonymous happy path).
   */
  resolve(context: unknown): Promise<ProviderIdentity | null>;
}
