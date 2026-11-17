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
  invalidateAnnotation,
  type CacheStore,
} from '@prisma/orm-extension-middleware-cache';
```

## Responsibilities

A read-through cache middleware. An annotated ORM call, such as `db.orm.public.User.first(...)`, is cached as a whole: on a hit the middleware supplies the call's result and the ORM sends no statement; on a miss it stores the value the call returned. An annotated statement, such as a SQL builder query, is cached as rows: on a hit it returns the cached rows and never invokes the driver; on a miss it buffers the driver's rows and stores them when the read completes. A read opts in with `cacheAnnotation({ key?, meta?, bypass? })`: `key` names the entry; otherwise an ORM call is keyed by its content hash, a digest of the terminal method and the statement it sends, and a statement by the `deriveKey` option (default: the family runtime's content hash, `deriveKeyFromContentHash`); `meta` is handed to the store with the entry; `bypass: true` skips the cache for that call. A read inside a transaction or on a held connection, such as a Supabase role session, is neither served nor stored. A write annotated with `invalidateAnnotation({ keys?, meta? })` removes those entries once its effects are final.

How long an entry lives is the store's policy. The default store, `createInMemoryCacheStore({ maxEntries?, ttlMs?, clock? })`, keeps up to 1000 values for 60 seconds each; `ttlMs: Infinity` never expires. A key's version is kept for `ttlMs` after the `unset` that moved it. Versions are not bounded by `maxEntries`. A forgotten version reads as 0, so with a finite `ttlMs` a read that takes longer than `ttlMs` and overlaps an `invalidate` can store stale rows. With `ttlMs: Infinity`, the versions of invalidated keys are never forgotten and grow with the number of distinct keys invalidated. A `maxEntries` that is not a positive integer or a `ttlMs` that is not positive throws `RUNTIME.ARGUMENT_INVALID`. Implement the `CacheStore` interface to use Redis, Memcached, or any other backend.

## The store

The store is a cache of values; this middleware stores `CachedValue`, the raw rows of one statement or the result of one ORM call. The middleware tags each value `statement-rows` or `call-result` and serves it only to the same kind of read; under one key, a value with the other tag is a miss.

```ts
interface CacheEntry<TMeta = unknown, TValue = CachedValue> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

interface CacheStore<TMeta = unknown, TValue = CachedValue> {
  get(target: {
    readonly key: string;
    readonly meta?: TMeta | undefined;
  }): Promise<CacheEntry<TMeta, TValue>>;
  set(entry: CacheEntry<TMeta, TValue>, value: TValue): Promise<boolean>;
  unset(target: {
    readonly keys?: readonly string[] | undefined;
    readonly meta?: TMeta | undefined;
  }): Promise<void>;
}

type CachedRows = readonly Record<string, unknown>[];

type CachedValue =
  | { readonly kind: 'statement-rows'; readonly rows: CachedRows }
  | { readonly kind: 'call-result'; readonly result: unknown };
