# @internal/middleware-cache

A read-through cache middleware for Prisma 8 runtimes, for both the SQL and Mongo families.

Built on the `interceptQuery` hook on `RuntimeMiddleware`: on a cache hit, the middleware returns the cached rows and the driver is never invoked. On a cache miss, it buffers the rows from the driver and stores them when the read completes.

The package depends on no SQL or Mongo package: its runtime dependencies are `@internal/framework-components` and `@internal/utils`. The default cache key is `RuntimeMiddlewareContext.contentHash(exec)`, which the family runtime populates, so SQL and Mongo runtimes both work out of the box.

## Responsibilities

- Provide a caching `RuntimeMiddleware` that serves repeated reads from a store through the `interceptQuery` hook.
- Define the read-only `cacheAnnotation` handle that lane terminals (SQL DSL `.annotate(...)`, ORM read terminals) use to opt a read in, with `key`, `meta` and `bypass`.
- Resolve the cache key per execution: the annotation's `key`, otherwise the `deriveKey` option, which defaults to `RuntimeMiddlewareContext.contentHash(exec)`.
- Store driver rows only when the read completed from the driver (`completed: true && source: 'driver'`).
- Bypass the cache when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`.
- Remove entries on request through `invalidate({ keys, meta })`, and stop a read that overlapped it from storing its rows.
- Define the `CacheStore` interface, and ship a default in-memory store with a size bound and one lifetime for every entry.

## Quick start

```typescript
import postgres from '@internal/postgres/runtime';
import { cacheAnnotation, createCacheMiddleware } from '@internal/middleware-cache';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const cache = createCacheMiddleware(); // default store: in memory, 1000 entries, 60 s
const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: [cache],
});

// First call: hits the database and stores the raw rows under 'user-1'.
const first = await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ key: 'user-1' })),
);

// Second call: served from the cache; the driver is not invoked.
const second = await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ key: 'user-1' })),
);

// After a write, remove the entry so the next read sees it.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ keys: ['user-1'] });

// Un-annotated reads are never cached.
const fresh = await db.orm.public.User.first({ id: 1 });
```

## Opt-in by annotation

The middleware caches a read that carries `cacheAnnotation`, runs in runtime scope, and does not set `bypass`. How long the entry lives is the store's policy; the annotation has no lifetime option.

| Annotation state | Behavior |
|---|---|
| No `cacheAnnotation` on the plan | Pass through; never cached. |
| `cacheAnnotation({})` | Cache lookup under the derived key; store on miss and success. |
| `cacheAnnotation({ key })` | As above, under the supplied key, used verbatim. |
| `cacheAnnotation({ meta })` | As above; `meta` is passed to `store.get`, and to `store.set` on the entry `get` returned (see [meta](#meta)). |
| `cacheAnnotation({ bypass: true })` | Pass through: neither read from nor write to the cache. |

The annotation is **read-only**: it declares `applicableTo: ['read']`, so a write terminal rejects it both at compile time and at run time. The middleware itself has no way to cache a write.

```typescript
// ✓ ORM read terminal accepts the read-only annotation via the meta callback.
await db.orm.public.User.first({ id }, (meta) => meta.annotate(cacheAnnotation({})));

// ✓ Pass `undefined` as the filter to attach an annotation without narrowing further.
await db.orm.public.User.first(undefined, (meta) => meta.annotate(cacheAnnotation({})));

// ✗ Type error: a write terminal rejects the read-only annotation.
await db.orm.public.User.create(input, (meta) => meta.annotate(cacheAnnotation({})));

// ✓ SQL DSL: chainable on select / grouped builders.
const plan = db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .annotate(cacheAnnotation({}))
  .build();
