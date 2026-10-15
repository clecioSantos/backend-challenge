import type { Wallet } from './wallet';

/**
 * Persistence port for the `Wallet` aggregate.
 *
 * `findByIdForUpdate` is the concurrency primitive: it takes a row-level
 * pessimistic lock (`SELECT ... FOR UPDATE`) scoped to the current SQL
 * transaction, serialising every movement that targets the same wallet while
 * letting different wallets proceed in parallel.
 */
export interface WalletRepository {
  findById(id: string): Promise<Wallet | null>;

  findByIdForUpdate(id: string): Promise<Wallet | null>;

  findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;

  /** Throws `UniqueConstraintViolationError` when `(playerId, currency)` already exists. */
  insert(wallet: Wallet): Promise<void>;

  /**
   * Persists balance/version changes guarded by `expectedVersion`. Throws
   * `OptimisticLockError` if the stored version no longer matches.
   */
  save(wallet: Wallet, expectedVersion: number): Promise<void>;
}
