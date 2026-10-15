import { createHash } from 'node:crypto';
import type { MoneyProps } from '../../domain/shared/money';

/**
 * Serialização JSON determinística: chaves de objeto ordenadas lexicograficamente,
 * arrays mantidos em ordem, membros `undefined` descartados. Duas requisições que
 * carregam os mesmos dados de negócio produzem a mesma string, independentemente da ordem das chaves.
 */
export function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();

    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value) as string;
}

/** Campos de negócio que identificam uma operação de wager no wire. */
export interface WagerPayloadFingerprint {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
}

export function hashWagerPayload(payload: WagerPayloadFingerprint): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}
