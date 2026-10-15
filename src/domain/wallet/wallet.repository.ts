import type { Wallet } from './wallet';

/**
 * Port de persistência do aggregate `Wallet`.
 *
 * `findByIdForUpdate` é a primitiva de concorrência: ele adquire um lock
 * pessimista em nível de linha (`SELECT ... FOR UPDATE`) com escopo na
 * transação SQL atual, serializando todo movimento que visa a mesma wallet e,
 * ao mesmo tempo, permitindo que wallets diferentes prossigam em paralelo.
 */
export interface WalletRepository {
  findById(id: string): Promise<Wallet | null>;

  findByIdForUpdate(id: string): Promise<Wallet | null>;

  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;

  /** Lança `UniqueConstraintViolationError` quando `(playerId, currency)` já existe. */
  insert(wallet: Wallet): Promise<void>;

  /**
   * Persiste alterações de saldo/version protegidas por `expectedVersion`.
   * Lança `OptimisticLockError` se a version armazenada não corresponder mais.
   */
  save(wallet: Wallet, expectedVersion: number): Promise<void>;
}
