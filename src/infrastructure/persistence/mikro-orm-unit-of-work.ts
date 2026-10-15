import type { EntityManager } from '@mikro-orm/postgresql';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { TransactionContext, UnitOfWork } from '../../application/ports/unit-of-work.port';
import { MikroInboxRepository } from './repositories/mikro-inbox.repository';
import { MikroLedgerRepository } from './repositories/mikro-ledger.repository';
import { MikroOutboxRepository } from './repositories/mikro-outbox.repository';
import { MikroWagerTransactionRepository } from './repositories/mikro-wager-transaction.repository';
import { MikroWalletRepository } from './repositories/mikro-wallet.repository';

function createTransactionContext(em: EntityManager): TransactionContext {
  return {
    wallets: new MikroWalletRepository(em),
    wagerTransactions: new MikroWagerTransactionRepository(em),
    ledger: new MikroLedgerRepository(em),
    inbox: new MikroInboxRepository(em),
    outbox: new MikroOutboxRepository(em),
  };
}

/**
 * MikroORM-backed unit of work.
 *
 * `run` opens a real SQL transaction and hands out a context whose repositories
 * share the same `EntityManager`, so wallet, ledger, inbox and outbox writes all
 * commit or roll back together. `read` uses a forked `EntityManager` (fresh
 * identity map, no transaction) for pure queries.
 */
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly orm: MikroORM) {}

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.orm.em.transactional((em) => work(createTransactionContext(em as EntityManager)));
  }

  async read<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work(createTransactionContext(this.orm.em.fork()));
  }
}
