import type { FailureCode } from './failure-code';

/**
 * Base class for every error that expresses a broken domain rule or an
 * expected business outcome. Infrastructure errors (network, SQL, broker)
 * must not extend this type so the application layer can tell "the request is
 * invalid" apart from "the world is temporarily broken".
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';

  constructor(reason: string, readonly value: unknown) {
    super(`Invalid money value: ${reason}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(readonly expected: string, readonly received: string) {
    super(`Currency mismatch: expected ${expected}, received ${received}`);
  }
}

export class InvalidLedgerEntryError extends DomainError {
  readonly code = 'INVALID_LEDGER_ENTRY';

  constructor(reason: string) {
    super(`Invalid ledger entry: ${reason}`);
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(
    readonly walletId: string,
    readonly available: string,
    readonly requested: string,
  ) {
    super(`Wallet ${walletId} has available ${available} but ${requested} was requested`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(
    readonly transactionId: string,
    readonly status: string,
    readonly attemptedTransition: string,
  ) {
    super(`Cannot ${attemptedTransition} transaction ${transactionId} in terminal state ${status}`);
  }
}

export class UnsupportedTransactionKindError extends DomainError {
  readonly code = 'UNSUPPORTED_TRANSACTION_KIND';

  constructor(readonly kind: string) {
    super(`Transaction kind ${kind} cannot be submitted through the public interfaces`);
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(
    readonly idempotencyKey: string,
    readonly existingTransactionId: string,
  ) {
    super(`Idempotency key ${idempotencyKey} was already used with a different payload`);
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
  }
}

export class WagerTransactionNotFoundError extends DomainError {
  readonly code = 'WAGER_TRANSACTION_NOT_FOUND';

  constructor(readonly transactionId: string) {
    super(`Wager transaction ${transactionId} was not found`);
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(readonly playerId: string, readonly currency: string) {
    super(`A ${currency} wallet already exists for player ${playerId}`);
  }
}

// -- reference related -------------------------------------------------------

export class ReferenceRequiredError extends DomainError {
  readonly code = 'REFERENCE_REQUIRED';

  constructor(readonly kind: string) {
    super(`Transaction kind ${kind} requires a referenceExternalTransactionId`);
  }
}

export class UnexpectedReferenceError extends DomainError {
  readonly code = 'UNEXPECTED_REFERENCE';

  constructor(readonly kind: string) {
    super(`Transaction kind ${kind} must not carry a referenceExternalTransactionId`);
  }
}

export class ReferenceNotFoundError extends DomainError {
  readonly code = 'REFERENCE_NOT_FOUND';

  constructor(readonly referenceExternalTransactionId: string) {
    super(`Referenced transaction ${referenceExternalTransactionId} was not found`);
  }
}

export class ReferenceNotProcessedError extends DomainError {
  readonly code = 'REFERENCE_NOT_PROCESSED';

  constructor(
    readonly referenceExternalTransactionId: string,
    readonly referenceStatus: string,
  ) {
    super(`Reference ${referenceExternalTransactionId} is not processed (status ${referenceStatus})`);
  }
}

export class ReferenceKindNotAllowedError extends DomainError {
  readonly code = 'REFERENCE_KIND_NOT_ALLOWED';

  constructor(readonly kind: string, readonly referenceKind: string) {
    super(`${kind} cannot reference a ${referenceKind} transaction`);
  }
}

export class ReferenceMismatchError extends DomainError {
  readonly code = 'REFERENCE_MISMATCH';

  constructor(readonly reason: string) {
    super(`Reference does not belong to the same scope: ${reason}`);
  }
}

export class ReferenceAmountMismatchError extends DomainError {
  readonly code = 'REFERENCE_AMOUNT_MISMATCH';

  constructor(readonly expected: string, readonly received: string) {
    super(`Reversal amount ${received} does not match reference amount ${expected}`);
  }
}

export class ReferenceAlreadyReversedError extends DomainError {
  readonly code = 'REFERENCE_ALREADY_REVERSED';

  constructor(
    readonly referenceExternalTransactionId: string,
    readonly reversalKind: string,
  ) {
    super(`Reference ${referenceExternalTransactionId} was already reversed by a ${reversalKind}`);
  }
}

// -- technical ---------------------------------------------------------------

export class OptimisticLockError extends DomainError {
  readonly code = 'OPTIMISTIC_LOCK_CONFLICT';

  constructor(readonly entity: string, readonly id: string) {
    super(`${entity} ${id} was concurrently modified`);
  }
}

export class UniqueConstraintViolationError extends DomainError {
  readonly code = 'UNIQUE_CONSTRAINT_VIOLATION';

  constructor(readonly constraint: string) {
    super(`Unique constraint ${constraint} was violated`);
  }
}

export class InfrastructureError extends Error {
  constructor(message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message, options);
    this.name = 'InfrastructureError';
    this.retryable = options?.retryable ?? true;
  }

  readonly retryable: boolean;
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export type { FailureCode };
