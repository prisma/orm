# Summary

Extend `@prisma-next/middleware-cache` with pluggable invalidation strategies, mutation-driven cache invalidation via `uncacheAnnotation`, in-process miss deduplication (single-flight), tag-based bulk invalidation, and a configurable store-operation execution mode. These additions make cache invalidation a first-class concern alongside caching and remove the previous constraint that applications had to manage invalidation manually outside the middleware pipeline.

# Description

The initial `@prisma-next/middleware-cache` implementation (TML-2143, M1) shipped the interception hook, `cacheAnnotation`, a pluggable `CacheStore` interface, and a default in-memory LRU store. It intentionally deferred invalidation strategies beyond TTL expiry.

Three gaps became apparent in practice:

1. **No mutation-driven invalidation.** After a write, stale cache entries continued to be served until their TTL elapsed. Applications had to call `middleware.uncache(...)` out-of-band and keep this in sync with their mutation paths — a maintenance burden that grows proportionally with the number of write paths.

2. **No per-query deduplication.** Under concurrent load, a cache miss for a popular key triggered N parallel database executions, one per concurrent request. Without a single-flight mechanism, the cache provided no protection against thundering-herd during the window between a miss detection and a `set` completing.

3. **No bulk / tag-based invalidation.** Fine-grained invalidation required callers to enumerate explicit keys. Invalidating "everything related to a user" meant the caller had to know all key patterns in advance.

This project adds all three, plus the `storeOperationMode` knob that lets latency-sensitive deployments run store I/O in the background.

# Before / After

## Mutation-driven invalidation

**Before** — write completes, cache is stale until TTL; caller must remember to invalidate manually:

```typescript
await db.orm.User.update({ id: 1, name: 'New' });
// caller must now call middleware.uncache([{ namespace: 'app' }]) out-of-band
```

**After** — invalidation intent travels with the mutation via `uncacheAnnotation`:

```typescript
import { uncacheAnnotation } from '@prisma-next/middleware-cache';

await db.orm.User.update(
  { id: 1, name: 'New' },
  (meta) => meta.annotate(uncacheAnnotation({
    uncache: [{ namespace: 'app' }, { keys: ['user:1'] }],
  })),
);
// after the write commits, the cache middleware deletes the listed entries
```

## Invalidation strategies

**Before** — no configurable strategy; callers had to pass explicit keys to `middleware.uncache(...)`:

```typescript
const cacheMiddleware = createCacheMiddleware({ maxEntries: 1_000 });
```

**After** — three modes selectable via `cacheStrategy.mode`:

```typescript
// broad: on any write, delete all keys that match the namespace prefix
const cacheMiddleware = createCacheMiddleware({
  cacheStrategy: { mode: 'broad' },
  uncacheOnMutation: true,
});

// targeted (default): track entity selectors on reads and writes;
// only invalidate keys that touched the same rows
const cacheMiddleware = createCacheMiddleware({
  cacheStrategy: { mode: 'targeted' },
  uncacheOnMutation: true,
});

// versioned: bump a per-model generation counter on writes;
// reads embed the current generation in their cache key — stale keys expire via TTL
const cacheMiddleware = createCacheMiddleware({
  cacheStrategy: {
    mode: 'versioned',
    generation: {
      scope: 'detected-models',
      bumpOn: 'uncache',
      guard: { enabled: true, maxDeletesPerBump: 500 },
    },
  },
  uncacheOnMutation: true,
});
```

## In-process miss deduplication

**Before** — N concurrent misses for the same key each hit the database:

```typescript
// 100 concurrent requests all miss → 100 database queries fired in parallel
```

**After** — one leader executes; followers wait for its result:

```typescript
const cacheMiddleware = createCacheMiddleware({
  readDedupe: true, // global toggle
  defaultTtlMs: 60_000,
});

// per-query override
const user = await db.orm.User.first(
  { id },
  (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000, dedupe: true })),
);
```

## Tag-based bulk invalidation

**Before** — no concept of grouping entries for bulk invalidation:

