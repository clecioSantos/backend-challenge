import { Migration } from '@mikro-orm/migrations';

/**
 * Initial schema.
 *
 * Every guarantee that the domain relies on is enforced here as well, so a bug
 * in the application layer cannot corrupt the ledger:
 *   - uniqueness of `(playerId, currency)` and of idempotency keys;
 *   - non-negative balances and non-negative ledger arithmetic columns;
 *   - enum-like check constraints for status/kind/direction;
 *   - an append-only trigger that rejects UPDATE/DELETE on ledger rows.
 */
export class Migration20260101000000_InitialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" uuid not null,
        "currency" char(3) not null,
        "balance" numeric(20,2) not null default 0,
        "version" integer not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_balance_non_negative" check ("balance" >= 0),
        constraint "wallets_version_positive" check ("version" >= 1)
      );
    `);
    this.addSql(
      `create unique index "wallets_player_currency_uq" on "wallets" ("player_id", "currency");`,
    );
    this.addSql(`create index "wallets_player_id_idx" on "wallets" ("player_id");`);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(64) not null,
        "wallet_id" uuid not null,
        "player_id" uuid not null,
        "external_transaction_id" varchar(128) not null,
        "idempotency_key" varchar(256) not null,
        "payload_hash" varchar(128) not null,
        "round_id" varchar(128) not null,
        "game_id" varchar(128) not null,
        "kind" varchar(16) not null,
        "amount" numeric(20,2) not null,
        "currency" char(3) not null,
        "reference_external_transaction_id" varchar(128) null,
        "reference_transaction_id" uuid null,
        "status" varchar(24) not null,
        "failure_code" varchar(48) null,
        "balance_after" numeric(20,2) null,
        "balance_after_currency" char(3) null,
        "reference_attempts" integer not null default 0,
        "next_reference_attempt_at" timestamptz null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_amount_positive" check ("amount" > 0),
        constraint "wager_transactions_status_valid" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        constraint "wager_transactions_kind_valid" check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wager_transactions_reference_transaction_id_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id")
      );
    `);
    this.addSql(
      `create unique index "wager_transactions_provider_external_uq" on "wager_transactions" ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `create unique index "wager_transactions_idempotency_key_uq" on "wager_transactions" ("idempotency_key");`,
    );
    this.addSql(`create index "wager_transactions_wallet_id_idx" on "wager_transactions" ("wallet_id");`);
    this.addSql(
      `create index "wager_transactions_reference_transaction_id_idx" on "wager_transactions" ("reference_transaction_id");`,
    );
    this.addSql(
      `create index "wager_transactions_pending_reference_idx" on "wager_transactions" ("next_reference_attempt_at") where "status" = 'PENDING_REFERENCE';`,
    );

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(8) not null,
        "amount" numeric(20,2) not null,
        "currency" char(3) not null,
        "balance_before" numeric(20,2) not null,
        "balance_after" numeric(20,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
        constraint "wallet_ledger_entries_balance_before_non_negative" check ("balance_before" >= 0),
        constraint "wallet_ledger_entries_balance_after_non_negative" check ("balance_after" >= 0),
        constraint "wallet_ledger_entries_direction_valid" check ("direction" in ('DEBIT','CREDIT')),
        constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wallet_ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id")
      );
    `);
    this.addSql(
      `create unique index "wallet_ledger_entries_transaction_wallet_uq" on "wallet_ledger_entries" ("transaction_id", "wallet_id");`,
    );
    this.addSql(
      `create index "wallet_ledger_entries_wallet_cursor_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`,
    );

    this.addSql(`
      create function "wallet_ledger_entries_append_only"() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries is append-only';
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_no_mutation"
      before update or delete on "wallet_ledger_entries"
      for each row execute function "wallet_ledger_entries_append_only"();
    `);

    this.addSql(`
      create table "inbox_messages" (
        "consumer_name" varchar(128) not null,
        "message_id" varchar(128) not null,
        "payload_hash" varchar(128) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id")
      );
    `);
    this.addSql(`create index "inbox_messages_processed_at_idx" on "inbox_messages" ("processed_at");`);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" varchar(128) not null,
        "event_type" varchar(128) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "outbox_messages_pending_idx" on "outbox_messages" ("published_at", "next_attempt_at", "occurred_at") where "published_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists "wallet_ledger_entries_no_mutation" on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "wallet_ledger_entries_append_only"();`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
  }
}
