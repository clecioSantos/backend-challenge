import { WalletNotFoundError } from '../../domain/shared/errors';
import type { Money } from '../../domain/shared/money';
import type { UnitOfWork } from '../ports/unit-of-work.port';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

/**
 * Compares the materialized `wallets.balance` against the balance rebuilt from
 * the append-only ledger. A divergence is never corrected here — it is
 * reported, so the caller can alert and investigate.
 */
export class ReconcileWalletUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    return this.uow.read(async (tx) => {
      const wallet = await tx.wallets.findById(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      const calculatedBalance = await tx.ledger.sumForWallet(walletId, wallet.currency);
      const checkedEntries = await tx.ledger.countForWallet(walletId);
      const difference = wallet.balance.subtract(calculatedBalance);

      return {
        walletId: wallet.id,
        storedBalance: wallet.balance,
        calculatedBalance,
        difference,
        consistent: difference.isZero(),
        checkedEntries,
      };
    });
  }
}
