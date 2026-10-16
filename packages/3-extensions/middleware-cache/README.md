# @internal/middleware-cache

A read-through cache middleware for Prisma 8 runtimes, for both the SQL and Mongo families.

It caches two kinds of annotated read:

- **An ORM call**, such as `db.orm.public.User.first(...)`, cached as a whole through the `intercept.onActivity` handler. Every ORM terminal method is one `orm-call` activity that carries the user's annotations. On a hit, the middleware supplies the call's result and the ORM sends no statement. On a miss, `activityEnded` stores the value the call returned.
- **A statement**, such as an annotated SQL builder query, through the `intercept.onQuery` handler. On a hit, the middleware returns the cached rows and the driver is never invoked. On a miss, `onRow` buffers the rows from the driver in the statement's `ctx.state`, and `activityEnded` stores them when the read succeeded.

The package depends on no SQL or Mongo package: its runtime dependencies are `@internal/framework-components` and `@internal/utils`. The default key of a statement is `ActivityContext.contentHash(exec)`, which the family runtime populates, and the default key of an ORM call is the call's `activity.contentHash()`, so SQL and Mongo runtimes both work out of the box.

## Responsibilities

- Provide a caching `RuntimeMiddleware` that serves repeated ORM calls through the `intercept.onActivity` handler and repeated statements through the `intercept.onQuery` handler.
- Define the read-only `cacheAnnotation` handle that lane terminals (SQL DSL `.annotate(...)`, ORM read terminals) use to opt a read in, with `key`, `meta` and `bypass`.
- Resolve the cache key: the annotation's `key`; otherwise, for a statement, the `deriveKey` option, which defaults to `ActivityContext.contentHash(exec)`, and for an ORM call, `activity.contentHash()`.
- Store a statement's rows only when the driver completed it (`outcome: 'succeeded'`, `source: 'driver'`), and an ORM call's result only when the call succeeded and returned a value (`null` counts).
- Tag stored values, so a statement's rows and an ORM call's result never stand in for each other under the same key.
- Bypass the cache inside a transaction and on a held connection.
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

// First call: hits the database and stores the call's result under 'user-1'.
const first = await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ key: 'user-1' })),
);

// Second call: served from the cache; the ORM sends no statement.
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

The middleware caches a read that carries `cacheAnnotation`, runs in runtime scope outside any transaction, and does not set `bypass`. For an ORM read the annotation is on the call; the statements the call sends carry none, so the call is cached as a whole and its statements are not cached separately. How long the entry lives is the store's policy; the annotation has no lifetime option.

| Annotation state | Behavior |
|---|---|
| No `cacheAnnotation` on the call or plan | Pass through; never cached. |
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

