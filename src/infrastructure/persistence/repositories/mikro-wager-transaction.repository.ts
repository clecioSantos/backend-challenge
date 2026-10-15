import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationError } from '../../../domain/shared/errors';
import type { WagerTransaction } from '../../../domain/wager-transaction/wager-transaction';
import { WagerTransactionStatus } from '../../../domain/wager-transaction/wager-transaction';
import type {
  PendingReferencePage,
  WagerTransactionRepository,
} from '../../../domain/wager-transaction/wager-transaction.repository';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper';

export class MikroWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdForUpdate(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(
      WagerTransactionEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { idempotencyKey });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findReversalsOf(referenceTransactionId: string): Promise<WagerTransaction[]> {
    const entities = await this.em.find(WagerTransactionEntity, { referenceTransactionId });
    return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toNewEntity(transaction);
    this.em.persist(entity);

    try {
      await this.em.flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        const message = String(error.message);
        const constraint = message.includes('idempotency')
          ? 'wager_transactions_idempotency_key_uq'
          : 'wager_transactions_provider_external_uq';
        throw new UniqueConstraintViolationError(constraint);
      }
      throw error;
    }
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const entity = await this.em.findOneOrFail(WagerTransactionEntity, { id: transaction.id });
    WagerTransactionMapper.apply(transaction, entity);
    await this.em.flush();
  }

  async findPendingReferenceDue(page: PendingReferencePage): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        $or: [{ nextReferenceAttemptAt: null }, { nextReferenceAttemptAt: { $lte: page.now } }],
      },
      {
        orderBy: { nextReferenceAttemptAt: 'asc' },
        limit: page.limit,
      },
    );

    return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
  }

  async count(): Promise<number> {
    return this.em.count(WagerTransactionEntity, {});
  }
}
