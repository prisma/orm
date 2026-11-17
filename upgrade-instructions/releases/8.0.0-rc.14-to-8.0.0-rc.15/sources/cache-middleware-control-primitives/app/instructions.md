---
changes:
  - id: cache-annotation-ttl-removed
    summary: "cacheAnnotation from @prisma/orm-extension-middleware-cache no longer takes ttl. Every annotated read is now cached, including cacheAnnotation({}) and cacheAnnotation({ key }), which used to pass through uncached; how long an entry lives is the store's policy (the default store: 60 seconds). Remove ttl from every cacheAnnotation call."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcacheAnnotation\s*\('
  - id: cache-annotation-skip-renamed-bypass
    summary: "cacheAnnotation({ skip }) is now cacheAnnotation({ bypass }), and the CachePayload type is now CacheAnnotationOptions. Detection finds skip written inside a cacheAnnotation({ ... }) literal and any use of CachePayload; options built elsewhere without that type are not detected."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bCachePayload\b'
        - '\bcacheAnnotation\s*\(\s*\{[^}]*\bskip\s*:'
  - id: cache-middleware-store-options
    summary: "createCacheMiddleware no longer takes maxEntries or clock. Pass them to createInMemoryCacheStore and hand that store to createCacheMiddleware({ store }), or drop them when they match the new defaults (1000 entries). Detection finds maxEntries or clock written in the options literal of a createCacheMiddleware call; it also matches an already-migrated createCacheMiddleware({ store: createInMemoryCacheStore({ maxEntries }) }), which needs no change."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcreateCacheMiddleware\s*\(\s*\{[^}]*\b(maxEntries|clock)\s*:'
  - id: cache-store-object-arguments
    summary: "A custom CacheStore is now a cache of values with a version per key: CacheStore<TMeta, TValue>. get({ key, meta }) replaces get(key) and returns a CacheEntry { key, meta, version, data } whose data is { empty: true } or { empty: false, value }; set(entry, value) replaces set(key, entry, ttlMs), stores only if the key's version still equals entry.version, and returns whether it stored; a new required unset({ keys, meta }) removes values and increments their keys' versions. CachedEntry is replaced by CacheEntry, and the rows type by CachedRows."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bCacheStore\b'
        - '\bCachedEntry\b'
        - '\bcreateCacheMiddleware\s*\('
---

## `cache-annotation-ttl-removed`

The read annotation no longer carries a lifetime. The store decides how long an entry lives. The default store, which `createCacheMiddleware()` uses when you pass no `store`, keeps every entry for 60 seconds.

This also changes behaviour without a type error. Before, a read annotated without `ttl` (`cacheAnnotation({})`, `cacheAnnotation({ key })`, or a `ttl` that evaluated to `undefined`) was not cached. Now every annotated read in runtime scope is cached. If a read must stay uncached, remove its annotation, or pass `cacheAnnotation({ bypass: true })`.

In each file that calls `cacheAnnotation(...)`:

1. Remove the `ttl` property. `cacheAnnotation({ ttl: 60_000 })` becomes `cacheAnnotation({})`, and `cacheAnnotation({ ttl, key })` becomes `cacheAnnotation({ key })`.
2. Remove any variable, function parameter or option field that existed only to supply that `ttl` (for example a `ttlMs` option on a helper that wraps the annotated read), and remove it from its callers.
3. If every read used the same lifetime and it was not 60 seconds, set it once on the store: `createCacheMiddleware({ store: createInMemoryCacheStore({ ttlMs }) })`. `ttlMs: Infinity` never expires. If reads need different lifetimes, write a custom `CacheStore` that reads the lifetime from the annotation's `meta` (see `cache-store-object-arguments`), and pass it as `cacheAnnotation({ meta: { ttlMs } })`.
4. Update comments and READMEs that say the annotation needs a `ttl`, that caching happens "within the TTL window" of the annotation, or that an annotation without `ttl` passes through. Say instead that an annotated read is cached and the default store keeps the entry for 60 seconds.

Before:

```ts
export async function getUsersCached(limit = 10, ttlMs = 60_000) {
  const plan = db.sql.public.user
    .select('id', 'email')
    .annotate(cacheAnnotation({ ttl: ttlMs }))
    .limit(limit)
    .build();
  return db.runtime().query(plan);
}
```

After:

```ts
export async function getUsersCached(limit = 10) {
  const plan = db.sql.public.user
    .select('id', 'email')
    .annotate(cacheAnnotation({}))
    .limit(limit)
    .build();
  return db.runtime().query(plan);
}
```

## `cache-annotation-skip-renamed-bypass`

In each file that imports from `@prisma/orm-extension-middleware-cache`:

1. Rename `skip` to `bypass` in every `cacheAnnotation(...)` argument: `cacheAnnotation({ skip: forceRefresh })` becomes `cacheAnnotation({ bypass: forceRefresh })`. Only rename `skip` inside a `cacheAnnotation` argument or a value typed `CachePayload`; leave other `skip` properties alone.
2. Rename the type `CachePayload` to `CacheAnnotationOptions`, in imports and in uses.
3. Update comments that describe `skip` on the annotation, or that say `skip` wins over a `ttl`.

## `cache-middleware-store-options`

In each call to `createCacheMiddleware(...)`:

- If the options contain only `maxEntries: 1000` (or `1_000`), and no `clock`, call `createCacheMiddleware()` with no options.
- Otherwise, move `maxEntries` and `clock` to a store: `createCacheMiddleware({ maxEntries: 500 })` becomes `createCacheMiddleware({ store: createInMemoryCacheStore({ maxEntries: 500 }) })`, importing `createInMemoryCacheStore` from `@prisma/orm-extension-middleware-cache`. The middleware's `clock` used to stamp `storedAt` only; it now drives the store's expiry.

`createInMemoryCacheStore` options are all optional now: `maxEntries` (default 1000), `ttlMs` (default 60 000) and `clock` (default `Date.now`).

## `cache-store-object-arguments`

Only for code that implements `CacheStore`, as a typed object, a class, or an object literal passed inline to `createCacheMiddleware({ store: { ... } })`. The types reject the old shape, but an untyped JavaScript store fails only at run time, so check each one.

1. Keep a version per key: an integer, 0 for a key never seen, that only `unset` changes. Keep it even for keys that hold no value, for at least as long as a read can take.
2. Change `get(key)` to `get({ key, meta })`, returning a `CacheEntry`: `{ key, meta, version, data }`, where `meta` is the `meta` passed in, `version` the key's current version, and `data` is `{ empty: true }` on a miss or `{ empty: false, value }` with the stored rows. `meta` is the read annotation's `meta`, or `undefined`. A store that matches `meta` folds the versions of whatever `meta` names into `version`, and does the same in `set`; a store that does not index `meta` ignores it here.
3. Change `set(key, entry, ttlMs)` to `set(entry, value)`, returning a boolean. `entry` is the `CacheEntry` your `get` returned; `value` is the rows. Store `value` under `entry.key` only if the key's version still equals `entry.version`, and return whether you stored. The comparison and the write must be atomic against `unset`: one synchronous step in memory, or one server-side script (for example Lua on Redis). There is no unconditional write and no `ttlMs` argument: the store sets the lifetime itself, as a fixed value or read from `entry.meta`. Code that prefilled the cache with `set(key, entry, ttlMs)` now calls `get` and then `set`.
4. Add `unset({ keys, meta })`. It removes the values stored under `keys` when `keys` is not `undefined`, and increments the version of every one of those keys, whether or not it holds a value. When `meta` is not `undefined`, it removes the values whose `meta` matches, compared by value, and increments their versions; a store that does not index `meta` must throw instead of ignoring it.
5. Replace `CachedEntry` with `CachedRows` (the rows, `readonly Record<string, unknown>[]`) for stored values and `CacheEntry` for what `get` returns. Type the store as `CacheStore<TMeta>`, which is `CacheStore<TMeta, CachedRows>`; `createCacheMiddleware` rejects a store of any other value type, `unknown` included. There is no `storedAt`.

Before:

```ts
const store: CacheStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as CachedEntry) : undefined;
  },
  async set(key, entry, ttlMs) {
    await redis.set(key, JSON.stringify(entry), 'PX', ttlMs);
  },
};
```

After:

```ts
const SET_IF_VERSION = `
  if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', 60000)
  return 1`;

const store: CacheStore<unknown, CachedRows> = {
  async get({ key, meta }) {
    const [raw, version] = await redis.mget(`value:${key}`, `version:${key}`);
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
    return (await redis.eval(SET_IF_VERSION, 2, ...keys, json, entry.version)) === 1;
  },
  async unset({ keys, meta }) {
    if (meta !== undefined) {
      throw new Error('This store does not index meta');
    }
    for (const key of keys ?? []) {
      await redis
        .multi()
        .del(`value:${key}`)
        .incr(`version:${key}`)
        .pexpire(`version:${key}`, 60_000)
        .exec();
    }
  },
};
```