1. **Per-query override.** `cacheAnnotation({ key })` — the supplied string is used verbatim, and `deriveKey` is not called. The cache middleware does **not** rehash user-supplied keys; the caller is responsible for keeping the string bounded in size and free of sensitive data they do not want flowing into debug logs, Redis `KEYS` output, persistence dumps, or any user-supplied `CacheStore`. User-supplied keys also bypass the storage-hash discrimination below — if you fix a key, prefix it with something tied to your schema version (e.g. `` `${storageHash}:my-key` ``) to avoid serving stale-schema entries after a migration. A key belongs to one query and one terminal method: if `first()` and `all()` share a key, the one that reads the other's stored result fails with `ORM.INTERCEPTED_RESULT_INVALID` or, for a method that accepts the same shape, returns the wrong value. A builder query and an ORM call that share a key evict each other's entries: each misses on the other's value and stores its own in its place. Give each its own key.
2. **`deriveKey`, for statements.** `createCacheMiddleware({ deriveKey })` computes the key of every cached statement whose annotation has no `key` (see [Deriving keys](#deriving-keys)). It takes the statement's execution plan, so it does not apply to an ORM call. An app that relies on `deriveKey` to separate tenants must also separate them for annotated ORM calls, for example with a tenant-prefixed `key`; otherwise one tenant's cached ORM read can be served to another.
3. **Default.** For an ORM call, `await activity.contentHash()`: a digest of `orm-call`, the terminal method and the content hash of the statement the call sends first (for a prepared collection, of the statement with that execution's parameters). It is computed only when the cache asks for it. For a statement, `deriveKeyFromContentHash(exec, ctx)`, which returns `ActivityContext.contentHash(exec)` — the family runtime owns this. The SQL and Mongo runtimes today compose `meta.storageHash + '|' + …` and pipe the result through `hashContent` (SHA-512), producing a bounded, opaque digest of the form `sha512:HEXDIGEST`. The cache middleware uses the returned string directly as the store key.

Two consequences worth pinning (both properties of the **default** key path — user-supplied keys above opt out of both, and a `deriveKey` keeps them only if it builds on the content hash):

- **Storage-hash discrimination.** A schema migration changes `meta.storageHash`, which changes `contentHash`, so entries cached under the old schema are no longer found. Stale-schema reads cannot leak across migrations.
- **AST rewrites are part of the key.** Middleware that rewrite the plan via `beforeCompile` (e.g. soft-delete) run **upstream** of the cache. The cache sees the post-lowering plan, so the rewritten SQL is part of the content hash. Adding or removing a `beforeCompile` middleware changes which entries hit. An ORM call's content hash also runs `beforeCompile`, with the scope of the queryable the call starts on and fresh state, so a `beforeCompile` that reads `ctx.parent` or state can give the call a different digest than the statement it sends.

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

The store is a cache of values. This middleware stores `CachedValue`: the raw rows of one statement, or the result of one ORM call.

```typescript
interface CacheEntry<TMeta = unknown, TValue = CachedValue> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

interface CacheStore<TMeta = unknown, TValue = CachedValue> {
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

type CachedValue =
  | { readonly kind: 'statement-rows'; readonly rows: CachedRows }
  | { readonly kind: 'call-result'; readonly result: unknown };
```

The middleware tags each value it stores with what produced it, `statement-rows` or `call-result`, and serves it only to the same kind of read: under one key, an ORM call's result is a miss for a statement and a statement's rows are a miss for an ORM call. A store treats the value as opaque.

**A store must give back a value equivalent to the one it was given,** `kind` included. A statement's rows hold driver values. An ORM call's result holds the values the ORM returns, after codecs decoded them: `Date`, `bigint`, Temporal values, decimals, and any class an extension codec returns. A store that serializes values therefore needs a serializer that rebuilds the application's types. JSON is not enough: `JSON.stringify` throws on a `bigint`, and a `Date` comes back as a string that the ORM then returns typed as `Date`.

**A deploy that changes what a codec returns needs a new key prefix for a shared store.** The key covers the schema, the statement and its parameters, but not how values are decoded, so without a new prefix the new code is served values the old codecs produced until they expire.

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
- **An error from `get` or `set` fails the read.** The middleware does not catch store errors, for statements and ORM calls alike. A read whose `set` throws fails even though the database answered it, and since nothing was stored, the next read fails the same way for as long as the store keeps throwing: for example, a store that serializes with plain JSON and is given a `bigint`.
- **Compare `meta` by value.** The `meta` passed to `unset` is a different object from the one passed to `get` and `set`. A store shared between processes must serialise `meta` itself.

A store used with this middleware holds cached values: `createCacheMiddleware` takes a `CacheStore<TMeta, CachedValue>`, and a store of any other value type, `unknown` included, is a type error. `TValue` defaults to `CachedValue`, so `CacheStore<TMeta>` is a store of cached values; it exists so the same store type can serve other caches.

The default store lives in one process and is **not** shared across replicas. For shared caching, supply a custom store. The guard for overlapping reads then works across every process that uses the store, because the store owns the versions:

```typescript
import type { CachedValue, CacheStore } from '@internal/middleware-cache';

// Supplied by the application: it must rebuild every type its codecs return, such as Date,
// bigint, Temporal values and extension classes. JSON.stringify and JSON.parse do not.
interface ValueSerializer {
  serialize(value: CachedValue): string;
  deserialize(text: string): CachedValue;
}

const SET_IF_VERSION = `
  if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', 60000)
  return 1`;

function redisStore(serializer: ValueSerializer): CacheStore<unknown, CachedValue> {
  return {
    async get({ key, meta }) {
      const [text, version] = await redisClient.mget(`value:${key}`, `version:${key}`);
      return {
        key,
        meta,
        version: Number(version ?? 0),
        data: text ? { empty: false, value: serializer.deserialize(text) } : { empty: true },
      };
    },
    async set(entry, value) {
      const keys = [`value:${entry.key}`, `version:${entry.key}`];
      const text = serializer.serialize(value);
      return (await redisClient.eval(SET_IF_VERSION, 2, ...keys, text, entry.version)) === 1;
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
}

const redis = redisStore(appSerializer);
const cache = createCacheMiddleware({ store: redis });
```

### The default store

`createInMemoryCacheStore<TMeta>({ maxEntries?, ttlMs?, clock? })` is what `createCacheMiddleware()` uses when no `store` is given. It holds cached values (`CachedValue`).

- **Size.** At most `maxEntries` values, a positive integer (default 1000). Reads and writes both count as a use; the least recently used value is evicted first.
- **Lifetime.** Every value lives `ttlMs` after its `set`, a positive number of milliseconds (default 60 000). `ttlMs: Infinity` never expires. A key's version is kept for `ttlMs` after the `unset` that moved it. Versions are not bounded by `maxEntries`. A forgotten version reads as 0, so with a finite `ttlMs` a read that takes longer than `ttlMs` and overlaps an `invalidate` can store stale rows. With `ttlMs: Infinity`, the versions of invalidated keys are never forgotten and grow with the number of distinct keys invalidated. Any other `maxEntries` or `ttlMs`, such as `0` or `NaN`, throws `RUNTIME.ARGUMENT_INVALID`. Expiry is measured with `clock` (default `Date.now`); an expired value reads as empty and is dropped.
- **Copies.** It keeps statement rows and ORM call results differently. Statement rows are copied one level deep on `set` and `get`: the array, and each row object with its prototype. The driver's values in them, such as BSON `ObjectId`s or a `Buffer`, are kept by reference and shared with every hit. The runtime decodes them on each hit; a codec that returns its wire value unchanged, such as a date or byte-array codec, hands every caller that same shared object. An ORM call's result has its plain structure copied on `set` and on every `get`: plain and null-prototype objects, arrays (their elements only; holes read as `undefined`), `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`, typed arrays (a subclass such as Node's `Buffer` keeps its class) and `DataView` (copied as a plain `DataView`). Every other value in it, such as a class instance (a Temporal value, a decimal, a vector, a BSON value, an error) or a function, is shared by reference with the first caller and every hit. So, once the call has ended, changing the plain objects and arrays of a result changes no later hit; changing a shared value in place does, so codecs should return values that are not mutated in place. The store never refuses a value: `set` returns `false` only when the key's version moved. A miss copies the result once and each hit copies it again: about the work of decoding rows, linear in the size of the result.
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
- **Visible to other middleware.** `meta` sits in the annotations of the ORM call or the plan, so any middleware or telemetry that serialises annotations sees it. Keep secrets out.

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

The middleware neither serves nor stores a read when `ActivityContext.scope` is not `'runtime'` or `ctx.inTransaction()` is true. This holds for ORM calls and statements alike.

- **Inside a transaction,** such as an ORM call on `tx` in `db.transaction(async (tx) => ...)`, the caller expects to read their own writes. Serving would hand the transaction rows from before its own writes, and storing would cache rows that a rollback then erases.
- **On a held connection,** such as `runtime.connection()` or a Supabase role session, the session can change what a read returns. Supabase sets the user's database role on the connection, and the key does not include the role, so serving would leak one user's rows to another.

## Caveats

- **The default store is not coherent across replicas.** Use a custom `CacheStore` (Redis, etc.) for cross-process coherence.
- **Concurrent misses both populate the store.** Two concurrent first-time reads of the same key both run the driver and both store their rows; last writer wins. Request coalescing is out of this package's scope (see [Scope](#scope)).
- **Writes do not invalidate on their own.** The middleware never observes writes. Call `invalidate` after a write that changes cached reads, rely on the store's lifetime to bound staleness, or pass `cacheAnnotation({ bypass: true })` on a read that must be current.
- **The default store shares class instances in an ORM call's result.** It copies the result's plain objects and arrays, but a class instance a codec returned, such as a Temporal value or a decimal, is the same object for the first caller and every hit. Do not mutate such values in place. See [The default store](#the-default-store). A custom store decides for itself whether to copy and what it can store; one that keeps references shares the first caller's object with every later hit.
- **`maxEntries` counts entries, not bytes.** A large result set takes one slot like a small one.

## Scope

This package caches annotated reads in a store and passes data between the annotations and the store without interpreting it; the store decides how to cache. [ADR 266](../../../docs/architecture%20docs/adrs/ADR%20266%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md) records this design and the alternatives it rejected. Its primitives are:

- keys: the annotation `key`, and the `deriveKey` option with its default `deriveKeyFromContentHash`;
- `meta` on the annotation, handed to the store's `get` and `set`;
- `invalidate({ keys, meta })`, handed to the store's `unset`;
- `bypass` on the annotation;
- the `CacheStore` interface, and the default in-memory store.

How long an entry lives, and what `meta` means (tags, groups, per-entry lifetimes), are the store's business. Deciding what to invalidate and when, request coalescing, and routing between several stores are policy, and belong in extensions built on these primitives. Such extensions invalidate through `invalidate` or the store's `unset`; either moves the versions that stop overlapping reads from storing rows that predate the write.

What the primitives do not cover yet:

- **Invalidating as part of the write.** Today the application calls `invalidate` after the write has returned. Invalidating from the write itself must wait for the transaction to commit; otherwise a concurrent reader can refill the entry with the old row before the commit. Every ORM write is an `orm-call` activity that carries the user's annotations, including a write with relation callbacks and its own transaction, and the runtime's `activityFinalized` event fires for it once its effects are final. A write annotation that invalidates from that event is planned.
- **Serve-stale strategies** such as stale-while-revalidate. Only the middleware decides hit or miss, so nothing outside it can serve an expired entry while it re-runs the query.

## See also

- [Runtime & Middleware Framework](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md) for the SPI and middleware lifecycle (including the `intercept.onActivity` and `intercept.onQuery` handlers the cache uses).
- [ADR 204 — Single-tier runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-tier%20runtime.md) for why the cache middleware is family-agnostic by construction.
