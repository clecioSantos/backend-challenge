import type { InboxRepository } from '../../domain/inbox/inbox.repository';
import type { OutboxRepository } from '../../domain/outbox/outbox.repository';
import type { LedgerRepository } from '../../domain/wallet/ledger.repository';
import type { WalletRepository } from '../../domain/wallet/wallet.repository';
import type { WagerTransactionRepository } from '../../domain/wager-transaction/wager-transaction.repository';

/** Repositórios vinculados a uma única transação SQL / identity map. */
export interface TransactionContext {
  wallets: WalletRepository;
  wagerTransactions: WagerTransactionRepository;
  ledger: LedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  /**
   * Executa `work` dentro de uma transação de banco de dados. A transação sofre
   * commit quando `work` resolve e rollback se lançar uma exceção. Este é o único
   * lugar onde a atomicidade de wallet + ledger + inbox + outbox é garantida.
   */
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;

  /** Leituras no escopo da transação (sem intenção de escrita) reutilizando os mesmos repositórios. */
  read<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
