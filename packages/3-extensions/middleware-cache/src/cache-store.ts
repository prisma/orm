import { structuredError } from '@internal/utils/structured-error';

/**
 * The rows one read produced, stored raw (undecoded): the value type the cache middleware stores.
 * The SQL runtime decodes intercepted rows the same way as driver rows, so a hit and a miss yield
 * the same values to the consumer.
 */
export type CachedRows = readonly Record<string, unknown>[];

/**
 * One key of a `CacheStore`, as `get` saw it.
 *
 * - `key` and `meta` — what `get` was asked for. `meta` is the read annotation's `meta`, or
 *   `undefined`.
 * - `version` — the key's version when `get` ran. A store that matches `meta` folds the versions
 *   of whatever `meta` names into it.
 * - `data` — `{ empty: true }` when the store holds no live value for the key, otherwise that
 *   value.
 */
export interface CacheEntry<TMeta = unknown, TValue = CachedRows> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

/**
 * A cache of values that the cache middleware reads from and writes to. The middleware stores
 * `CachedRows`.
 *
 * The store keeps a version per key, an integer it keeps even for a key that holds no value. A key
 * never seen, or forgotten, has version 0. Only `unset` changes a version.
 *
 * - `get` always returns an entry: the live value or `{ empty: true }`, and the current version.
 *   A store that matches `meta` folds the versions of whatever `meta` names into that version, and
 *   does the same when `set` compares, so an `unset` by `meta` refuses a read's `set` even for a
 *   key it has never seen.
 * - `set(entry, value)` stores `value` under `entry.key` with `entry.meta`, if and only if the
 *   key's current version still equals `entry.version`, and returns whether it stored. `entry` is
 *   the one `get` returned, empty or not. There is no unconditional write: to prefill, `get` then
 *   `set`. The compare and the write must be atomic with respect to `unset`, for example one
 *   synchronous step in memory or one script on a server.
 * - `unset` removes every value named in `keys` and every value that matches `meta`, and
 *   increments the version of every key it removes or would remove, including keys that hold no
 *   value. `keys` is `undefined` or non-empty. A store that cannot act on a `meta` it is given
 *   must throw rather than ignore it. An `unset` by key must also drop that key from any `meta`
 *   index the store keeps.
 *
 * Lifetime and eviction are the store's policy. A version that `unset` moved must be kept at least
 * as long as a read can take, so that a read that started before the `unset` cannot store. `unset`
 * must not run queries through the runtime that uses the middleware.
 *
 * `TMeta` is the shape of `meta` the store understands. The middleware does not check that a read
 * annotation's `meta` has this shape; see `cacheAnnotation`.
 */
export interface CacheStore<TMeta = unknown, TValue = CachedRows> {
  get(target: {
    readonly key: string;
    readonly meta: TMeta | undefined;
  }): Promise<CacheEntry<TMeta, TValue>>;
  set(entry: CacheEntry<TMeta, TValue>, value: TValue): Promise<boolean>;
  unset(target: {
    readonly keys: readonly string[] | undefined;
    readonly meta: TMeta | undefined;
  }): Promise<void>;
}

/**
 * Options for `createInMemoryCacheStore`.
 *
 * - `maxEntries` — the most values kept, a positive integer; the least recently used is evicted
 *   first. Default 1000.
 * - `ttlMs` — how long a value lives after its `set`, and how long a key's version is kept after
 *   the `unset` that moved it, a positive number of milliseconds. Default 60 000. Versions are not
 *   bounded by `maxEntries`. A forgotten version reads as 0, so a read that takes longer than
 *   `ttlMs` and overlaps an `invalidate` can store stale rows. `Infinity` never expires values or
 *   versions: the versions of invalidated keys are never forgotten, and grow with the number of
 *   distinct keys invalidated.
 * - `clock` — the time source for expiry. Default `Date.now`.
 */
export interface InMemoryCacheStoreOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly clock?: () => number;
}

interface StoredRecord<TValue> {
  readonly value: TValue;
  readonly expiresAt: number;
}

