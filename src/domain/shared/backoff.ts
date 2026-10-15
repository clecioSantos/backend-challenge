export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

/**
 * Backoff exponencial: `base * 2^(attempt-1)`, limitado a `maxMs`.
 * `attempt` começa em 1 (o primeiro retry é a attempt 1).
 */
export function computeBackoffDelay(attempt: number, policy: BackoffPolicy): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
}
