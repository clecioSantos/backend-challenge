import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../domain/shared/money';
import type { WalletLedgerEntry } from '../../../domain/wallet/wallet-ledger-entry';
import type { LedgerFindOptions, LedgerPage, LedgerRepository } from '../../../domain/wallet/ledger.repository';
import { decodeLedgerCursor, encodeLedgerCursor } from '../cursor';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';
import { LedgerEntryMapper } from '../mappers/ledger-entry.mapper';

export class MikroLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    this.em.persist(LedgerEntryMapper.toNewEntity(entry));
    await this.em.flush();
  }

  async findByWallet(walletId: string, options: LedgerFindOptions): Promise<LedgerPage> {
    const where: Record<string, unknown> = { walletId };

    if (options.cursor !== undefined) {
      const cursor = decodeLedgerCursor(options.cursor);
      where.$or = [
        { createdAt: { $gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { $gt: cursor.id } },
      ];
    }

    const entities = await this.em.find(WalletLedgerEntryEntity, where, {
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: options.limit + 1,
    });

    const hasMore = entities.length > options.limit;
    const page = hasMore ? entities.slice(0, options.limit) : entities;
    const last = page.at(-1);

    return {
      entries: page.map((entity) => LedgerEntryMapper.toDomain(entity)),
      nextCursor:
        hasMore && last ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async findByTransactionId(transactionId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.em.find(WalletLedgerEntryEntity, { transactionId });
    return entities.map((entity) => LedgerEntryMapper.toDomain(entity));
  }

  async sumForWallet(walletId: string, currency: string): Promise<Money> {
    const rows = await this.em.execute<{ net: string }[]>(
      `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0)::text as net
       from "wallet_ledger_entries"
       where "wallet_id" = ?`,
      [walletId],
    );

    const net = rows[0]?.net ?? '0';
    return Money.fromTrusted(net, currency);
  }

  async countForWallet(walletId: string): Promise<number> {
    return this.em.count(WalletLedgerEntryEntity, { walletId });
  }
}
