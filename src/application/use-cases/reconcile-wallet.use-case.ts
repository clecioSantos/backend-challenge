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
 * Compara o `wallets.balance` materializado com o saldo reconstruído a partir
 * do ledger append-only. Uma divergência nunca é corrigida aqui — ela é
 * reportada, para que o chamador possa alertar e investigar.
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