```

The store keeps a version per key, even for a key that holds no value; a key never seen has version 0, and only `unset` changes it. `get({ key, meta })` always returns a `CacheEntry` with the key, the read annotation's `meta`, the current version and `data`, which is `{ empty: true }` on a miss. A store that matches `meta` folds the versions of whatever `meta` names into that version, and does the same when `set` compares, so an `invalidate({ meta })` refuses an overlapping read's `set` even for a key the store has never seen. `set(entry, value)` stores `value` if and only if the key's version still equals `entry.version`, and returns whether it stored; there is no unconditional write, so a prefill is `get` then `set`. `unset` removes every value named in `keys` (`undefined` or non-empty) and every value that matches `meta`, increments the version of every key it removes or would remove, and an `unset` by key also drops that key from any `meta` index. A field the caller leaves out of `get` or `unset` means the same as `undefined`, and a store must not tell the two apart. `set` must be atomic against `unset`: one synchronous step in memory, or one script on a server. Keep a moved version at least as long as a read can take; the default store keeps it for `ttlMs`. The store interprets `meta` in all three methods; the middleware never does. A store that cannot act on a `meta` given to `unset` must throw: the default store throws `RUNTIME.CACHE_STORE_META_UNSUPPORTED`. `unset` must not run queries through the runtime that uses the middleware. An error from `get` or `set` fails the read, for statements and ORM calls alike, even when the database answered it; nothing is stored, so the next read fails the same way while the store keeps throwing. A store used with this middleware holds cached values: `createCacheMiddleware` takes a `CacheStore<TMeta, CachedValue>`, and a store of any other value type, `unknown` included, is a type error. `TValue` defaults to `CachedValue`, so `CacheStore<TMeta>` is a store of cached values; it exists so the same store type can serve other caches. A store must give back a value equivalent to the one it was given, `kind` included. An ORM call's result holds the values codecs decoded, such as `Date`, `bigint`, Temporal values and extension class instances, so a store that serializes needs an application-supplied serializer that rebuilds those types; `JSON.stringify` throws on a `bigint` and turns a `Date` into a string. A deploy that changes what a codec returns needs a new key prefix for a shared store, because the key does not cover how values are decoded. The default store, `createInMemoryCacheStore<TMeta>()`, holds cached values. It keeps statement rows and ORM call results differently. Statement rows are copied one level deep on `set` and `get`: the array, and each row object with its prototype. The driver's values in them, such as BSON `ObjectId`s or a `Buffer`, are kept by reference and shared with every hit; the runtime decodes them on each hit, and a codec that returns its wire value unchanged, such as a date or byte-array codec, hands every caller that same shared object. An ORM call's result has its plain structure copied on `set` and on every `get`: plain and null-prototype objects, arrays (their elements only; holes read as `undefined`), `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`, typed arrays (a subclass such as Node's `Buffer` keeps its class) and `DataView` (copied as a plain `DataView`). Every other value in it, such as a class instance (a Temporal value, a decimal, a vector, a BSON value, an error) or a function, is shared by reference with the first caller and every hit. So, once the call has ended, changing the plain objects and arrays of a result changes no later hit; changing a shared value in place does, so codecs should return values that are not mutated in place. The store never refuses a value: `set` returns `false` only when the key's version moved. A miss copies the result once and each hit copies it again: about the work of decoding rows, linear in the size of the result. A custom store decides for itself whether to copy and what it can store.

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

`createCacheMiddleware({ deriveKey })` computes the key of every cached statement whose annotation has no `key`. It takes the statement's execution plan, so it does not apply to an ORM call, which is keyed by its content hash. Build on the default to add a prefix:

```ts
const cache = createCacheMiddleware({
  deriveKey: async (exec, ctx) => `users:${await deriveKeyFromContentHash(exec, ctx)}`,
});
```

An explicit annotation `key` is used literally and bypasses `deriveKey`, so a tenant or namespace prefix must be part of it too. An app that relies on `deriveKey` to separate tenants must also separate them for annotated ORM calls, for example with a tenant-prefixed `key`; otherwise one tenant's cached ORM read can be served to another. A key belongs to one query and one terminal method: if `first()` and `all()` share a key, the one that reads the other's stored result fails with `ORM.INTERCEPTED_RESULT_INVALID` or returns the wrong shape. A derivation that returns the same key for different plans serves one plan's rows to the other, and one that drops the content hash no longer changes on a schema migration. If `deriveKey` throws, the read fails. A builder query and an ORM call that share a key evict each other's entries, so give each its own key.

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

A write can carry its invalidation instead. `invalidateAnnotation({ keys?, meta? })` takes the same `InvalidationTarget<TMeta>` as `invalidate`, and the middleware makes the same call from the runtime's `activityFinalized` event, once the write's effects are final:

```ts
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
  meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
);
```

It applies to writes only: every SQL ORM write terminal and every SQL builder insert, update and delete accepts it, and a read rejects it at compile time and at run time. Outside a transaction it invalidates right after the write ends, after the write's own transaction when the ORM call runs one, such as an update with a relation callback or a create on a multi-table-inheritance variant. Inside `db.transaction(fn)` it invalidates when the transaction ends; until then the entry is still served. A rolled-back write does not invalidate. An `unknown` outcome, such as a failed write or a `COMMIT` that errored, does, since the write may have landed. Several annotated writes in one transaction each invalidate when it ends. The middleware reads the annotation from whatever activity carries it, an ORM call, an annotated builder statement or any client activity, and does not check the kind or the transaction. An error from `unset` is passed to `ctx.log.error` with the event `middleware.activityFinalized.error` and swallowed; the write has already happened. `postgres()`, `sqlite()` and `supabase()` drop these events unless the application passes `log`, for example `postgres({ contract: contractFromJson<Contract>(contractJson), url, middleware: [cache], log: console })`, so pass it to see a failed invalidation. So on a store that cannot act on `meta`, such as the default store, an annotation with `meta` removes nothing, not even its `keys`, and each such write only logs `RUNTIME.CACHE_STORE_META_UNSUPPORTED`. The write's promise, and `db.transaction(fn)`'s, resolve only after `store.unset` has settled, so a custom store must time out its own `unset`. A write whose activity never finalizes, such as a builder write whose row iterator is dropped without `return()`, or a process that stops between the commit and the invalidation, does not invalidate; its entries stay until they expire. The Mongo ORM's write methods take no annotations, so on Mongo call `invalidate` after the write. Because the middleware implements `activityFinalized`, a runtime that uses it keeps every transaction's finished statements until the transaction ends, whether or not any write is annotated: measured on Postgres, about 2.9 KB per statement, about 55 MB for a transaction of 20,000 statements, all released at the commit. Split a long batch import into several transactions, or run it on a client without the cache middleware.

A tag scheme is a store policy: `cacheAnnotation({ meta: { tags: ['users'] } })` on the read, a store that indexes `meta.tags` in `set`, and `cache.invalidate({ meta: { tags: ['users'] } })` after the write.

## Scope

The middleware is a read-through cache with a control surface: keys and `deriveKey`, `meta`, `bypass`, `invalidate` and `invalidateAnnotation`, and the `CacheStore` interface. It carries data between the annotations and the store and never interprets it. Lifetime and the meaning of `meta` are the store's; the middleware decides when the invalidation a write carries runs, once the write's effects are final; deciding what a write should invalidate, for example by table, request coalescing and routing between several stores belong in extensions built on these primitives.

Serve-stale strategies such as stale-while-revalidate need the hit-or-miss decision, which only the middleware makes.
