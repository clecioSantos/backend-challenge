export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

/**
 * Exponential backoff: `base * 2^(attempt-1)`, capped at `maxMs`.
 * `attempt` is 1-based (the first retry is attempt 1).
 */
export function computeBackoffDelay(attempt: number, policy: BackoffPolicy): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
}
