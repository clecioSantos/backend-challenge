import { createHash } from 'node:crypto';
import type { MoneyProps } from '../../domain/shared/money';

/**
 * Deterministic JSON serialization: object keys sorted lexicographically,
 * arrays kept in order, `undefined` members dropped. Two requests that carry
 * the same business data produce the same string regardless of key order.
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

/** Business fields that identify a wager operation on the wire. */
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
