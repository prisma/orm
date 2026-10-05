# ADR 259 — The cache middleware is a control surface and the store owns lookup, lifetime and version

Status: **Accepted**

## Decision

```ts
import {
  cacheAnnotation,
  createCacheMiddleware,
  createInMemoryCacheStore,
} from '@internal/middleware-cache';

// The store decides how long entries live. Omit `store` for this default: 1000 entries, 60 seconds.
const cache = createCacheMiddleware({
  store: createInMemoryCacheStore({ maxEntries: 5_000, ttlMs: 5 * 60_000 }),
});
const db = postgres<Contract>({ contractJson, url, middleware: [cache] });

// A cached read. `key` names the entry; `meta` is handed to the store and never read by the middleware.
const alice = await db.orm.public.User.first({ id: 1 }, (m) =>
  m.annotate(cacheAnnotation({ key: 'user-1', meta: { table: 'users' } })),
);

// After a write has returned, remove the entry by the key you named.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ keys: ['user-1'] });
```

The default store ignores `meta` and throws on `invalidate({ meta })`. Invalidating by `meta` takes a store that indexes it, such as the tagging store under [Consequences](#what-is-deliberately-outside-core-and-how-an-extension-builds-it).

The cache middleware in [`@internal/middleware-cache`](../../../packages/3-extensions/middleware-cache/README.md) is a read-through cache with a control surface. It carries data between annotations and the store and never interprets that data. Core ships primitives, not policy: an operation belongs in the middleware only if it cannot be built outside it.

- The **middleware** owns the key. It takes the annotation's `key` as given, or calls `deriveKey(exec, ctx)`, whose default is `deriveKeyFromContentHash`.
- The **user** owns `meta`. Whatever a read's annotation carries reaches the store's `get` and `set`, and whatever `invalidate` is given reaches the store's `unset`, unread by the middleware.
- The **store** owns lookup, lifetime and version: how entries are found by anything other than their key, how long they live, and whether a writer may still fill a key.

How to group entries, when to invalidate, and how long entries live are decisions for a store or an extension built on these primitives.

The design is a community contribution: paulwer proposed it, including moving the version into the store.

## Why

A cache whose entries leave only when their lifetime runs out returns stale rows after every write. Removing entries is the missing operation. The question is how much of the policy around removal belongs in core.

Every policy a user has asked for is buildable from outside the middleware: tags, namespaces, table-based invalidation, versioned keys, request coalescing. Each one carries decisions that suit some users and not others, such as which grouping scheme, which backend index, and what to do when the request that other requests are waiting on never finishes. Putting any of them in core forces those decisions on every user and leaves the edge cases of one scheme in a package that cannot serve the rest. Keeping core to the operations that cannot be built outside keeps it small and lets each policy live in a package that owns its decisions.

The middleware cannot delegate one thing: the guard that stops a read from storing rows that predate an invalidation. That guard needs a version that every process sharing a store agrees on, so the version lives in the store.

## The store contract

```ts
// packages/3-extensions/middleware-cache/src/cache-store.ts
export type CachedRows = readonly Record<string, unknown>[];

export interface CacheEntry<TMeta = unknown, TValue = CachedRows> {
  readonly key: string;
  readonly meta: TMeta | undefined;
  readonly version: number;
  readonly data: { readonly empty: true } | { readonly empty: false; readonly value: TValue };
}

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
```

The store is a cache of values. Rows are what this middleware puts in it, so `TValue` defaults to `CachedRows`, and `createCacheMiddleware` takes a `CacheStore<TMeta, CachedRows>`. A store of any other value type, `unknown` included, is a type error there.

The store keeps a version per key, an integer it keeps even for a key that holds no value. A key never seen has version 0. The store changes a version only in `unset`, which moves it up. A store may forget a version: the default store forgets it `ttlMs` after its last bump, after which it reads as 0 again.

- **`get({ key, meta })`** always returns an entry. On a miss `data` is `{ empty: true }`, and the entry still carries the key, the `meta` the read supplied, and the current version. A store that groups entries by `meta` folds the versions of the groups `meta` names into the version it returns.
- **`set(entry, value)`** stores `value` under `entry.key` with `entry.meta` if and only if the key's current version (folded the same way) still equals `entry.version`, and returns whether it stored. The entry passed is the one `get` returned. The compare and the write are one step that no `unset` of the same key can fall between: one synchronous step in memory, one script on a server. There is no unconditional write; a prefill is `get` followed by `set`.
- **`unset({ keys, meta })`** removes every value named in `keys` and every value that matches `meta`, in one call so the store can batch them. It increments the version of every key it removes, including keys named in `keys` that hold no value, so any in-flight miss on those keys is refused whatever its `meta`. A store that indexes `meta` also increments the version of the `meta` group named, which it folds into the version `get` returns for reads under that `meta`, so a read under that `meta` of a key the store has never seen is refused too. A store that cannot act on a `meta` it is given throws rather than ignoring it; the default store throws `RUNTIME.CACHE_STORE_META_UNSUPPORTED`. A silently dropped invalidation is the worst outcome a cache can have.

All three methods take one object (or an entry and a value), so a store written against a positional shape is a compile error instead of a store that deletes key `undefined`. `unset` is required, because a cache that cannot be invalidated is the defect this design removes.

## How it works

### Keys

Every entry sits under one string. `cacheAnnotation({ key })` uses the string as given and never calls `deriveKey`, so `invalidate({ keys })` matches the literal string the user wrote. Otherwise the middleware calls `deriveKey(exec, ctx)`. The default, `deriveKeyFromContentHash`, returns `ctx.contentHash(exec)`: a hash of the statement, its parameters and the storage hash, so two callers running the same statement share one entry and a migration changes every derived key. `deriveKey` receives the lowered plan, so an extension can shape the key, for example by prefixing it with a namespace:

```ts
const cache = createCacheMiddleware({
  deriveKey: async (exec, ctx) => `users:${await deriveKeyFromContentHash(exec, ctx)}`,
});
```

### `meta`

`meta` is opaque addressing data. The middleware passes the annotation's `meta` to `store.get` when the read starts and, on a miss, the same object to `store.set` on the entry `get` returned. It passes `invalidate`'s `meta` to `store.unset`. The store may index it in whatever way suits its backend, or not at all. `meta` is typed by the store: `createCacheMiddleware` infers `TMeta` from the store it is given, so `invalidate({ meta })` is checked against it. `cacheAnnotation<TMeta>(...)` takes the same type parameter, but nothing ties the read side to the store at compile time, so a store package exports a wrapper typed with its own `meta`.

### The overlap race, and why the version lives in the store

1. Request A reads user 1 and misses. The query goes to the database, which returns the old name.
2. Request B updates user 1 and invalidates `user-1`. There is nothing to remove yet.
3. Request A's rows arrive and are stored. The cache holds the old name until the entry expires.

With versions in the store, step 3 is refused:

```ts
const entry = await store.get({ key: 'user-1', meta: undefined }); // version 3, data: { empty: true }
await cache.invalidate({ keys: ['user-1'] });                      // the store moves 'user-1' to version 4
await store.set(entry, rows);                                      // false: 3 is no longer current
```

The middleware remembers the entry `get` returned for each miss in flight, and in `afterQuery`, if the driver completed the read, calls `store.set(entry, rows)`. When `set` returns `false` it logs `middleware.cache.store-skipped`. It keeps no counters of its own. Because the version is in the store, the guard holds across every process that shares the store: an invalidation in one process refuses a miss in another.

A store must keep a moved version at least as long as a read can take. The default store keeps it for `ttlMs` after the `unset` that moved it, so a read slower than `ttlMs` that overlaps an invalidation can store stale rows; with `ttlMs: Infinity` versions are never forgotten.

### Lifetime

The middleware and the annotation have no lifetime option. Lifetime is the store's policy. The default store takes it in its own options, `createInMemoryCacheStore({ maxEntries, ttlMs, clock })`, with defaults of 1000 entries and 60 000 ms, and `Infinity` to never expire. A store that wants per-entry lifetimes reads them from `meta` in `set`.

### `bypass`

`cacheAnnotation({ bypass: true })` makes a read neither read from nor write to the cache. Reads in `'connection'` or `'transaction'` scope always bypass it, because they must see their own uncommitted writes.

## Consequences

- An annotated, non-bypassed read in runtime scope is always cached; how long is the store's decision.
- A store that does not index `meta` throws on `invalidate({ meta })`. Grouping by `meta` requires a store that implements it.
- Store authors carry real obligations: an atomic conditional `set`, versions that outlive in-flight reads, and an `unset` by key that also drops the key from any `meta` index.
- Invalidation happens when the application calls `invalidate`, after the write has returned. Outside a transaction that is after its commit; inside one, the application must call `invalidate` after `db.transaction()` returns. Attaching an invalidation to the write itself needs a runtime hook that fires after the enclosing transaction commits; without one, a concurrent reader could refill the entry with the old row between the write and the commit.
- Serve-stale strategies are out of reach of an extension: only the middleware decides hit or miss.

### What is deliberately outside core, and how an extension builds it

- **Tags.** The store's `set` indexes `meta.tags`; its `unset({ meta: { tags } })` removes the tagged keys, increments each of their versions, and increments the tag's version.
- **Namespaces.** A namespace is one label per entry in `meta`, indexed like a tag, or a key prefix added by `deriveKey`.
- **Named stores.** One store that routes on `meta.store` to the real backends, or two middleware instances with two stores.
- **Strategies** such as table-based invalidation. Each read carries the tables it touches in its `meta`, for example through the extension's annotation wrapper, and the store indexes them in `set`. The extension's own middleware reads a write's tables from the plan in `afterQuery`/`afterExecute` and calls `cache.invalidate({ meta: { tables } })`, which the store matches against that index.
- **Versioned keys.** `deriveKey` puts a generation counter into every key and an invalidation bumps it. The counter lives in the shared store's backend, so every process sharing the store reads the same one; old keys are never asked for again and expire on the store's schedule.
- **Request coalescing (dedupe).** A separate middleware placed after the cache, built on `interceptQuery` and `afterQuery`, sees only the reads the cache did not answer.
- **Write-driven invalidation.** An annotation on the write that invalidates after the transaction commits. It needs a post-commit hook in the runtime; once that exists, the package provides it as an annotation. That is not policy entering core: the annotation reaches the same `invalidate` call as the manual form and names its own target, and queuing until the commit then has one owner, the middleware that already holds the store, instead of every extension re-implementing the deferral.
- **Serve-stale.** Not buildable outside; it needs the middleware to answer a hit with an expired entry while refreshing it.

A tagging store, as a sketch (it never forgets versions):

```ts
import type { CachedRows, CacheStore } from '@internal/middleware-cache';

interface TagMeta {
  readonly tags: readonly string[];
}

function createTagStore(): CacheStore<TagMeta> {
  const values = new Map<string, CachedRows>();
  const versions = new Map<string, number>();
  const keysByTag = new Map<string, Set<string>>();
  const versionOf = (name: string) => versions.get(name) ?? 0;
  const bump = (name: string) => versions.set(name, versionOf(name) + 1);
  const foldedVersion = (key: string, meta: TagMeta | undefined) =>
    (meta?.tags ?? []).reduce((sum, tag) => sum + versionOf(`tag:${tag}`), versionOf(`key:${key}`));

  return {
    async get({ key, meta }) {
      const value = values.get(key);
      return {
        key,
        meta,
        version: foldedVersion(key, meta),
        data: value === undefined ? { empty: true } : { empty: false, value },
      };
    },
    async set(entry, value) {
      if (entry.version !== foldedVersion(entry.key, entry.meta)) {
        return false;
      }
      values.set(entry.key, value);
      for (const tag of entry.meta?.tags ?? []) {
        keysByTag.set(tag, (keysByTag.get(tag) ?? new Set()).add(entry.key));
      }
      return true;
    },
    async unset({ keys, meta }) {
      for (const key of keys ?? []) {
        values.delete(key);
        bump(`key:${key}`);
        for (const tagged of keysByTag.values()) {
          tagged.delete(key);
        }
      }
      for (const tag of meta?.tags ?? []) {
        for (const key of keysByTag.get(tag) ?? []) {
          values.delete(key);
          bump(`key:${key}`);
        }
        keysByTag.delete(tag);
        bump(`tag:${tag}`);
      }
    },
  };
}
```

A read annotated with `meta: { tags: ['users'] }` that misses before `cache.invalidate({ meta: { tags: ['users'] } })` gets a folded version that the invalidation moves, so its `set` is refused even though the store had never seen its key. A read already in flight for one of the tagged keys under other `meta` is refused too, because the invalidation also moved that key's own version.

## Alternatives considered

- **Tags in core,** with a tag-to-keys index and `deleteByTag` in the default store. Rejected: it puts one grouping scheme and its cleanup paths in core, when opaque `meta` and a store-side index give a tagging extension everything it needs.
- **`invalidate(fn)`,** a predicate over entries, with a matching `deleteWhere` on the default store. Rejected: a function is not data. It cannot ride on an annotation, it cannot be sent to a shared store, and it forces callers to hold a store reference.
- **A store argument to `invalidate(fn)`,** so the predicate can reach the store. Rejected for the same reason: invalidation is described as data the store interprets, not as code that runs against it.
- **Version counters in the middleware,** a generation per key and a global one in the middleware's memory. Rejected: the guard then protects only reads in one process, and the middleware needs reference counting for in-flight misses and a second `unset` after a late `set`, all to track a number the store already has to know.
- **An unconditional `set`, or a `set` with an explicit version argument.** Rejected: `get` already returns an entry that carries the version, `set` takes that entry back, and a prefill is a `get` followed by a `set`.
- **A TTL on the middleware or the annotation.** Rejected: lifetime is the store's policy, and the middleware deciding it by proxy makes "annotated but no TTL" a third state with its own behaviour.
- **Positional `set(key, meta, entry)` and `unset(key, meta)`.** Rejected: a store written against `unset(key)` still compiles against the positional shape and silently deletes key `undefined` when handed `meta`.
- **Naming the blob `attributes` or `labels`.** `attributes` implies a meaning the middleware assigns, and it assigns none. Labels are strings, which is tags again. `meta` says what it is: opaque data that travels with the entry.