interface VersionRecord {
  readonly version: number;
  readonly expiresAt: number;
}

function metaUnsupported() {
  return structuredError(
    'RUNTIME.CACHE_STORE_META_UNSUPPORTED',
    'The in-memory cache store cannot remove entries by meta because it does not index meta',
    { fix: 'Invalidate by keys, or supply a CacheStore that indexes meta in set and unset.' },
  );
}

function invalidOption(argument: 'maxEntries' | 'ttlMs', received: number, expected: string) {
  return structuredError(
    'RUNTIME.ARGUMENT_INVALID',
    `createInMemoryCacheStore: ${argument} must be ${expected}`,
    {
      fix: `Pass ${argument} as ${expected}, or leave it unset for the default.`,
      meta: { helper: 'createInMemoryCacheStore', argument, received },
    },
  );
}

/**
 * The default cache store: a least-recently-used map with one lifetime for every value, local to
 * the process. It holds `CachedRows` unless given another `TValue`. A key's version is kept for
 * `ttlMs` after the `unset` that moved it (see `InMemoryCacheStoreOptions`). It ignores `meta` in
 * `get` and `set`, and its `unset` rejects any `meta`, including `null`, before changing anything.
 * It throws `RUNTIME.ARGUMENT_INVALID` for a `maxEntries` or `ttlMs` outside the ranges above.
 */
export function createInMemoryCacheStore<TMeta = unknown, TValue = CachedRows>(
  options?: InMemoryCacheStoreOptions,
): CacheStore<TMeta, TValue> {
  const maxEntries = options?.maxEntries ?? 1000;
  const ttlMs = options?.ttlMs ?? 60_000;
  const clock = options?.clock ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw invalidOption('maxEntries', maxEntries, 'a positive integer');
  }
  if (!(ttlMs > 0)) {
    throw invalidOption('ttlMs', ttlMs, 'a positive number of milliseconds, or Infinity');
  }
  const records = new Map<string, StoredRecord<TValue>>();
  const versions = new Map<string, VersionRecord>();

  function forgetExpiredVersions(): void {
    const now = clock();
    for (const [key, record] of versions) {
      if (now < record.expiresAt) {
        return;
      }
      versions.delete(key);
    }
  }

  function versionOf(key: string): number {
    forgetExpiredVersions();
    return versions.get(key)?.version ?? 0;
  }

  function liveRecord(key: string): StoredRecord<TValue> | undefined {
    const record = records.get(key);
    if (record === undefined) {
      return undefined;
    }
    records.delete(key);
    if (clock() >= record.expiresAt) {
      return undefined;
    }
    records.set(key, record);
    return record;
  }

  async function get(target: {
    readonly key: string;
    readonly meta: TMeta | undefined;
  }): Promise<CacheEntry<TMeta, TValue>> {
    const record = liveRecord(target.key);
    return {
      key: target.key,
      meta: target.meta,
      version: versionOf(target.key),
      data: record === undefined ? { empty: true } : { empty: false, value: record.value },
    };
  }

  async function set(entry: CacheEntry<TMeta, TValue>, value: TValue): Promise<boolean> {
    if (entry.version !== versionOf(entry.key)) {
      return false;
    }
    records.delete(entry.key);
    records.set(entry.key, { value, expiresAt: clock() + ttlMs });
    for (const leastRecentlyUsed of records.keys()) {
      if (records.size <= maxEntries) {
        break;
      }
      records.delete(leastRecentlyUsed);
    }
    return true;
  }

  async function unset(target: {
    readonly keys: readonly string[] | undefined;
    readonly meta: TMeta | undefined;
  }): Promise<void> {
    if (target.meta !== undefined) {
      throw metaUnsupported();
    }
    for (const key of target.keys ?? []) {
      records.delete(key);
      const version = versionOf(key) + 1;
      versions.delete(key);
      versions.set(key, { version, expiresAt: clock() + ttlMs });
    }
  }

  return { get, set, unset };
}