```typescript
// must enumerate specific keys
await middleware.uncache([{ keys: ['user:1', 'user:2', 'user:3'] }]);
```

**After** — tag entries at cache time, bulk-invalidate by tag:

```typescript
// tag at cache time
const users = await db.orm.User.all(
  (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000, tags: ['users'] })),
);

// invalidate all entries bearing the 'users' tag
await middleware.uncache([{ tags: ['users'] }]);

// or via mutation annotation
await db.orm.User.create(
  { email: 'a@b.com' },
  (meta) => meta.annotate(uncacheAnnotation({ uncache: [{ tags: ['users'] }] })),
);
```

## Detached store operations

**Before** — every store `set` / `del` was awaited synchronously on the response path.

**After** — opt-in background mode for latency-sensitive deployments:

```typescript
const cacheMiddleware = createCacheMiddleware({
  storeOperationMode: 'detached', // store writes/deletes fire in the background
});
```

## Standalone uncache helper

```typescript
import { uncache, uncacheAnnotation } from '@prisma-next/middleware-cache';

// free-function helper — avoids importing the middleware instance everywhere
await uncache(cacheMiddleware, [
  { namespace: 'app' },
  { tags: ['users', 'posts'] },
]);
```

# Requirements

## Functional Requirements

### `uncacheAnnotation` (write terminal annotation)

1. **Handle declaration.** `uncacheAnnotation = defineAnnotation<UncachePayload>()({ namespace: 'uncache', applicableTo: ['write'] })`. Structurally impossible to apply to a read terminal — the applicability gate (`ValidAnnotations<'read', ...>`) rejects it at both type and runtime levels.

2. **`UncachePayload` shape.**
   ```typescript
   interface UncacheAction {
     readonly namespace?: string;
     readonly keys?: readonly string[];
     readonly models?: readonly string[];
     readonly tags?: readonly string[];
   }
   interface UncachePayload {
     readonly enabled?: boolean;
     readonly skip?: boolean;
     readonly namespace?: string;
     readonly uncache?: readonly UncacheAction[];
   }
   ```
   - `namespace` (shorthand): invalidates all keys matching that prefix when `uncache` is omitted.
   - `uncache`: explicit action list. Each action is executed in order. Takes precedence over `namespace`.
   - `enabled` / `skip`: opt-out toggles. When `skip: true` or `enabled: false`, the middleware bypasses invalidation for this execution.

3. **Execution timing.** Invalidation runs inside `afterExecute`, after `completed: true` is confirmed. A failed write (rolled-back transaction, constraint violation) does not invalidate anything.

4. **Action resolution.** `UncacheAction` supports four orthogonal selectors, each independently optional:
   - `keys`: direct key list (prefixed with `namespace:` if `namespace` is set).
   - `models`: model index lookup — keys previously tagged against these model names.
   - `tags`: delegated to `CacheStore.delByTag`.
   - `namespace` (on action): invalidates all keys with this prefix via `CacheStore.list` + `CacheStore.del`.

### Invalidation strategy modes (`CacheStrategyMode`)

5. **Three modes.**
   - `'broad'`: on any write touching the monitored namespace, delete all live keys matching the global namespace prefix. Requires `CacheStore.list` and `CacheStore.del`.
   - `'targeted'` (default): track entity selectors (model + table + id columns) at read time; at write time, intersect the write's entity selectors with the read selectors' index and delete only matching keys. Requires `CacheStore.list` and `CacheStore.del`.
   - `'versioned'`: maintain a per-model generation counter via `CacheStore.incr`. Reads embed the current generation value in the cache key. Writes bump the counter; old keys become unreachable and expire via TTL. Does not require `del` at write time.

6. **`CacheStrategyConfig` shape.**
   ```typescript
   type CacheStrategyMode = 'broad' | 'targeted' | 'versioned';
   type GenerationScope = 'detected-models' | 'action-models-preferred';
   type GenerationBumpOn = 'uncache' | 'all-writes';
   interface GenerationGuardConfig {
     readonly enabled?: boolean;
     readonly maxDeletesPerBump?: number;
   }
   interface GenerationStrategyConfig {
     readonly scope?: GenerationScope;
     readonly bumpOn?: GenerationBumpOn;
     readonly guard?: GenerationGuardConfig;
   }
   interface CacheStrategyConfig {
     readonly mode?: CacheStrategyMode;
     readonly generation?: GenerationStrategyConfig;
   }
   ```

