import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';

/**
 * The rows one statement produced, stored raw (undecoded). The SQL runtime decodes intercepted rows
 * the same way as driver rows, so a hit and a miss yield the same values to the consumer.
 */
export type CachedRows = readonly Record<string, unknown>[];

/**
 * The value type the cache middleware stores: a statement's raw rows, or the result of a client activity, such as an ORM call. The middleware tags each value with what produced it: `statement-rows` for a statement's rows, `call-result` for a client activity's result. It serves `statement-rows` only to a statement and `call-result` only to a client activity; under one key, a value with the other tag is a miss.
 */
export type CachedValue =
  | { readonly kind: 'statement-rows'; readonly rows: CachedRows }
  | { readonly kind: 'call-result'; readonly result: unknown };

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
export interface CacheEntry<TMeta = unknown, TValue = CachedValue> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

/**
 * A cache of values that the cache middleware reads from and writes to. The middleware stores
 * `CachedValue`.
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
 * `get` must give back a value equivalent to the one `set` was given, `kind` included. A call result holds the values codecs decoded, such as a `Date`, a `bigint`, a Temporal value or an extension's class instance, so a store that serializes needs a serializer that rebuilds those types; JSON does not.
 *
 * Lifetime, eviction and whether values are copied are the store's policy; the middleware hands `set` the value it returns to its caller, so a store that keeps references shares that object. A version that `unset` moved must be kept at least as long as a read can take, so that a read that started before the `unset` cannot store. `unset` must not run queries through the runtime that uses the middleware.
 *
 * `TMeta` is the shape of `meta` the store understands. The middleware does not check that a read
 * annotation's `meta` has this shape; see `cacheAnnotation`.
 */
export interface CacheStore<TMeta = unknown, TValue = CachedValue> {
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

const typedArraySlice: (this: ArrayBufferView) => ArrayBufferView = Reflect.get(
  Object.getPrototypeOf(Uint8Array.prototype),
  'slice',
);

/**
 * A copy of the plain structure of `value`: plain and null-prototype objects, arrays, `Map`, `Set`,
 * `Date`, `RegExp`, `ArrayBuffer`, typed arrays and `DataView` are copied, and every other value,
 * such as a class instance or a function, is kept by reference. A typed array is copied with
 * `TypedArray.prototype.slice`, which keeps its class, so a `Buffer` copies to a `Buffer` with its
 * own memory; a `DataView` copies to a plain `DataView`; an array copies to its elements only, with
 * holes read as `undefined`. Shared references and cycles are kept.
 */
function copyValue<T>(value: T, copies = new Map<object, unknown>()): T {
  if (typeof value !== 'object' || value === null) return value;
  const known = copies.get(value);
  if (known !== undefined) {
    return blindCast<T, 'the copy of a value has the type of the value'>(known);
  }
  const copy = copyObject(value, copies);
  copies.set(value, copy);
  return blindCast<T, 'the copy of a value has the type of the value'>(copy);
}

function copyObject(value: object, copies: Map<object, unknown>): unknown {
  if (value instanceof DataView) {
    const start = value.byteOffset;
    return new DataView(value.buffer.slice(start, start + value.byteLength));
  }
  if (ArrayBuffer.isView(value)) return typedArraySlice.call(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype === ArrayBuffer.prototype && value instanceof ArrayBuffer) return value.slice(0);
  if (prototype === Date.prototype && value instanceof Date) return new Date(value.getTime());
  if (prototype === RegExp.prototype && value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }
  if (prototype === Map.prototype && value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    copies.set(value, copy);
    for (const [key, entry] of value) copy.set(copyValue(key, copies), copyValue(entry, copies));
    return copy;
  }
  if (prototype === Set.prototype && value instanceof Set) {
    const copy = new Set<unknown>();
    copies.set(value, copy);
    for (const entry of value) copy.add(copyValue(entry, copies));
    return copy;
  }
  if (prototype === Array.prototype && Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const entry of value) copy.push(copyValue(entry, copies));
    return copy;
  }
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy: Record<string | symbol, unknown> = Object.create(prototype);
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, key)) {
      copy[key] = copyValue(Reflect.get(value, key), copies);
    }
  }
  return copy;
}

/** Statement rows hold driver values, such as BSON `ObjectId`s, that this package cannot copy. So the array and each row object are copied, each row keeping its prototype, and the driver's values are kept by reference and shared with every hit. */
function copyRows(rows: CachedRows): CachedRows {
  return rows.map((row) => {
    const copy: Record<string, unknown> = Object.create(Object.getPrototypeOf(row));
    return Object.assign(copy, row);
  });
}

function copyStored(value: CachedValue): CachedValue {
  switch (value.kind) {
    case 'statement-rows':
      return { kind: 'statement-rows', rows: copyRows(value.rows) };
    case 'call-result':
      return { kind: 'call-result', result: copyValue(value.result) };
  }
}

interface StoredRecord {
  readonly value: CachedValue;
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
 * The default cache store: a least-recently-used map of `CachedValue` with one lifetime for every value, local to the process. Statement rows are copied one level deep on `set` and `get`: the array, and each row object with its prototype. The driver's values in them are kept by reference and shared with every hit; the runtime decodes them on each hit, and a codec that returns its wire value unchanged, such as a date or byte-array codec, hands that shared object to the caller. A call result has its plain structure copied on `set` and on every `get`: plain and null-prototype objects, arrays (their elements only; holes read as `undefined`), `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`, typed arrays (a subclass such as Node's `Buffer` keeps its class) and `DataView` (copied as a plain `DataView`). Every other value in it, such as a class instance (a Temporal value, a BSON value, an error) or a function, is shared by reference. So after `set` returns, a change to the plain structure of the value `set` was given, or of a value `get` returned, reaches no later `get`; a change made to a shared value, or made before `set`, does. It never refuses a value: `set` returns `false` only when the version moved. A key's version is kept for `ttlMs` after the `unset` that moved it (see `InMemoryCacheStoreOptions`). It ignores `meta` in `get` and `set`, and its `unset` rejects any `meta`, including `null`, before changing anything. It throws `RUNTIME.ARGUMENT_INVALID` for a `maxEntries` or `ttlMs` outside the ranges above.
 */
export function createInMemoryCacheStore<TMeta = unknown>(
  options?: InMemoryCacheStoreOptions,
): CacheStore<TMeta, CachedValue> {
  const maxEntries = options?.maxEntries ?? 1000;
  const ttlMs = options?.ttlMs ?? 60_000;
  const clock = options?.clock ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw invalidOption('maxEntries', maxEntries, 'a positive integer');
  }
  if (!(ttlMs > 0)) {
    throw invalidOption('ttlMs', ttlMs, 'a positive number of milliseconds, or Infinity');
  }
  const records = new Map<string, StoredRecord>();
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

  function liveRecord(key: string): StoredRecord | undefined {
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
  }): Promise<CacheEntry<TMeta, CachedValue>> {
    const record = liveRecord(target.key);
    return {
      key: target.key,
      meta: target.meta,
      version: versionOf(target.key),
      data:
        record === undefined ? { empty: true } : { empty: false, value: copyStored(record.value) },
    };
  }

  async function set(entry: CacheEntry<TMeta, CachedValue>, value: CachedValue): Promise<boolean> {
    if (entry.version !== versionOf(entry.key)) {
      return false;
    }
    records.delete(entry.key);
    records.set(entry.key, { value: copyStored(value), expiresAt: clock() + ttlMs });
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
