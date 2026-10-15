import { Money } from '../../../domain/shared/money';
import { Wallet } from '../../../domain/wallet/wallet';
import { WalletEntity } from '../entities/wallet.entity';

export const WalletMapper = {
  toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({ amount: entity.balance, currency: entity.currency }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  },

  toNewEntity(wallet: Wallet): WalletEntity {
    return WalletMapper.apply(wallet, new WalletEntity());
  },

  apply(wallet: Wallet, entity: WalletEntity): WalletEntity {
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toString();
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
    return entity;
  },
};
