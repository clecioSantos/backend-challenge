import { Money } from '../../../domain/shared/money';
import type { LedgerDirection } from '../../../domain/wallet/ledger-direction';
import { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

export const LedgerEntryMapper = {
  toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    const currency = entity.currency;
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as LedgerDirection,
      money: Money.from({ amount: entity.amount, currency }),
      balanceBefore: Money.from({ amount: entity.balanceBefore, currency }),
      balanceAfter: Money.from({ amount: entity.balanceAfter, currency }),
      createdAt: entity.createdAt,
    });
  },

  toNewEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.toString();
    entity.currency = entry.money.currency;
    entity.balanceBefore = entry.balanceBefore.toString();
    entity.balanceAfter = entry.balanceAfter.toString();
    entity.createdAt = entry.createdAt;
    return entity;
  },
};
