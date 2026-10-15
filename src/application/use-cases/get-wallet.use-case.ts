import { WalletNotFoundError } from '../../domain/shared/errors';
import type { Money } from '../../domain/shared/money';
import type { UnitOfWork } from '../ports/unit-of-work.port';

export interface WalletView {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class GetWalletUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(walletId: string): Promise<WalletView> {
    return this.uow.read(async (tx) => {
      const wallet = await tx.wallets.findById(walletId);
      if (!wallet) {
        throw new WalletNotFoundError(walletId);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance,
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      };
    });
  }
}