```

## Cache key composition

Three-tier resolution:

1. **Per-query override.** `cacheAnnotation({ key })` — the supplied string is used verbatim, and `deriveKey` is not called. The cache middleware does **not** rehash user-supplied keys; the caller is responsible for keeping the string bounded in size and free of sensitive data they do not want flowing into debug logs, Redis `KEYS` output, persistence dumps, or any user-supplied `CacheStore`. User-supplied keys also bypass the storage-hash discrimination below — if you fix a key, prefix it with something tied to your schema version (e.g. `` `${storageHash}:my-key` ``) to avoid serving stale-schema entries after a migration.
2. **`deriveKey`.** `createCacheMiddleware({ deriveKey })` computes the key of every cached read whose annotation has no `key` (see [Deriving keys](#deriving-keys)).
3. **Default.** `deriveKeyFromContentHash(exec, ctx)`, which returns `RuntimeMiddlewareContext.contentHash(exec)` — the family runtime owns this. The SQL and Mongo runtimes today compose `meta.storageHash + '|' + …` and pipe the result through `hashContent` (SHA-512), producing a bounded, opaque digest of the form `sha512:HEXDIGEST`. The cache middleware uses the returned string directly as the store key.

Two consequences worth pinning (both properties of the **default** key path — user-supplied keys above opt out of both, and a `deriveKey` keeps them only if it builds on the content hash):

- **Storage-hash discrimination.** A schema migration changes `meta.storageHash`, which changes `contentHash`, so entries cached under the old schema are no longer found. Stale-schema reads cannot leak across migrations.
- **AST rewrites are part of the key.** Middleware that rewrite the plan via `beforeCompile` (e.g. soft-delete) run **upstream** of the cache. The cache sees the post-lowering plan, so the rewritten SQL is part of the content hash. Adding or removing a `beforeCompile` middleware changes which entries hit.

### Deriving keys

`deriveKey(exec, ctx)` returns the key (or a promise of it) for a read that is being cached and has no annotation `key`. It runs on every such read, hit or miss, and never on a read the cache bypasses. Compose it with the exported default to add a prefix:

```typescript
import { createCacheMiddleware, deriveKeyFromContentHash } from '@internal/middleware-cache';

const cache = createCacheMiddleware({
  deriveKey: async (exec, ctx) => `users:${await deriveKeyFromContentHash(exec, ctx)}`,
});
```

- **An explicit annotation `key` bypasses `deriveKey`.** It is used literally, so a tenant or namespace prefix that `deriveKey` adds must also be part of every explicit key.
- **Keys must differ whenever the rows can differ.** A derivation that returns the same key for two different plans serves one plan's rows to the other.
- **Keep the content hash.** A derivation that drops it loses the storage-hash discrimination above, so a migration no longer invalidates cached entries.
- **Errors fail the read.** If `deriveKey` throws or rejects, the read fails; the cache does not fall back to the database. Its latency is added to every cached read, including hits.

## `CacheStore`

The store is a cache of values. This middleware stores `CachedRows`, the raw rows of one read.

```typescript
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

The store keeps a **version** per key: an integer it keeps even for a key that holds no value. A key never seen has version 0. Only `unset` changes a version.

