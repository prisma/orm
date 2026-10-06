# @prisma/orm-extension-middleware-cache

Opt-in query caching for Prisma 8 runtimes, for both the SQL and Mongo families.

```bash
pnpm add @prisma/orm-extension-middleware-cache
```

The whole surface is the package root:

```ts
import {
  cacheAnnotation,
  createCacheMiddleware,
  createInMemoryCacheStore,
  deriveKeyFromContentHash,
  type CacheStore,
} from '@prisma/orm-extension-middleware-cache';
```

## Responsibilities

A read-through cache middleware: on a hit it returns cached rows and never invokes the driver; on a miss it buffers the driver's rows and stores them when the read completes. A read opts in with `cacheAnnotation({ key?, meta?, bypass? })`: `key` names the entry, otherwise the `deriveKey` option computes it (default: the family runtime's content hash, `deriveKeyFromContentHash`); `meta` is handed to the store with the entry; `bypass: true` skips the cache for that call. Connection- and transaction-scoped executions bypass the cache.

How long an entry lives is the store's policy. The default store, `createInMemoryCacheStore({ maxEntries?, ttlMs?, clock? })`, keeps up to 1000 values for 60 seconds each; `ttlMs: Infinity` never expires. A key's version is kept for `ttlMs` after the `unset` that moved it. Versions are not bounded by `maxEntries`. A forgotten version reads as 0, so with a finite `ttlMs` a read that takes longer than `ttlMs` and overlaps an `invalidate` can store stale rows. With `ttlMs: Infinity`, the versions of invalidated keys are never forgotten and grow with the number of distinct keys invalidated. A `maxEntries` that is not a positive integer or a `ttlMs` that is not positive throws `RUNTIME.ARGUMENT_INVALID`. Implement the `CacheStore` interface to use Redis, Memcached, or any other backend.

## The store

The store is a cache of values; this middleware stores `CachedRows`, the raw rows of one read.

```ts
interface CacheEntry<TMeta = unknown, TValue = CachedRows> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

interface CacheStore<TMeta = unknown, TValue = CachedRows> {
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

type CachedRows = readonly Record<string, unknown>[];
```

The store keeps a version per key, even for a key that holds no value; a key never seen has version 0, and only `unset` changes it. `get({ key, meta })` always returns a `CacheEntry` with the key, the read annotation's `meta`, the current version and `data`, which is `{ empty: true }` on a miss. A store that matches `meta` folds the versions of whatever `meta` names into that version, and does the same when `set` compares, so an `invalidate({ meta })` refuses an overlapping read's `set` even for a key the store has never seen. `set(entry, value)` stores `value` if and only if the key's version still equals `entry.version`, and returns whether it stored; there is no unconditional write, so a prefill is `get` then `set`. `unset` removes every value named in `keys` (`undefined` or non-empty) and every value that matches `meta`, increments the version of every key it removes or would remove, and an `unset` by key also drops that key from any `meta` index. `set` must be atomic against `unset`: one synchronous step in memory, or one script on a server. Keep a moved version at least as long as a read can take; the default store keeps it for `ttlMs`. The store interprets `meta` in all three methods; the middleware never does. A store that cannot act on a `meta` given to `unset` must throw: the default store throws `RUNTIME.CACHE_STORE_META_UNSUPPORTED`. `unset` must not run queries through the runtime that uses the middleware. A store used with this middleware holds rows: `createCacheMiddleware` takes a `CacheStore<TMeta, CachedRows>`, and a store of any other value type, `unknown` included, is a type error. `TValue` defaults to `CachedRows`, so `CacheStore<TMeta>` is a store of rows; it exists so the same store type can serve other caches. The default store, `createInMemoryCacheStore()`, holds rows unless you give it another value type.

## Typed meta

`CacheStore<TMeta>`, `createCacheMiddleware` and `cacheAnnotation<TMeta>` take the shape of `meta` as a type parameter; it defaults to `unknown`. `createCacheMiddleware` infers it from the store, so `invalidate` accepts only that shape:

```typescript
interface TagMeta {
  tags: string[];
}

class TagStore implements CacheStore<TagMeta> {
  // get({ key, meta }), set(entry, value) and unset({ keys, meta }), with meta: TagMeta | undefined
}

const cache = createCacheMiddleware({ store: new TagStore() }); // CacheMiddleware<TagMeta>
await cache.invalidate({ meta: { tags: ['users'] } }); // compiles
await cache.invalidate({ meta: { tag: 'users' } }); // type error
```

Nothing ties the annotation's `TMeta` to the store's at compile time, because the annotation is written where the query is and the store where the middleware is set up. A store package should therefore export a wrapper typed with its own meta, so the two agree:

```typescript
export const cached = (o: CacheAnnotationOptions<TagMeta>) => cacheAnnotation<TagMeta>(o);
```

## Deriving keys

`createCacheMiddleware({ deriveKey })` computes the key of every cached read whose annotation has no `key`. Build on the default to add a prefix:

```ts
const cache = createCacheMiddleware({
  deriveKey: async (exec, ctx) => `users:${await deriveKeyFromContentHash(exec, ctx)}`,
});
```

An explicit annotation `key` is used literally and bypasses `deriveKey`, so a tenant or namespace prefix must be part of it too. A derivation that returns the same key for different plans serves one plan's rows to the other, and one that drops the content hash no longer changes on a schema migration. If `deriveKey` throws, the read fails.

## Invalidation

`invalidate({ keys?, meta? })` removes entries through one `store.unset({ keys, meta })` call, and does nothing when there are no keys and no `meta`.

```ts
const cache = createCacheMiddleware();

await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ key: 'user-1' })),
);

await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ keys: ['user-1'] });
```

A read that missed before an `invalidate` and finishes after it does not store its rows. Its `store.get` returned an empty entry with, say, version 3; the `unset` moves the key to version 4; `store.set(entry, rows)` then returns `false`. This works across processes that share a store, because the store owns the version. Call `invalidate` after the write has committed: inside a transaction, another request can put the old rows back in the cache before the commit. An error from the store propagates.

A tag scheme is a store policy: `cacheAnnotation({ meta: { tags: ['users'] } })` on the read, a store that indexes `meta.tags` in `set`, and `cache.invalidate({ meta: { tags: ['users'] } })` after the write.

## Scope

The middleware is a read-through cache with a control surface: keys and `deriveKey`, `meta`, `bypass`, `invalidate`, and the `CacheStore` interface. It carries data between the annotations and the store and never interprets it. Lifetime and the meaning of `meta` are the store's; deciding what to invalidate and when, request coalescing and routing between several stores belong in extensions built on these primitives.

Invalidating as part of a write is not supported yet: it must wait for the transaction to commit, including the transactions the ORM opens for its own `update()` and `delete()`, and the runtime has no post-commit hook. Until then, call `invalidate` after the write returns. Serve-stale strategies such as stale-while-revalidate need the hit-or-miss decision, which only the middleware makes.
