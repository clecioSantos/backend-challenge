import { DomainError } from '../../domain/shared/errors';

/** Lançado pelo pipe de validação HTTP quando o body/query de uma request está malformado. */
export class RequestValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}
