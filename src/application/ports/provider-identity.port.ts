/**
 * Ponto de extensão de autenticação (seção 2 do desafio).
 *
 * A autenticação está intencionalmente fora do escopo de avaliação. Em vez de
 * um user store feito à mão, o código expõe este port: troque o adapter no-op
 * por um com suporte a OIDC/JWKS (Keycloak, Zitadel, ...) e o restante da
 * aplicação permanece intacto. Consulte ARCHITECTURE.md para o design pretendido.
 */
export interface ProviderIdentity {
  /** Subject do provider autenticado, por exemplo o `providerId`. */
  providerId: string;
  scopes: readonly string[];
}

export interface ProviderIdentityPort {
  /**
   * Resolve a identidade do chamador a partir do contexto de transporte.
   * O adapter padrão sempre retorna `null` (caminho feliz anônimo).
   */
  resolve(context: unknown): Promise<ProviderIdentity | null>;
}
