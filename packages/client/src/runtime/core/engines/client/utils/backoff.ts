const BACKOFF_INTERVAL_MS = 50

/**
 * Waits for an exponentially growing, jittered delay before retry number
 * `attempt` (0-based) and resolves with the delay that was used.
 *
 * Same schedule as the `DataProxyEngine` of Prisma 6: roughly 50ms, 100ms,
 * 200ms, ... each with up to ±50% jitter.
 */
export function backOff(attempt: number): Promise<number> {
  const baseDelay = Math.pow(2, attempt) * BACKOFF_INTERVAL_MS
  const jitter = Math.ceil(Math.random() * baseDelay) - Math.ceil(baseDelay / 2)
  const delay = baseDelay + jitter

  return new Promise((resolve) => setTimeout(() => resolve(delay), delay))
}
