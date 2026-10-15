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
 * unit of work com suporte do MikroORM.
 *
 * `run` abre uma transação SQL real e entrega um contexto cujos repositories
 * compartilham o mesmo `EntityManager`, então as escritas de wallet, ledger, inbox e outbox
 * fazem commit ou rollback juntas. `read` usa um `EntityManager` derivado (identity map
 * novo, sem transação) para consultas puras.
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
