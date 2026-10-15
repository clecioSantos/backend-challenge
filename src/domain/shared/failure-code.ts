/**
 * Stable, machine-readable failure taxonomy carried by every rejected or
 * failed wager transaction.
 *
 * The codes are intentionally grouped by the action the provider should take:
 *
 *  - `RETRYABLE_*`   -> the provider may resend the very same operation later.
 *  - `PAYLOAD_*`     -> the provider must fix the payload before resending.
 *  - `BUSINESS_*`    -> the operation is impossible given the domain state;
 *                       resending unchanged will never succeed.
 *  - `TERMINAL_*`    -> the operation is permanently impossible for this key.
 *
 * The grouping is documented rather than encoded in the enum name so the wire
 * value stays stable even if the operational guidance is reclassified.
 */
export enum FailureCode {
  // -- wallet resolution ----------------------------------------------------
  WalletNotFound = 'WALLET_NOT_FOUND',
  WalletPlayerMismatch = 'WALLET_PLAYER_MISMATCH',
  WalletCurrencyMismatch = 'WALLET_CURRENCY_MISMATCH',

  // -- balance rules --------------------------------------------------------
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalWouldGoNegative = 'REVERSAL_WOULD_GO_NEGATIVE',

  // -- reference resolution -------------------------------------------------
  ReferenceRequired = 'REFERENCE_REQUIRED',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceKindNotAllowed = 'REFERENCE_KIND_NOT_ALLOWED',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  ReferenceAmountMismatch = 'REFERENCE_AMOUNT_MISMATCH',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',

  // -- request validation ---------------------------------------------------
  InvalidTransactionKind = 'INVALID_TRANSACTION_KIND',
  InvalidAmount = 'INVALID_AMOUNT',
  IdempotencyConflict = 'IDEMPOTENCY_KEY_PAYLOAD_CONFLICT',

  // -- infrastructure -------------------------------------------------------
  InternalError = 'INTERNAL_ERROR',
}

/**
 * Operational guidance attached to a failure code. The value is exposed so a
 * provider can decide whether to resend, fix the payload or give up without
 * parsing human-readable messages.
 */
export type FailureDisposition = 'resend' | 'fix_payload' | 'give_up';

const DISPOSITION: Record<FailureCode, FailureDisposition> = {
  [FailureCode.WalletNotFound]: 'fix_payload',
  [FailureCode.WalletPlayerMismatch]: 'fix_payload',
  [FailureCode.WalletCurrencyMismatch]: 'fix_payload',
  [FailureCode.InsufficientFunds]: 'give_up',
  [FailureCode.ReversalWouldGoNegative]: 'give_up',
  [FailureCode.ReferenceRequired]: 'fix_payload',
  [FailureCode.ReferenceNotFound]: 'give_up',
  [FailureCode.ReferenceNotProcessed]: 'resend',
  [FailureCode.ReferenceKindNotAllowed]: 'fix_payload',
  [FailureCode.ReferenceMismatch]: 'fix_payload',
  [FailureCode.ReferenceAmountMismatch]: 'fix_payload',
  [FailureCode.ReferenceAlreadyReversed]: 'give_up',
  [FailureCode.InvalidTransactionKind]: 'fix_payload',
  [FailureCode.InvalidAmount]: 'fix_payload',
  [FailureCode.IdempotencyConflict]: 'give_up',
  [FailureCode.InternalError]: 'resend',
};

export function dispositionFor(code: FailureCode): FailureDisposition {
  return DISPOSITION[code];
}
