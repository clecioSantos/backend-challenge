import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { ProviderIdentityPort } from '../../application/ports/provider-identity.port';
import { PROVIDER_IDENTITY } from '../../application/ports/tokens';

/**
 * Authentication extension point. It resolves the caller through
 * `ProviderIdentityPort` and attaches the identity to the request, but does not
 * block anonymous access — the challenge treats authentication as out of scope
 * and requires the extension point to stay explicit. Health endpoints do not
 * use this guard.
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
