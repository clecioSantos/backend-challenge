import type { WagerTransaction } from './wager-transaction';

export interface PendingReferencePage {
  now: Date;
  limit: number;
}

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;

  /**
   * Row-level locked read (`SELECT ... FOR UPDATE`). The reference worker uses
   * it after taking the wallet lock so two workers can never resume the same
   * `PENDING_REFERENCE` row in parallel.
   */
  findByIdForUpdate(id: string): Promise<WagerTransaction | null>;

  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;

  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  /** Reversal rows (REFUND/ROLLBACK) already pointing at a reference. */
  findReversalsOf(referenceTransactionId: string): Promise<WagerTransaction[]>;

  /** Throws `UniqueConstraintViolationError` when the idempotency key is taken. */
  insert(transaction: WagerTransaction): Promise<void>;

  save(transaction: WagerTransaction): Promise<void>;

  /** `PENDING_REFERENCE` rows whose retry is due, oldest first. */
  findPendingReferenceDue(page: PendingReferencePage): Promise<WagerTransaction[]>;

  count(): Promise<number>;
}
