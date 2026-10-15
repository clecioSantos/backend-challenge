import type { InboxRepository } from '../../domain/inbox/inbox.repository';
import type { OutboxRepository } from '../../domain/outbox/outbox.repository';
import type { LedgerRepository } from '../../domain/wallet/ledger.repository';
import type { WalletRepository } from '../../domain/wallet/wallet.repository';
import type { WagerTransactionRepository } from '../../domain/wager-transaction/wager-transaction.repository';

/** Repositories bound to a single SQL transaction / identity map. */
export interface TransactionContext {
  wallets: WalletRepository;
  wagerTransactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  /**
   * Runs `work` inside a database transaction. The transaction commits when
   * `work` resolves and rolls back if it throws. This is the only place where
   * the atomicity of wallet + ledger + inbox + outbox is guaranteed.
   */
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;

  /** Transaction-scoped reads (no write intent) reusing the same repositories. */
  read<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