7. **Default mode.** When `cacheStrategy` is omitted or `mode` is `undefined`, the middleware defaults to `'targeted'`.

### In-process miss deduplication (`dedupe` / `readDedupe`)

8. **Single-flight deduplication.** When deduplication is active for a given effective key, only the first concurrent miss (the leader) executes against the database. All followers for the same key in the same process return a `Promise` that resolves from the leader's result. The leader writes to the store; followers receive the result without a second `set`.

9. **Activation.** Global: `createCacheMiddleware({ readDedupe: true })`. Per-query override: `cacheAnnotation({ dedupe: true | false })`. A per-query `dedupe: false` overrides `readDedupe: true` and vice versa.

10. **Correlation key.** Deduplication uses the same effective cache key as lookup (per-query `cacheAnnotation({ key })` override or `ctx.contentHash(exec)`). Two executions with identical keys in the same process share one leader.

11. **Failure propagation.** If the leader throws, all followers reject with the same error. The key is removed from the in-flight map so a subsequent request for the same key starts a fresh leader.

### Tag-based invalidation

12. **`CachedEntry.tags` field.** `readonly tags?: readonly string[] | undefined` on `CachedEntry`. Tags are stored alongside the entry; the store is responsible for preserving them.

13. **`CacheStore.delByTag` method.** Optional method `delByTag?(tags: readonly string[]): Promise<void>` on `CacheStore`. Implementations remove all entries bearing any of the given tags. The in-memory store supports `delByTag`.

14. **Annotation wire-up.** Per-query tags supplied via `cacheAnnotation({ tags: [...] })` are stored in `CachedEntry.tags` when the entry is committed.

15. **`uncacheAnnotation` tag action.** An `UncacheAction` with `tags` set invokes `store.delByTag(action.tags)`. Requires `CacheStore.delByTag`; the middleware logs a warning if the method is absent and tags are requested.

### `storeOperationMode`

16. **Two modes.** `'await'` (default): store writes and deletes are awaited on the execution path — failure surfaces as a thrown error. `'detached'`: store writes and deletes are submitted as untracked microtask callbacks; errors are suppressed (best-effort). Response latency is not inflated by store I/O in `'detached'` mode.

17. **Consistency trade-off.** `'detached'` mode provides eventual consistency: there is a window after the database result is returned to the caller but before the cache is updated. Applications that require strict read-your-writes consistency must use `'await'`.

### `CacheStore` interface additions

18. **`CacheStore.list`** (optional): `list?(prefix?: string): Promise<readonly string[]>`. Returns all live keys, optionally filtered by prefix. Required by `'broad'` and `'targeted'` strategies and by namespace-scope `uncacheAnnotation` actions.

19. **`CacheStore.del`** (optional): `del?(key: string): Promise<void>`. Required by `'broad'`, `'targeted'`, and key-scope `uncacheAnnotation` actions.

20. **`CacheStore.delByTag`** (optional): `delByTag?(tags: readonly string[]): Promise<void>`. Required by tag-scope `uncacheAnnotation` actions.

21. **`CacheStore.incr`** (optional): `incr?(key: string, delta?: number): Promise<number>`. Required by `'versioned'` strategy (generation counter bumps). In clustered setups the store implementation must make `incr` atomic (e.g. Redis `INCR`).

22. **In-memory store.** `createInMemoryCacheStore` implements all five methods (`get`, `set`, `list`, `del`, `delByTag`). It does not implement `incr` (atomic increment is only meaningful in multi-process / Redis deployments; in-memory generation mode can be achieved without a store-level counter since the process has direct access to the generation map).

### `CacheMiddleware` type and `uncache` method

