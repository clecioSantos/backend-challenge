import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { FailureCode } from '../../../domain/shared/failure-code';
import type { WagerTransactionKind, WagerTransactionStatus } from '../../../domain/wager-transaction/wager-transaction';

@Entity({ tableName: 'wager_transactions' })
@Unique({ name: 'wager_transactions_provider_external_uq', properties: ['providerId', 'externalTransactionId'] })
@Unique({ name: 'wager_transactions_idempotency_key_uq', properties: ['idempotencyKey'] })
@Check({ name: 'wager_transactions_amount_positive', expression: 'amount > 0' })
@Check({
  name: 'wager_transactions_status_valid',
  expression: "status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')",
})
@Check({
  name: 'wager_transactions_kind_valid',
  expression: "kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')",
})
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid', fieldName: 'id' })
  id!: string;

  @Property({ type: 'string', length: 64, fieldName: 'provider_id' })
  providerId!: string;

  @Index({ name: 'wager_transactions_wallet_id_idx' })
  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'external_transaction_id' })
  externalTransactionId!: string;

  @Property({ type: 'string', length: 256, fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'string', length: 128, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'string', length: 128, fieldName: 'round_id' })
  roundId!: string;

  @Property({ type: 'string', length: 128, fieldName: 'game_id' })
  gameId!: string;

  @Property({ type: 'string', length: 16, fieldName: 'kind' })
  kind!: WagerTransactionKind;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'amount' })
  amount!: string;

  @Property({ type: 'char', length: 3, fieldName: 'currency' })
  currency!: string;

  @Property({ type: 'string', length: 128, fieldName: 'reference_external_transaction_id', nullable: true })
  referenceExternalTransactionId?: string | null;

  @Property({ type: 'uuid', fieldName: 'reference_transaction_id', nullable: true })
  referenceTransactionId?: string | null;

  @Property({ type: 'string', length: 24, fieldName: 'status' })
  status!: WagerTransactionStatus;

  @Property({ type: 'string', length: 48, fieldName: 'failure_code', nullable: true })
  failureCode?: FailureCode | null;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'balance_after', nullable: true })
  balanceAfter?: string | null;

  @Property({ type: 'char', length: 3, fieldName: 'balance_after_currency', nullable: true })
  balanceAfterCurrency?: string | null;

  @Property({ type: 'integer', fieldName: 'reference_attempts', default: 0 })
  referenceAttempts = 0;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'next_reference_attempt_at', nullable: true })
  nextReferenceAttemptAt?: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'processed_at', nullable: true })
  processedAt?: Date | null;
}
