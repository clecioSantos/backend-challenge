import type { Money } from '../shared/money';
import type { WalletLedgerEntry } from './wallet-ledger-entry';

export interface LedgerFindOptions {
  /** Cursor opaco e estável. Codifica `(createdAt, id)` da última linha vista. */
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

  /** Saldo líquido derivado puramente dos lançamentos do ledger (créditos - débitos). */
  sumForWallet(walletId: string, currency: string): Promise<Money>;

  countForWallet(walletId: string): Promise<number>;
}
