import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { ProviderIdentityPort } from '../../application/ports/provider-identity.port';
import { PROVIDER_IDENTITY } from '../../application/ports/tokens';

/**
 * Ponto de extensão de autenticação. Resolve o chamador por meio de
 * `ProviderIdentityPort` e anexa a identidade à request, mas não
 * bloqueia acesso anônimo — o desafio trata a autenticação como fora de escopo
 * e exige que o ponto de extensão permaneça explícito. Endpoints de health não
 * usam este guard.
 */
@Injectable()
export class ProviderIdentityGuard implements CanActivate {
  constructor(@Inject(PROVIDER_IDENTITY) private readonly identityPort: ProviderIdentityPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ provider?: unknown }>();
    const identity = await this.identityPort.resolve(request);
    if (identity) {
      request.provider = identity;
    }
    return true;
  }
}
