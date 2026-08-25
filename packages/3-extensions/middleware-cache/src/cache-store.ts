/**
 * A cached set of rows produced by a single execution.
 *
 * - `rows` are stored raw (undecoded). The SQL runtime's `decodeRow` pass
 *   wraps the orchestrator output, so intercepted rows go through the
 *   same codec decoding as driver rows on the way to the consumer. The
 *   cache stores wire-format values; decoding happens once per consumer
 *   read regardless of where the rows came from.
 * - `storedAt` is the clock value at the moment the entry was committed
 *   to the store. It is informational metadata for callers (debugging,
 *   telemetry) and is **not** used by the in-memory store itself for
 *   expiry — TTL is driven by the store's own clock plus the `ttlMs`
 *   passed to `set`. Custom stores may use it differently.
 * - `tags` are optional labels attached to this cache entry. Multiple
 *   entries can share the same tag; bulk invalidation is possible via
 *   `delByTag`.
 */
export interface CachedEntry {
  readonly rows: readonly Record<string, unknown>[];
  readonly storedAt: number;
  readonly tags?: readonly string[] | undefined;
}

export const CACHE_INTERNAL_GENERATION_PREFIX = '__prisma_next_cache:generation:';

/**
 * Pluggable cache backend used by the cache middleware.
 *
 * The default implementation is an in-memory LRU with TTL produced by
 * `createInMemoryCacheStore`. Users can supply Redis, Memcached, or any
 * other backend by implementing this interface.
 *
 * The required interface is intentionally small:
 *
 * - `get` returns the entry if it exists and has not expired, or
 *   `undefined` otherwise. Implementations that gate on TTL should
 *   treat an expired entry as absent (return `undefined`) and may
 *   evict it as a side effect.
 * - `set` writes the entry under the key with an associated TTL in
 *   milliseconds. Implementations may evict other entries to make
 *   room (LRU, LFU, etc.) and may treat the operation as fire-and-
 *   forget at scale; the cache middleware does not rely on `set`
 *   completing before subsequent `get`s.
 *
 * - `list` (optional) returns all live keys or only those matching a
 *   prefix. Implementations should avoid returning expired entries.
 *   Required when using `uncacheOnMutation` or `uncacheAnnotation`.
 * - `del` (optional) removes a key from the store.
 *   Required when using `uncacheOnMutation` or `uncacheAnnotation`.
 * - `delByTag` (optional) removes all entries that have any of the given
 *   tags. Useful for bulk cache invalidation. Implementations may delete
 *   synchronously or asynchronously; the middleware awaits the result
 *   but does not retry on failure.
 * - `incr` (optional) increments a numeric counter stored under a key.
 *   Used by generation-based invalidation when the cache must stay
 *   coherent across multiple instances sharing the same backend. Store
 *   implementations that support generation mode in clustered setups
 *   should implement this method.
 *
 * All methods are async to leave the door open for I/O-backed stores
 * (Redis, S3, etc.). The default in-memory store completes
 * synchronously and wraps the result in `Promise.resolve` for type
 * conformance.
 */
export interface CacheStore {
  get(key: string): Promise<CachedEntry | undefined>;
  set(key: string, entry: CachedEntry, ttlMs: number): Promise<void>;
  list?(prefix?: string): Promise<readonly string[]>;
  del?(key: string): Promise<void>;
  delByTag?(tags: readonly string[]): Promise<void>;
  incr?(key: string, delta?: number): Promise<number>;
}

/**
 * Options accepted by `createInMemoryCacheStore`.
 *
 * - `maxEntries` — hard cap on the number of live entries. Once the cap
 *   is exceeded, the least recently used entry is evicted. Reads and
 *   writes both count as "uses" for ordering purposes.
 * - `clock` — injectable time source for TTL math. Defaults to
 *   `Date.now`. Tests inject a controlled clock to verify expiry without
 *   real-time waits.
 */
export interface InMemoryCacheStoreOptions {
  readonly maxEntries: number;
  readonly clock?: () => number;
}

interface StoredRecord {
  readonly entry: CachedEntry;
  readonly expiresAt: number;
}

interface StoredCounter {
  readonly value: number;
}

/**
 * Default cache backend. An LRU with per-entry TTL, backed by a `Map`.
 *
 * Eviction policy:
 *
 * - On `set` of a fresh key whose insertion would push the live count
 *   above `maxEntries`, the least recently used entry is evicted.
 *   Setting an existing key updates the entry in place and refreshes its
 *   recency without changing the live count.
 * - On `get` of an existing key, recency is bumped (so the entry is no
 *   longer the LRU candidate).
 * - On `get` of an expired entry, the entry is removed from the map and
 *   `undefined` is returned. The slot becomes available for new writes
 *   without counting against `maxEntries`.
 *
 * `Map` insertion order is the LRU order: the first key is the LRU
 * candidate; the last key is the most recently used. Bumping recency is
 * a delete-then-set on the underlying map.
 *
 * The default store is **not** coherent across processes or replicas —
 * each process holds its own Map. Users who need a shared cache supply
 * their own `CacheStore` (Redis, Memcached, etc.).
 */