23. **`CacheMiddleware` type.** `createCacheMiddleware` returns `CacheMiddleware`, which extends `CrossFamilyMiddleware` with a standalone `uncache` method:
    ```typescript
    type CacheMiddleware = CrossFamilyMiddleware & {
      readonly uncache: (actions: readonly UncacheAction[]) => Promise<void>;
    };
    ```

24. **Standalone `uncache` free-function.** Exported helper:
    ```typescript
    function uncache(
      middleware: Pick<CacheMiddleware, 'uncache'>,
      actions: readonly UncacheAction[],
    ): Promise<void>
    ```
    Allows callers to invalidate entries without importing the full middleware type.

### Global options added to `CacheMiddlewareOptions`

25. **`readCaching?: boolean`** — when `true`, all read executions are cached even without `cacheAnnotation`, using `defaultTtlMs` as the TTL.

26. **`readDedupe?: boolean`** — when `true`, enables single-flight deduplication globally for all read misses.

27. **`defaultTtlMs?: number`** — default TTL in milliseconds, used when `readCaching` is `true` and no per-query `ttl` is set.

28. **`namespace?: string`** — global cache namespace prefix applied to all keys and used as the default scope for namespace-based invalidation.

29. **`uncacheOnMutation?: boolean`** — when `true`, every write execution that passes through the middleware triggers the configured strategy's invalidation logic, even without an explicit `uncacheAnnotation`.

30. **`storeOperationMode?: CacheStoreOperationMode`** — `'await'` (default) or `'detached'`.

31. **`cacheStrategy?: CacheStrategyConfig`** — strategy selector and generation sub-config.

## Non-Functional Requirements

1. **Additive interface changes.** All additions to `CacheStore` are optional methods. Existing store implementations continue to compile and function without modification; absent optional methods are guarded before invocation.

2. **No new framework-components SPI changes.** This project builds entirely within `@prisma-next/middleware-cache`. It does not modify `RuntimeMiddleware`, `RuntimeMiddlewareContext`, or `runWithMiddleware`.

3. **Type safety.** No `any`, no `@ts-expect-error` outside negative type tests. `uncacheAnnotation`'s write-only applicability is enforced at both type level (via `ValidAnnotations<'write', ...>`) and runtime level (via `assertAnnotationsApplicable`).

4. **Store interface is I/O-agnostic.** All `CacheStore` methods are async, leaving the door open for Redis, Memcached, or any I/O-backed backend.

## Non-goals

- **Cross-process in-memory generation counters.** Generation mode with the default in-memory store is single-process only. Clustered setups must supply a Redis-backed `CacheStore` with a proper atomic `incr`.
- **Automatic index re-build on startup.** The middleware starts with an empty in-flight map and an empty internal entity index on each process start; there is no warm-up or persistence beyond the `CacheStore`.
- **Annotation-driven read-through warming.** Pre-populating the cache ahead of the first miss is not in scope.
- **Cache introspection API.** No method to enumerate live keys from the middleware; callers use the `CacheStore` directly for that purpose.
- **`beforeCompile` AST-rewrite-based caching.** The cache middleware operates at the `intercept` / `afterExecute` level only.

# Acceptance Criteria

## `uncacheAnnotation`

- [ ] `uncacheAnnotation` is declared with `namespace: 'uncache'` and `applicableTo: ['write']`.
- [ ] Passing `uncacheAnnotation(...)` to a read terminal fails at the type level (type test).
- [ ] `uncacheAnnotation.read(plan)` round-trips the full `UncachePayload` including nested `UncacheAction[]` (unit test).
- [ ] Invalidation fires in `afterExecute` only when `completed: true`; a failed write does not delete cache entries (unit test).
- [ ] `skip: true` or `enabled: false` on the payload suppresses invalidation for that execution (unit test).

## Invalidation strategies

