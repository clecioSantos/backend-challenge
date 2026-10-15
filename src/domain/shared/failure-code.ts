/**
 * Taxonomia de falhas estável e legível por máquina, carregada por toda wager
 * transaction rejeitada ou que falhou.
 *
 * Os códigos são intencionalmente agrupados pela ação que o provider deve
 * tomar:
 *
 *  - `RETRYABLE_*`   -> o provider pode reenviar a mesma operação mais tarde.
 *  - `PAYLOAD_*`     -> o provider deve corrigir o payload antes de reenviar.
 *  - `BUSINESS_*`    -> a operação é impossível dado o estado do domínio;
 *                       reenviar sem alterações nunca terá sucesso.
 *  - `TERMINAL_*`    -> a operação é permanentemente impossível para esta chave.
 *
 * O agrupamento é documentado em vez de codificado no nome do enum, para que
 * o valor transmitido permaneça estável mesmo que a orientação operacional
 * seja reclassificada.
 */
export enum FailureCode {
  // -- resolução de wallet --------------------------------------------------
  WalletNotFound = 'WALLET_NOT_FOUND',
  WalletPlayerMismatch = 'WALLET_PLAYER_MISMATCH',
  WalletCurrencyMismatch = 'WALLET_CURRENCY_MISMATCH',

  // -- regras de saldo ------------------------------------------------------
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalWouldGoNegative = 'REVERSAL_WOULD_GO_NEGATIVE',

  // -- resolução de referência ----------------------------------------------
  ReferenceRequired = 'REFERENCE_REQUIRED',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceKindNotAllowed = 'REFERENCE_KIND_NOT_ALLOWED',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  ReferenceAmountMismatch = 'REFERENCE_AMOUNT_MISMATCH',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',

  // -- validação de requisição ----------------------------------------------
  InvalidTransactionKind = 'INVALID_TRANSACTION_KIND',
  InvalidAmount = 'INVALID_AMOUNT',
  IdempotencyConflict = 'IDEMPOTENCY_KEY_PAYLOAD_CONFLICT',

  // -- infraestrutura -------------------------------------------------------
  InternalError = 'INTERNAL_ERROR',
}

/**
 * Orientação operacional associada a um código de falha. O valor é exposto
 * para que um provider possa decidir entre reenviar, corrigir o payload ou
 * desistir, sem interpretar mensagens legíveis por humanos.
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
