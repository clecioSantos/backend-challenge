import type { WagerTransaction } from './wager-transaction';

export interface PendingReferencePage {
  now: Date;
  limit: number;
}

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;

  /**
   * Leitura com lock em nível de linha (`SELECT ... FOR UPDATE`). O worker de
   * referência a utiliza após adquirir o lock da wallet, para que dois workers
   * nunca retomem a mesma linha `PENDING_REFERENCE` em paralelo.
   */
  findByIdForUpdate(id: string): Promise<WagerTransaction | null>;

  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;

  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  /** Linhas de reversão (REFUND/ROLLBACK) que já apontam para uma referência. */
  findReversalsOf(referenceTransactionId: string): Promise<WagerTransaction[]>;

  /** Lança `UniqueConstraintViolationError` quando a chave de idempotência já está em uso. */
  insert(transaction: WagerTransaction): Promise<void>;

  save(transaction: WagerTransaction): Promise<void>;

  /** Linhas `PENDING_REFERENCE` cujo retry está vencido, da mais antiga para a mais recente. */
  findPendingReferenceDue(page: PendingReferencePage): Promise<WagerTransaction[]>;

  count(): Promise<number>;
}