- [ ] `CacheStrategyMode` is `'broad' | 'targeted' | 'versioned'` (type test).
- [ ] Default mode when `cacheStrategy` is omitted is `'targeted'` (unit test).
- [ ] `'broad'` mode: a write causes all keys matching the namespace prefix to be deleted via `CacheStore.list` + `CacheStore.del` (unit test).
- [ ] `'targeted'` mode: a write only deletes keys whose recorded entity selectors overlap with the write's touched models/rows (unit test).
- [ ] `'versioned'` mode: a write bumps the generation counter via `CacheStore.incr`; subsequent reads with the old generation key miss and re-execute (unit test).
- [ ] `GenerationStrategyConfig` fields (`scope`, `bumpOn`, `guard`) are typed correctly and accepted by `CacheMiddlewareOptions` (type test).

## In-process miss deduplication

- [ ] `readDedupe: true` causes concurrent misses for the same key to share one database execution (unit test using a spy on the driver).
- [ ] `cacheAnnotation({ dedupe: false })` overrides `readDedupe: true` per-query (unit test).
- [ ] If the leader throws, all followers reject with the same error; the in-flight record is removed (unit test).

## Tag-based invalidation

- [ ] `CachedEntry.tags` is preserved by `createInMemoryCacheStore` (unit test).
- [ ] `createInMemoryCacheStore` implements `delByTag`: calling it removes all entries with a matching tag and leaves other entries intact (unit test).
- [ ] `uncache([{ tags: ['users'] }])` triggers `store.delByTag(['users'])` (unit test with spy store).
- [ ] `cacheAnnotation({ tags: ['users'] })` causes the committed `CachedEntry` to carry `tags: ['users']` (unit test).

## `storeOperationMode`

- [ ] `'await'` mode: store `set` errors surface to the caller (unit test).
- [ ] `'detached'` mode: store `set` errors are suppressed; the execution result is returned normally (unit test).
- [ ] `CacheStoreOperationMode` is `'await' | 'detached'` (type test).

## `CacheMiddleware` type and `uncache`

- [ ] `createCacheMiddleware` return type is `CacheMiddleware` (extends `CrossFamilyMiddleware` + `uncache` method) (type test).
- [ ] `middleware.uncache([{ namespace: 'app' }])` deletes all keys with prefix `'app:'` (unit test with spy store).
- [ ] Exported `uncache(middleware, actions)` delegates to `middleware.uncache(actions)` (unit test).

## Global `CacheMiddlewareOptions` additions

- [ ] `readCaching: true` + `defaultTtlMs` caches all reads without requiring `cacheAnnotation` per query (unit test).
- [ ] `uncacheOnMutation: true` triggers the configured strategy's invalidation on every write passing through the middleware (unit test).
- [ ] All new option fields (`readCaching`, `readDedupe`, `defaultTtlMs`, `namespace`, `uncacheOnMutation`, `storeOperationMode`, `cacheStrategy`) are accepted by `CacheMiddlewareOptions` without TypeScript errors (type test).

## `CacheStore` interface additions

- [ ] `CacheStore` compiles with only `get` and `set` — all other methods are optional (type test: existing two-method stores satisfy the interface).
- [ ] Calling `middleware.uncache([{ tags: [...] }])` against a store without `delByTag` logs a warning and does not throw (unit test).
- [ ] `createInMemoryCacheStore` satisfies the full `CacheStore` interface including `list`, `del`, and `delByTag` (type test + unit test).

---

# Part 2 — Multi-store support and per-namespace configuration

## Before / After

### Multiple named stores

**Before** — single store; all executions share one backend:

```typescript
const cacheMiddleware = createCacheMiddleware({
  store: redisStore,
  defaultTtlMs: 60_000,
});
```

**After** — register named stores alongside the default; route by namespace or per-query annotation:

```typescript
const cacheMiddleware = createCacheMiddleware({
  store: redisStore,            // default store
  stores: {
    hot: memoryStore,           // named store for hot-path data
    cold: s3Store,              // named store for infrequent, long-lived data
  },
  defaultTtlMs: 60_000,
});

// annotation-level routing
const leaderboard = await db.orm.Score.all(
  (meta) => meta.annotate(cacheAnnotation({ ttl: 5_000, store: 'hot' })),
);

// namespace-level routing (see below)
```