- `get({ key, meta })` always returns a `CacheEntry`: the key, the `meta` the read supplied (the read annotation's `meta`, or `undefined`), the key's current version, and `data`. `data.empty` is `true` on a miss; otherwise `data.value` is the stored value. A store that matches `meta` folds the versions of whatever `meta` names into the version it returns, and does the same when `set` compares, so an `invalidate({ meta })` refuses an overlapping read's `set` even for a key the store has never seen.
- `set(entry, value)` stores `value` under `entry.key` with `entry.meta` if and only if the key's current version still equals `entry.version`, and returns whether it stored. `entry` is the one `get` returned, empty or not; refreshing a value passes the non-empty entry. `set` never changes a version. There is no unconditional write: to prefill the cache, call `get` and then `set`.
- `unset` removes every value named in `keys` and every value that matches `meta`, in one call so the store can batch them, and increments the version of every key it removes or would remove, including keys that hold no value. `keys` is either `undefined` or non-empty.

The rules a store must follow:

- **The store interprets `meta`; the middleware never does.** A store that does not index `meta` must throw when `unset` receives a `meta` it cannot act on. An invalidation is never silently ignored.
- **An `unset` by key also drops that key from any `meta` index the store keeps.**
- **Lifetime and eviction are the store's policy.** A store that wants per-entry lifetimes reads them from `meta`.
- **`set` must be atomic against `unset`.** Comparing the version and writing the value must be one step that no `unset` of the same key can fall between: one synchronous step in memory, or one script (for example a Lua script) on a server. The middleware's guard against overlapping reads relies on this.
- **Keep a moved version at least as long as a read can take.** A version that falls back to 0 too early lets a read that started before the `unset` store its rows.
- **`unset` must not run a query through the runtime that uses the middleware.**
- **Compare `meta` by value.** The `meta` passed to `unset` is a different object from the one passed to `get` and `set`. A store shared between processes must serialise `meta` itself.

A store used with this middleware holds rows: `createCacheMiddleware` takes a `CacheStore<TMeta, CachedRows>`, and a store of any other value type, `unknown` included, is a type error. `TValue` defaults to `CachedRows`, so `CacheStore<TMeta>` is a store of rows; it exists so the same store type can serve other caches.

The default store lives in one process and is **not** shared across replicas. For shared caching, supply a custom store. The guard for overlapping reads then works across every process that uses the store, because the store owns the versions:

```typescript
import type { CachedRows, CacheStore } from '@internal/middleware-cache';

const SET_IF_VERSION = `
  if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', 60000)
  return 1`;

const redis: CacheStore<unknown, CachedRows> = {
  async get({ key, meta }) {
    const [raw, version] = await redisClient.mget(`value:${key}`, `version:${key}`);
    return {
      key,
      meta,
      version: Number(version ?? 0),
      data: raw ? { empty: false, value: JSON.parse(raw) as CachedRows } : { empty: true },
    };
  },
  async set(entry, value) {
    const keys = [`value:${entry.key}`, `version:${entry.key}`];
    const json = JSON.stringify(value);
    return (await redisClient.eval(SET_IF_VERSION, 2, ...keys, json, entry.version)) === 1;
  },
  async unset({ keys, meta }) {
    if (meta !== undefined) {
      throw new Error('This store does not index meta');
    }
    for (const key of keys ?? []) {
      await redisClient
        .multi()
        .del(`value:${key}`)
        .incr(`version:${key}`)
        .pexpire(`version:${key}`, 60_000)
        .exec();
    }
  },
};

const cache = createCacheMiddleware({ store: redis });
```

### The default store

`createInMemoryCacheStore<TMeta, TValue>({ maxEntries?, ttlMs?, clock? })` is what `createCacheMiddleware()` uses when no `store` is given. It holds rows (`CachedRows`) unless you give it another value type.

- **Size.** At most `maxEntries` values, a positive integer (default 1000). Reads and writes both count as a use; the least recently used value is evicted first.
- **Lifetime.** Every value lives `ttlMs` after its `set`, a positive number of milliseconds (default 60 000). `ttlMs: Infinity` never expires. A key's version is kept for `ttlMs` after the `unset` that moved it. Versions are not bounded by `maxEntries`. A forgotten version reads as 0, so with a finite `ttlMs` a read that takes longer than `ttlMs` and overlaps an `invalidate` can store stale rows. With `ttlMs: Infinity`, the versions of invalidated keys are never forgotten and grow with the number of distinct keys invalidated. Any other `maxEntries` or `ttlMs`, such as `0` or `NaN`, throws `RUNTIME.ARGUMENT_INVALID`. Expiry is measured with `clock` (default `Date.now`); an expired value reads as empty and is dropped.
- **`meta`.** `get` and `set` ignore it. `unset({ keys })` removes those keys; `unset` with any `meta` other than `undefined`, including `null`, throws `RUNTIME.CACHE_STORE_META_UNSUPPORTED` and removes nothing.

To change the defaults, create the store yourself:

```typescript
const cache = createCacheMiddleware({
  store: createInMemoryCacheStore({ maxEntries: 10_000, ttlMs: 5 * 60_000 }),
});
```

## meta

`cacheAnnotation({ meta })` hands any value to the store with the entry. The middleware never reads it. Stores use it to group entries, for example by tag, or to give an entry its own lifetime.

- **Passed by reference.** The store's `get` receives the object you passed when the read starts, and its `set` receives it again on the entry, after the read's rows have all arrived. Do not mutate it in between.
- **Visible to other middleware.** `meta` sits in `plan.meta.annotations`, so any middleware or telemetry that serialises annotations sees it. Keep secrets out.

A tag-based policy lives in the store. `set` indexes `meta.tags`; `unset({ meta: { tags } })` removes every entry with one of those tags:

```typescript
await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ meta: { tags: ['users'] } })),
);

await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ meta: { tags: ['users'] } });
```

### Typed meta

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

## Invalidation

`invalidate({ keys?, meta? })` removes entries through one `store.unset({ keys, meta })` call.

- `keys` are compared literally with the key each entry was stored under: the annotation's `key`, or what `deriveKey` returned.
- `meta` is passed to the store as is. The default store rejects it (see [The default store](#the-default-store)).
- With empty or absent `keys` and no `meta`, `invalidate` does nothing.

Rules:

- **Call it after the write has committed.** `invalidate` works from any scope, but if you call it inside a transaction, another request can read the old rows before the commit and put them back in the cache. Invalidate once the transaction has returned.
- **Overlapping reads.** A read that missed the cache before an `invalidate` and finishes after it does not store its rows, because they may predate the write. For example: the read's `store.get` returns an empty entry with version 3; the `invalidate` makes `unset` move the key to version 4; when the read completes, `store.set(entry, rows)` compares 3 with 4 and returns `false`. Only reads for keys the `unset` removes or would remove are affected. Each skipped store is logged at debug level as `middleware.cache.store-skipped` with the key.
- **Across processes.** The guard works across processes that share a store, because the store owns the version. Calling the store's `unset` directly moves the versions too.
- **Until `invalidate` resolves,** reads can still return entries it has not removed yet.
- **Store errors propagate.** If `unset` rejects, `invalidate` rejects with that error. Whether overlapping reads still store depends on how far the store got.

## Transaction-scope guard

The middleware bypasses the cache entirely when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`. Only top-level `runtime.query` (`scope === 'runtime'`) consults the store.

- Inside a transaction, the caller expects to read their own writes. The cache cannot serve those reads without tracking the transaction's pending writes.
- On a checked-out connection (`runtime.connection().query(...)`), the caller has stepped outside the shared runtime surface and likely does not expect the global cache to inject results.

## Caveats

- **The default store is not coherent across replicas.** Use a custom `CacheStore` (Redis, etc.) for cross-process coherence.
- **Concurrent misses both populate the store.** Two concurrent first-time reads of the same key both run the driver and both store their rows; last writer wins. Request coalescing is out of this package's scope (see [Scope](#scope)).
- **Writes do not invalidate on their own.** The middleware never observes writes. Call `invalidate` after a write that changes cached reads, rely on the store's lifetime to bound staleness, or pass `cacheAnnotation({ bypass: true })` on a read that must be current.
- **`maxEntries` counts entries, not bytes.** A large result set takes one slot like a small one.

## Scope

This package is a read-through cache with a control surface. It carries data between the annotations and the store and never interprets it. Its primitives are:

- keys: the annotation `key`, and the `deriveKey` option with its default `deriveKeyFromContentHash`;
- `meta` on the annotation, handed to the store's `get` and `set`;
- `invalidate({ keys, meta })`, handed to the store's `unset`;
- `bypass` on the annotation;
- the `CacheStore` interface, and the default in-memory store.

How long an entry lives, and what `meta` means (tags, groups, per-entry lifetimes), are the store's business. Deciding what to invalidate and when, request coalescing, and routing between several stores are policy, and belong in extensions built on these primitives. Such extensions invalidate through `invalidate` or the store's `unset`; either moves the versions that stop overlapping reads from storing rows that predate the write.

What the primitives do not cover yet:

- **Invalidating as part of the write.** Today the application calls `invalidate` after the write has returned. Invalidating from the write itself must wait for the transaction to commit, including the transactions the ORM opens for its own `update()` and `delete()`; otherwise a concurrent reader can refill the entry with the old row before the commit. The runtime has no post-commit hook yet. A write annotation that invalidates after the commit is planned once that hook exists.
- **Serve-stale strategies** such as stale-while-revalidate. Only the middleware decides hit or miss, so nothing outside it can serve an expired entry while it re-runs the query.

## See also

- [Runtime & Middleware Framework](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md) for the SPI and middleware lifecycle (including the `interceptQuery` hook the cache uses).
- [ADR 204 — Single-tier runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-tier%20runtime.md) for why the cache middleware is family-agnostic by construction.
