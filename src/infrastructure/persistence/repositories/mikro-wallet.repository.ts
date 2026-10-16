import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import type { MetricsPort } from '../../../application/ports/metrics.port';
import { OptimisticLockError, UniqueConstraintViolationError } from '../../../domain/shared/errors';
import type { Wallet } from '../../../domain/wallet/wallet';
import type { WalletRepository } from '../../../domain/wallet/wallet.repository';
import { WalletEntity } from '../entities/wallet.entity';
import { WalletMapper } from '../mappers/wallet.mapper';

export class MikroWalletRepository implements WalletRepository {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsPort,
  ) {}

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { playerId, currency });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    const entity = WalletMapper.toNewEntity(wallet);
    this.em.persist(entity);

    try {
      await this.em.flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new UniqueConstraintViolationError('wallets_player_currency_uq');
      }
      throw error;
    }
  }

  async save(wallet: Wallet, expectedVersion: number): Promise<void> {
    const entity = await this.em.findOneOrFail(WalletEntity, { id: wallet.id });

    if (entity.version !== expectedVersion) {
      // Defesa em profundidade: o lock pessimista deveria impedir isto, mas se a
      // versão mudou, contabilizamos o conflito antes de falhar.
      this.metrics.recordLockConflict('wallet');
      throw new OptimisticLockError('Wallet', wallet.id);
    }

    WalletMapper.apply(wallet, entity);
    await this.em.flush();
  }
}