### Per-namespace configuration overrides

**Before** — single global settings; no way to give one namespace a shorter TTL, a different strategy, or a different store:

```typescript
const cacheMiddleware = createCacheMiddleware({
  readCaching: true,
  defaultTtlMs: 60_000,
  cacheStrategy: { mode: 'versioned' },
});
```

**After** — `namespaces` map lets each namespace override any global option:

```typescript
const cacheMiddleware = createCacheMiddleware({
  store: redisStore,
  stores: { hot: memoryStore },
  readCaching: true,
  defaultTtlMs: 60_000,
  cacheStrategy: { mode: 'versioned' },
  namespaces: {
    'realtime:*': {
      store: 'hot',
      defaultTtlMs: 2_000,
      cacheStrategy: { mode: 'broad' },
    },
    'archive:*': {
      store: 'cold',
      defaultTtlMs: 86_400_000,
    },
    '/^tenant:.{36}$/': {
      uncacheOnMutation: true,
      storeOperationMode: 'detached',
    },
  },
});
```

## Requirements

### Named store registry

32. **`CacheMiddlewareOptions.stores?: Record<string, CacheStore>`** — optional map of named stores. Keys are arbitrary identifiers used in `NamespaceConfig.store` and `cacheAnnotation({ store })`. When a name cannot be resolved, the middleware silently falls back to the default store.

33. **Default store behaviour unchanged.** When `stores` is absent or a named store is not found, all executions use the default store (`options.store` or the built-in in-memory LRU). Existing single-store configurations require no changes.

34. **Independent per-store state.** Each named store gets its own `modelKeyIndex`, `entityKeyIndex`, `modelGenerations`, and `inflightMisses`. Operations on one store do not affect the indexes of another.

### Annotation-level store selection

35. **`CachePayload.store?: string`** — optional named store identifier added to `CachePayload`. When set, the execution reads from and writes to the named store, bypassing any namespace-level store assignment.

36. **Resolution priority (store).** `cacheAnnotation({ store })` > `NamespaceConfig.store` > default store.

### `NamespacePattern` and `NamespaceConfig`

37. **`NamespacePattern` type.** `type NamespacePattern = string`. Three pattern syntaxes:
    - **Exact**: `"tenant-a"` — only matches the namespace string `"tenant-a"`.
    - **Glob**: `"organization:*"` — `*` is a wildcard that matches any sequence of characters (including empty).
    - **RegExp**: `"/pattern/"` — a string that starts and ends with `/` is treated as a regular expression. The inner content is passed to `new RegExp(inner).test(namespace)`.

38. **`NamespaceConfig` interface.** All fields are optional:
    ```typescript
    interface NamespaceConfig {
      readonly store?: string;
      readonly readCaching?: boolean;
      readonly readDedupe?: boolean;
      readonly defaultTtlMs?: number;
      readonly uncacheOnMutation?: boolean;
      readonly storeOperationMode?: CacheStoreOperationMode;
      readonly cacheStrategy?: CacheStrategyConfig;
    }
    ```

39. **Lookup algorithm.** Given an effective namespace:
    1. If the exact namespace string is a key in `options.namespaces`, use that entry.
    2. Otherwise, sort remaining keys by length (longest first) and return the first whose pattern matches the namespace.
    3. If no pattern matches, return `undefined` (no namespace config; fall back to global options).

40. **Override semantics.** Each field in the matching `NamespaceConfig` overrides the corresponding global `CacheMiddlewareOptions` field for that execution. Absent fields fall through to the global option. Annotation-level fields (`cacheAnnotation({ ttl, dedupe, store, ... })`) take precedence over both namespace config and global options.

41. **`NamespacePattern` and `NamespaceConfig` exports.** Both are exported from `@prisma-next/middleware-cache`.

### Resolution priority (full precedence table)

