import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { LedgerDirection } from '../../../domain/wallet/ledger-direction';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ name: 'wallet_ledger_entries_transaction_wallet_uq', properties: ['transactionId', 'walletId'] })
@Check({ name: 'wallet_ledger_entries_amount_positive', expression: 'amount > 0' })
@Check({ name: 'wallet_ledger_entries_balance_before_non_negative', expression: 'balance_before >= 0' })
@Check({ name: 'wallet_ledger_entries_balance_after_non_negative', expression: 'balance_after >= 0' })
@Check({
  name: 'wallet_ledger_entries_direction_valid',
  expression: "direction IN ('DEBIT','CREDIT')",
})
@Check({
  name: 'wallet_ledger_entries_arithmetic_check',
  expression:
    "(direction = 'DEBIT' AND balance_before - amount = balance_after) OR (direction = 'CREDIT' AND balance_before + amount = balance_after)",
})
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid', fieldName: 'id' })
  id!: string;

  @Index({ name: 'wallet_ledger_entries_wallet_cursor_idx' })
  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'transaction_id' })
  transactionId!: string;

  @Property({ type: 'string', length: 8, fieldName: 'direction' })
  direction!: LedgerDirection;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'amount' })
  amount!: string;

  @Property({ type: 'char', length: 3, fieldName: 'currency' })
  currency!: string;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'balance_before' })
  balanceBefore!: string;

  @Property({ type: 'string', columnType: 'numeric(20,2)', fieldName: 'balance_after' })
  balanceAfter!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;
}