export function createInMemoryCacheStore(options: InMemoryCacheStoreOptions): CacheStore {
  const maxEntries = options.maxEntries;
  const clock = options.clock ?? Date.now;
  const map = new Map<string, StoredRecord>();
  const counters = new Map<string, StoredCounter>();
  const tagIndex = new Map<string, Set<string>>();

  function isGenerationKey(key: string): boolean {
    return key.startsWith(CACHE_INTERNAL_GENERATION_PREFIX);
  }

  function generationKeyEntry(value: number): CachedEntry {
    return {
      rows: [],
      storedAt: value,
    };
  }

  function get(key: string): Promise<CachedEntry | undefined> {
    if (isGenerationKey(key)) {
      return Promise.resolve(
        counters.get(key) === undefined ? undefined : generationKeyEntry(counters.get(key)!.value),
      );
    }

    const record = map.get(key);
    if (record === undefined) {
      return Promise.resolve(undefined);
    }
    if (clock() >= record.expiresAt) {
      map.delete(key);
      return Promise.resolve(undefined);
    }
    // Bump recency: re-insert at the end of the iteration order.
    map.delete(key);
    map.set(key, record);
    return Promise.resolve(record.entry);
  }

  function set(key: string, entry: CachedEntry, ttlMs: number): Promise<void> {
    if (isGenerationKey(key)) {
      counters.set(key, { value: entry.storedAt });
      return Promise.resolve();
    }

    // If the key already exists, clean up its old tags.
    if (map.has(key)) {
      const oldEntry = map.get(key)?.entry;
      if (oldEntry?.tags) {
        for (const tag of oldEntry.tags) {
          const tagSet = tagIndex.get(tag);
          if (tagSet) {
            tagSet.delete(key);
            if (tagSet.size === 0) {
              tagIndex.delete(tag);
            }
          }
        }
      }
    }

    const expiresAt = clock() + ttlMs;
    // Re-set semantics: if the key is already present, deleting first
    // ensures the new value lands at the end of the iteration order
    // (most recently used) rather than retaining the old slot's
    // position. This matters for LRU correctness when the same key is
    // re-cached after a refresh.
    if (map.has(key)) {
      map.delete(key);
    }
    map.set(key, { entry, expiresAt });

    // Index the new tags
    if (entry.tags) {
      for (const tag of entry.tags) {
        if (!tagIndex.has(tag)) {
          tagIndex.set(tag, new Set());
        }
        tagIndex.get(tag)!.add(key);
      }
    }

    // Evict LRU entries until the live count is within bounds. The
    // iterator yields keys in insertion order; the first one is the
    // oldest (LRU).
    while (map.size > maxEntries) {
      const oldest = map.keys().next();
      if (oldest.done) {
        break;
      }
      const keyToEvict = oldest.value;
      const evictedRecord = map.get(keyToEvict);
      if (evictedRecord?.entry.tags) {
        for (const tag of evictedRecord.entry.tags) {
          const tagSet = tagIndex.get(tag);
          if (tagSet) {
            tagSet.delete(keyToEvict);
            if (tagSet.size === 0) {
              tagIndex.delete(tag);
            }
          }
        }
      }
      map.delete(keyToEvict);
    }

    return Promise.resolve();
  }

  function unlinkTaggedKey(key: string, tags: readonly string[] | undefined): void {
    if (tags === undefined) return;
    for (const tag of tags) {
      const tagSet = tagIndex.get(tag);
      if (tagSet === undefined) continue;
      tagSet.delete(key);
      if (tagSet.size === 0) tagIndex.delete(tag);
    }
  }

  function deleteCacheKey(key: string): void {
    const record = map.get(key);
    unlinkTaggedKey(key, record?.entry.tags);
    map.delete(key);
  }

  function list(prefix?: string): Promise<readonly string[]> {
    if (prefix !== undefined && prefix.startsWith(CACHE_INTERNAL_GENERATION_PREFIX)) {
      return Promise.resolve([...counters.keys()].filter((key) => key.startsWith(prefix)));
    }

    const now = clock();
    for (const [key, record] of map) {
      if (now >= record.expiresAt) {
        deleteCacheKey(key);
      }
    }
    const keys =
      prefix === undefined
        ? [...map.keys()]
        : [...map.keys()].filter((key) => key.startsWith(prefix));
    return Promise.resolve(keys);
  }

  function del(key: string): Promise<void> {
    if (isGenerationKey(key)) {
      counters.delete(key);
      return Promise.resolve();
    }

    deleteCacheKey(key);
    return Promise.resolve();
  }

  function incr(key: string, delta = 1): Promise<number> {
    if (!isGenerationKey(key)) {
      const current = counters.get(key)?.value ?? 0;
      const next = current + delta;
      counters.set(key, { value: next });
      return Promise.resolve(next);
    }

    const current = counters.get(key)?.value ?? 0;
    const next = current + delta;
    counters.set(key, { value: next });
    return Promise.resolve(next);
  }

  function delByTag(tags: readonly string[]): Promise<void> {
    const keysToDelete = new Set<string>();
    for (const tag of tags) {
      const tagSet = tagIndex.get(tag);
      if (tagSet) {
        for (const key of tagSet) {
          keysToDelete.add(key);
        }
      }
    }

    for (const key of keysToDelete) {
      if (map.has(key)) {
        deleteCacheKey(key);
      } else {
        for (const tag of tags) {
          const tagSet = tagIndex.get(tag);
          if (tagSet === undefined) continue;
          tagSet.delete(key);
          if (tagSet.size === 0) tagIndex.delete(tag);
        }
      }
    }

    return Promise.resolve();
  }

  return { get, set, list, del, delByTag, incr };
}