| Setting | Highest priority → Lowest priority |
|---|---|
| `store` | `cacheAnnotation.store` → `NamespaceConfig.store` → default store |
| `ttlMs` | `cacheAnnotation.ttl` → `NamespaceConfig.defaultTtlMs` → `CacheMiddlewareOptions.defaultTtlMs` |
| `dedupe` | `cacheAnnotation.dedupe` → `NamespaceConfig.readDedupe` → `CacheMiddlewareOptions.readDedupe` |
| `readCaching` | `NamespaceConfig.readCaching` → `CacheMiddlewareOptions.readCaching` |
| `uncacheOnMutation` | `NamespaceConfig.uncacheOnMutation` → `CacheMiddlewareOptions.uncacheOnMutation` |
| `storeOperationMode` | `NamespaceConfig.storeOperationMode` → `CacheMiddlewareOptions.storeOperationMode` |
| `cacheStrategy` | `NamespaceConfig.cacheStrategy` → `CacheMiddlewareOptions.cacheStrategy` |

### Per-action store resolution during write invalidation

42. When an `UncacheAction` has a `namespace`, the middleware resolves the `NamespaceConfig` for that action's namespace (not the write execution's namespace). This means a single write can invalidate entries across different named stores by using multiple actions with different namespaces.

## Non-goals

- **Namespace config inheritance / merging across multiple matching patterns.** Only the single winning pattern's config is applied; multiple matching patterns are not merged.
- **Cross-store invalidation triggers.** A write annotated for store `"hot"` does not automatically invalidate entries in the default store or in `"cold"`. Per-store invalidation requires separate `UncacheAction` entries.
- **Dynamic namespace config updates at runtime.** `namespaces` is fixed at `createCacheMiddleware` call time.

## Acceptance Criteria (Part 2)

### Named store registry

- [ ] `CacheMiddlewareOptions.stores` accepts `Record<string, CacheStore>` without TypeScript errors (type test).
- [ ] An execution with `cacheAnnotation({ store: 'hot' })` reads from and writes to the `'hot'` store, not the default (unit test with two spy stores).
- [ ] When `store: 'unknown'` is annotated, the middleware falls back to the default store without throwing (unit test).
- [ ] Each named store has its own independent `modelKeyIndex`; invalidating model `User` in store `'hot'` does not remove entries from the default store (unit test).

### Annotation-level store selection

- [ ] `CachePayload.store?: string` is present in the type definition (type test).
- [ ] `cacheAnnotation({ store: 'hot' })` round-trips `store: 'hot'` through `cacheAnnotation.read(plan)` (unit test).
- [ ] Annotation `store` takes precedence over a namespace config `store` for the same namespace (unit test).

### `NamespaceConfig` and `NamespacePattern`

- [ ] `NamespacePattern` and `NamespaceConfig` are exported from `@prisma-next/middleware-cache` (type test).
- [ ] Exact pattern `"tenant-a"` matches namespace `"tenant-a"` and does not match `"tenant-b"` (unit test).
- [ ] Glob pattern `"organization:*"` matches `"organization:acme"` and `"organization:"` but not `"tenant:acme"` (unit test).
- [ ] RegExp pattern `"/^tenant:.{36}$/"` matches a UUID-keyed tenant namespace and rejects shorter strings (unit test).
- [ ] Longer patterns are preferred over shorter patterns when multiple glob/regex patterns match (unit test).
- [ ] Exact match always wins over a glob or regex of equal or shorter length (unit test).
- [ ] `NamespaceConfig.defaultTtlMs` overrides `CacheMiddlewareOptions.defaultTtlMs` for matching executions (unit test).
- [ ] `NamespaceConfig.store` routes matching executions to the named store (unit test).
- [ ] `NamespaceConfig.readCaching: true` enables read caching for matching namespaces even when the global option is `false` (unit test).
- [ ] `NamespaceConfig.storeOperationMode: 'detached'` is used for matching executions even when the global mode is `'await'` (unit test).
- [ ] `NamespaceConfig.cacheStrategy.mode` overrides the global strategy for matching namespaces (unit test).

### Per-action store routing during write invalidation

- [ ] A write with two `UncacheAction` entries bearing different namespaces invalidates entries in two different named stores (unit test).

