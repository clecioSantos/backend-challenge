import { DomainError } from '../../domain/shared/errors';

/** Raised by the HTTP validation pipe when a request body/query is malformed. */
export class RequestValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
