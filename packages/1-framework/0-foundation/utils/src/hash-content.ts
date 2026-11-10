/**
 * Hashes a canonical-string representation of an execution into a bounded,
 * opaque cache-key digest.
 *
 * Designed for use as the final step of `ActivityContext.contentHash`
 * implementations: family runtimes compose a canonical string from
 * `meta.storageHash`, the rendered statement (or wire command), and
 * canonicalized parameters via `canonicalStringify`, then pipe the result
 * through this helper.
 *
 * Why hash the canonical string instead of using it directly as a `Map` key:
 *
 * 1. **Bounded memory.** A raw canonical key includes concrete parameter
 *    values, so a query bound to a 10 MB JSON column or binary blob produces
 *    a 10 MB cache key. With `maxEntries = 1000`, that scales to gigabytes
 *    of cache keys alone. SHA-512 pins per-key cost at a fixed digest
 *    length regardless of input size.
 *
 * 2. **Sensitive-data isolation.** The canonical string contains parameter
 *    values verbatim. Cache keys flow into debug logs, Redis `KEYS`/`MONITOR`
 *    output, persistence dumps, monitoring tools, and any user-supplied
 *    `CacheStore` implementation. Hashing prevents PII / credentials /
 *    tokens that appear in query parameters from showing up in any of those
 *    surfaces.
 *
 * Algorithm choice — SHA-512 (`SHA-512` via the WebCrypto API):
 *
 * - **Portability.** WebCrypto (`globalThis.crypto.subtle`) is available in
 *   every modern JavaScript runtime — Node, Deno, Bun, browsers, edge
 *   workers — without importing a Node-specific module. This keeps the
 *   helper usable in non-Node hosts where `node:crypto` is not available.
 * - **Collision space.** 512 bits of output makes accidental collisions
 *   astronomically improbable — far beyond what a cache needs, but the
 *   incremental cost over 256-bit output is negligible and the headroom
 *   is free.
 * - **No additional dependency.** SHA-512 is part of the WebCrypto standard
 *   set of digest algorithms; no third-party package needed.
 *
 * The function is `async` because the WebCrypto digest API is async by
 * design. Callers must await the result.
 *
 * Output format: `sha512:HEXDIGEST` (128-char hex with the algorithm tag
 * prefix). Self-describing so a future migration to a different hash
 * produces visibly distinct keys. This in-memory cache key deliberately
 * keeps its tag — unlike persisted contract hashes, which are bare hex.
 *
 * @example
 * ```typescript
 * const canonical = `${exec.meta.storageHash}|${exec.sql}|${canonicalStringify(exec.params)}`;
 * return await hashContent(canonical);
 * // → 'sha512:8f3...e1c' (always 135 chars: 'sha512:' + 128 hex chars)
 * ```
 */
export async function hashContent(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha512:${hex}`;
}
