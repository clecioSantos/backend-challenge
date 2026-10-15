import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';

@Entity({ tableName: 'wallets' })
@Unique({ name: 'wallets_player_currency_uq', properties: ['playerId', 'currency'] })
@Check({ name: 'wallets_balance_non_negative', expression: 'balance >= 0' })
@Check({ name: 'wallets_version_positive', expression: 'version >= 1' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid', fieldName: 'id' })
  id!: string;

  @Index({ name: 'wallets_player_id_idx' })
  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'char', length: 3, fieldName: 'currency' })
  currency!: string;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'balance' })
  balance!: string;

  @Property({ type: 'integer', fieldName: 'version' })
  version!: number;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'updated_at' })
  updatedAt!: Date;
}
