import { expectTypeOf, test } from 'vitest';
import type { CachedRows, CacheEntry, CacheMiddleware, CacheStore } from '../src/exports/index';
import * as exported from '../src/exports/index';

const cache = exported.createCacheMiddleware();

test('invalidate accepts keys, meta, both, or neither', () => {
  expectTypeOf(cache.invalidate({ keys: ['user-1'] })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(cache.invalidate({ meta: { tags: ['users'] } })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(cache.invalidate({ keys: ['user-1'], meta: 'users' })).toEqualTypeOf<
    Promise<void>
  >();
  expectTypeOf(cache.invalidate({})).toEqualTypeOf<Promise<void>>();
});

test('invalidate rejects other shapes', () => {
  // @ts-expect-error - tags are not an invalidation target; put them in meta
  cache.invalidate({ tags: ['users'] });

  // @ts-expect-error - a function is not an invalidation target
  cache.invalidate(async () => {});
});

test('createCacheMiddleware accepts only store and deriveKey', () => {
  exported.createCacheMiddleware({ store: exported.createInMemoryCacheStore() });

  // @ts-expect-error - maxEntries moved to createInMemoryCacheStore
  exported.createCacheMiddleware({ maxEntries: 10 });

  // @ts-expect-error - lifetime is the store's policy
  exported.createCacheMiddleware({ defaultTtlMs: 1_000 });

  // @ts-expect-error - clock moved to createInMemoryCacheStore
  exported.createCacheMiddleware({ clock: () => 0 });
});

type Rows = readonly Record<string, unknown>[];

const get = async (target: {
  readonly key: string;
  readonly meta: unknown;
}): Promise<CacheEntry<unknown, Rows>> => ({
  key: target.key,
  meta: target.meta,
  version: 0,
  data: { empty: true },
});
const set = async (_entry: CacheEntry<unknown, Rows>, _value: Rows) => true;
const unset = async (_target: Parameters<CacheStore['unset']>[0]) => {};

test('createInMemoryCacheStore returns a CacheStore of the given meta and value types', () => {
  expectTypeOf(exported.createInMemoryCacheStore()).toEqualTypeOf<CacheStore<unknown, Rows>>();
  expectTypeOf(
    exported.createInMemoryCacheStore<{ tags: string[] }, Rows>({
      maxEntries: 10,
      ttlMs: Number.POSITIVE_INFINITY,
      clock: Date.now,
    }),
  ).toEqualTypeOf<CacheStore<{ tags: string[] }, Rows>>();
});

test('CachedRows is the value type the middleware stores', () => {
  expectTypeOf<CachedRows>().toEqualTypeOf<Rows>();
});

test('CacheEntry carries key, meta, version and data', () => {
  expectTypeOf<CacheEntry<string, number>>().toEqualTypeOf<{
    readonly key: string;
    readonly meta: string | undefined;
    readonly version: number;
    readonly data: { readonly empty: true } | { readonly empty: false; readonly value: number };
  }>();
});

test('createCacheMiddleware accepts a store of rows, including the default store written inline', () => {
  const rowsStore: CacheStore<unknown, Rows> = { get, set, unset };
  expectTypeOf(exported.createCacheMiddleware({ store: rowsStore })).toEqualTypeOf<
    CacheMiddleware<unknown>
  >();
  expectTypeOf(
    exported.createCacheMiddleware({ store: exported.createInMemoryCacheStore() }),
  ).toEqualTypeOf<CacheMiddleware<unknown>>();
  expectTypeOf(
    exported.createCacheMiddleware({
      store: exported.createInMemoryCacheStore({ maxEntries: 10, ttlMs: 5_000 }),
    }),
  ).toEqualTypeOf<CacheMiddleware<unknown>>();
});

test('createCacheMiddleware accepts the default store created on its own line', () => {
  const store = exported.createInMemoryCacheStore({ maxEntries: 10 });

  expectTypeOf(exported.createCacheMiddleware({ store })).toEqualTypeOf<CacheMiddleware<unknown>>();
});

test('createCacheMiddleware refuses a store of any other value type', () => {
  const stringStore = exported.createInMemoryCacheStore<unknown, string>();
  // @ts-expect-error - the middleware stores rows, which a store of strings cannot hold
  exported.createCacheMiddleware({ store: stringStore });

  const unknownStore = exported.createInMemoryCacheStore<unknown, unknown>();
  // @ts-expect-error - a store of unknown values is not a store of rows
  exported.createCacheMiddleware({ store: unknownStore });
});

test('an old positional set is a type error', () => {
  const positionalSet = {
    get,
    set: async (_key: string, _value: Rows, _ttlMs: number) => true,
    unset,
  };

  // @ts-expect-error - set takes the entry and the value
  const store: CacheStore<unknown, Rows> = positionalSet;
  void store;
});

test('an old set({ key, meta, entry, version }) is a type error', () => {
  const objectSet = {
    get,
    set: async (_target: {
      readonly key: string;
      readonly meta: unknown;
      readonly entry: { readonly rows: Rows };
      readonly version: number | undefined;
    }) => true,
    unset,
  };

  // @ts-expect-error - set takes the entry and the value
  const store: CacheStore<unknown, Rows> = objectSet;
  void store;
});

test('a set returning nothing is a type error', () => {
  const voidSet = {
    get,
    set: async (_entry: CacheEntry<unknown, Rows>, _value: Rows) => {},
    unset,
  };

  // @ts-expect-error - set returns whether it stored the value
  const store: CacheStore<unknown, Rows> = voidSet;
  void store;
});

test('an old get(key: string) is a type error', () => {
  const positionalGet = {
    get: async (key: string): Promise<CacheEntry<unknown, Rows>> => ({
      key,
      meta: undefined,
      version: 0,
      data: { empty: true },
    }),
    set,
    unset,
  };

  // @ts-expect-error - get takes { key, meta }
  const store: CacheStore<unknown, Rows> = positionalGet;
  void store;
});

test('a get returning { entry, version } is a type error', () => {
  const wrappedGet = {
    get: async (_target: Parameters<CacheStore['get']>[0]) => ({ entry: undefined, version: 0 }),
    set,
    unset,
  };

  // @ts-expect-error - get returns a CacheEntry
  const store: CacheStore<unknown, Rows> = wrappedGet;
  void store;
});

test('an old positional unset(key) is a type error', () => {
  const positionalUnset = { get, set, unset: async (_key: string) => {} };

  // @ts-expect-error - unset takes one object argument
  const store: CacheStore<unknown, Rows> = positionalUnset;
  void store;
});

test('a store without unset is a type error', () => {
  const noUnset = { get, set };

  // @ts-expect-error - unset is required
  const store: CacheStore<unknown, Rows> = noUnset;
  void store;
});

test('the package exports deriveKeyFromContentHash', () => {
  expectTypeOf(exported.deriveKeyFromContentHash).toBeFunction();
});

test('deriveKey composes with deriveKeyFromContentHash', () => {
  exported.createCacheMiddleware({
    deriveKey: async (exec, ctx) => `users:${await exported.deriveKeyFromContentHash(exec, ctx)}`,
  });
});
