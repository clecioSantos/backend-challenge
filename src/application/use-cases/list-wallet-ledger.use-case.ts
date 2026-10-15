import { WalletNotFoundError } from '../../domain/shared/errors';
import type { Money } from '../../domain/shared/money';
import type { LedgerDirection } from '../../domain/wallet/ledger-direction';
import type { UnitOfWork } from '../ports/unit-of-work.port';

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface WalletLedgerView {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

export interface ListWalletLedgerQuery {
  walletId: string;
  cursor?: string | undefined;
  limit: number;
}

export class ListWalletLedgerUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(query: ListWalletLedgerQuery): Promise<WalletLedgerView> {
    return this.uow.read(async (tx) => {
      const wallet = await tx.wallets.findById(query.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(query.walletId);
      }

      const page = await tx.ledger.findByWallet(query.walletId, {
        cursor: query.cursor,
        limit: query.limit,
      });

      return {
        entries: page.entries.map((entry) => ({
          id: entry.id,
          transactionId: entry.transactionId,
          direction: entry.direction,
          money: entry.money,
          balanceBefore: entry.balanceBefore,
          balanceAfter: entry.balanceAfter,
          createdAt: entry.createdAt,
        })),
        nextCursor: page.nextCursor,
      };
    });
  }
}
