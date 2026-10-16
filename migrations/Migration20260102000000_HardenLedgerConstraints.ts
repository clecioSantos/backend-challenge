import { Migration } from '@mikro-orm/migrations';

/**
 * Endurecimento do schema.
 *
 *   - trava a invariante aritmética do ledger no próprio banco
 *     (`balance_before ± amount = balance_after`), que antes só existia em
 *     código;
 *   - impede reversão dupla da mesma referência pelo mesmo tipo de operação
 *     (`REFUND`/`ROLLBACK`) no banco, e não apenas na aplicação.
 */
export class Migration20260102000000_HardenLedgerConstraints extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_arithmetic_check"
        check (
          ("direction" = 'DEBIT' and "balance_before" - "amount" = "balance_after")
          or
          ("direction" = 'CREDIT' and "balance_before" + "amount" = "balance_after")
        );
    `);

    this.addSql(`
      create unique index "wager_transactions_reversal_uq"
        on "wager_transactions" ("reference_transaction_id", "kind")
        where "reference_transaction_id" is not null and "status" = 'PROCESSED';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "wager_transactions_reversal_uq";`);
    this.addSql(
      `alter table "wallet_ledger_entries" drop constraint if exists "wallet_ledger_entries_arithmetic_check";`,
    );
  }
}
