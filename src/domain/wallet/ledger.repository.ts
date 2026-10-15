import type { Money } from '../shared/money';
import type { WalletLedgerEntry } from './wallet-ledger-entry';

export interface LedgerFindOptions {
  /** Opaque, stable cursor. Encodes `(createdAt, id)` of the last seen row. */
  cursor?: string;
  limit: number;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

export interface LedgerRepository {
  insert(entry: WalletLedgerEntry): Promise<void>;

  findByWallet(walletId: string, options: LedgerFindOptions): Promise<LedgerPage>;

  findByTransactionId(transactionId: string): Promise<WalletLedgerEntry[]>;

  /** Net balance derived purely from ledger entries (credits - debits). */
  sumForWallet(walletId: string, currency: string): Promise<Money>;

  countForWallet(walletId: string): Promise<number>;
}
