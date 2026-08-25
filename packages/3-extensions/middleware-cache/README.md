# @prisma-next/middleware-cache

A family-agnostic, opt-in caching middleware for Prisma Next runtimes.

Built on the `intercept` hook on `RuntimeMiddleware` (added in TML-2143 M1): on a cache hit, the middleware short-circuits execution and returns the cached rows; the driver is never invoked. On a cache miss, the middleware buffers rows from the driver and commits them to the store on successful completion.

The package depends only on `@prisma-next/framework-components/runtime` — no SQL or Mongo runtime dependency. Cache keys come from `RuntimeMiddlewareContext.contentHash(exec)`, which the family runtime populates, so SQL and Mongo runtimes both work out of the box.

## Responsibilities

- Provide an opt-in caching `RuntimeMiddleware` that short-circuits repeated reads via the `intercept` hook.
- Define the `cacheAnnotation` handle (read-only) that lane terminals (SQL DSL `.annotate(...)`, ORM read terminals) use to attach per-query cache parameters (`ttl`, `skip`, `key`).
- Define the `uncacheAnnotation` handle (write-only) for mutation-driven invalidation controls.
- Resolve the cache key per execution: per-query `cacheAnnotation({ key })` override, otherwise `RuntimeMiddlewareContext.contentHash(exec)` from the family runtime.
- Buffer driver rows on a miss and commit to the `CacheStore` only on successful completion (`completed: true && source: 'driver'`).
- Bypass the cache when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`.
- Support global read caching (`readCaching`, `defaultTtlMs`), global read miss dedupe (`readDedupe`), and global mutation invalidation (`uncacheOnMutation`).
- Support configurable store operation execution mode (`storeOperationMode`: `await` or `detached`) to balance latency and consistency.
- Support central invalidation strategy selection via `cacheStrategy.mode` (`targeted`, `broad`, `versioned`).
- Expose standalone invalidation through `middleware.uncache(...)` and helper `uncache(middleware, actions)`.
- Ship a default in-memory LRU-with-TTL `CacheStore` and expose the `CacheStore` interface for pluggable backends (Redis, Memcached, etc.).

## Dependencies

- `@prisma-next/framework-components/runtime` - the only production dependency. Provides `RuntimeMiddleware`, `RuntimeMiddlewareContext` (with `contentHash` and `scope`), `defineAnnotation`, `AfterExecuteResult`, and the orchestrator integration via `runWithMiddleware`.

The package does **not** depend on `@prisma-next/sql-runtime`, `@prisma-next/mongo-runtime`, or any target adapter. It does not import `node:crypto` — hashing the canonical execution identity is the family runtime's responsibility (via `@prisma-next/utils/hash-identity` in the SQL and Mongo runtimes today).


## Quick start

```typescript
import postgres from '@prisma-next/postgres/runtime';
import {
  cacheAnnotation,
  createCacheMiddleware,
  uncache,
  uncacheAnnotation,
} from '@prisma-next/middleware-cache';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const cacheMiddleware = createCacheMiddleware({
  maxEntries: 1_000,
  cacheStrategy: {
    mode: 'targeted',
    generation: {
      bumpOn: 'uncache',
      scope: 'detected-models',
      guard: {
        enabled: false,
        maxDeletesPerBump: 500,
      },
    },
  },
  readCaching: true,
  readDedupe: true,
  storeOperationMode: 'await',
  defaultTtlMs: 60_000,
  uncacheOnMutation: true,
  namespace: 'app',
});

const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: [cacheMiddleware],
});

// First call: hits the database, caches the raw rows.
const first = await db.orm.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ ttl: 60_000 })),
);

// Second call with the identical plan: served from cache, driver
// not invoked.
const second = await db.orm.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ ttl: 60_000 })),
);

// Un-annotated queries are also cached here because readCaching: true and
// defaultTtlMs: 60_000 are set globally. Remove those options to opt out.
const fresh = await db.orm.User.first({ id: 1 });

await cacheMiddleware.uncache([
  { namespace: 'app' },
  { namespace: 'tenant-a', keys: ['user:1', 'user:2'] },
  { models: ['users'] },
]);

await uncache(cacheMiddleware, [{ namespace: 'tenant-b' }]);

await db.orm.User.update({ id: 1, name: 'A' }, (meta) =>
  meta.annotate(
    uncacheAnnotation({
      uncache: [{ namespace: 'app' }, { keys: ['user:1'] }],
    }),
  ),
);
```

## Opt-in by annotation

The cache middleware acts on read plans with either explicit `cacheAnnotation({ ttl })` or enabled global read policy (`readCaching` + `defaultTtlMs`):

| Annotation / policy state | Behavior |
|---|---|
| No `cacheAnnotation` and global read policy disabled | Pass through; never cached. |
| `cacheAnnotation({ })` (no `ttl`) and no global `defaultTtlMs` | Pass through; never cached. |
| `cacheAnnotation({ skip: true })` or `cacheAnnotation({ enabled: false })` | Pass through; never cached. |
| `cacheAnnotation({ ttl })` | Cache lookup; commit on miss + success. |
| `cacheAnnotation({ ttl, key })` | As above, but use the supplied key verbatim. |
| No annotation, but `readCaching: true` and `defaultTtlMs` set | Cache lookup; commit on miss + success. |


The cache annotation is **read-only**: it declares `applicableTo: ['read']`, so the lane gate (TML-2143 M2) rejects passing it to write terminals at both type and runtime levels. "Cache a mutation" is structurally impossible without an `as any` cast bypass at both the type and runtime levels — the cache middleware itself ships without any mutation classifier.

Single-flight miss dedupe is configurable both globally and per query:

- Global default: `readDedupe` (defaults to `false`).
- Per-query override: `cacheAnnotation({ dedupe: true | false })`.
- Precedence: annotation `dedupe` overrides the global `readDedupe` value.

```typescript
// ✓ ORM read terminal accepts the read-only annotation via the meta callback.
await db.orm.User.first({ id }, (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000 })));

// ✓ Bare-configurator form on `first` — pass `undefined` as the filter to
// attach an annotation without narrowing further. Also valid: chain
// `.where(...)` before `.first(undefined, ...)`.
await db.orm.User.first(undefined, (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000 })));

// ✗ Type error: write terminal rejects read-only annotation.
await db.orm.User.create(input, (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000 })));

// ✓ SQL DSL: chainable on select / grouped builders.
const plan = db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .annotate(cacheAnnotation({ ttl: 60_000 }))
  .build();
```

## Cache key composition

Two-tier resolution:

1. **Per-query override.** `cacheAnnotation({ key })`.
2. **Default.** `RuntimeMiddlewareContext.contentHash(exec)`.

With `cacheStrategy.mode = 'versioned'`, the middleware appends per-model generation tokens (`|g:model@version,...`) to the base key. Mutations invalidate by bumping generations, which avoids broad key scans for model-level invalidation.

## Mutation invalidation and strategy controls

Precedence for mutation invalidation:

1. `uncacheAnnotation` on the mutation
2. global middleware config `uncacheOnMutation`

### Uncache workflow

When a write executes, the middleware follows this order:

1. Inspect the execution plan and skip invalidation entirely when the write is not eligible.
  - `uncacheAnnotation({ skip: true })` or `enabled: false` stops here.
  - When neither the annotation nor `uncacheOnMutation` enables invalidation, the write returns without touching the cache.
2. Read the invalidation payload.
  - If `uncacheAnnotation({ uncache: [...] })` is present, those actions are used exactly as provided.
  - If no explicit `uncache` list exists, the middleware synthesizes a default action from the global policy, usually scoped to the current namespace.
3. Derive the affected models and exact entity selectors from the execution AST when the strategy supports it.
  - Simple CRUD writes can resolve a model name directly from the AST.
  - Exact entity invalidation uses the primary-key columns when the contract exposes them; otherwise it falls back to the current `id` heuristic.
  - Composite primary keys are supported when all PK columns are constrained by equality conditions.
4. Choose the invalidation strategy.
  - `targeted` tries entity-targeted deletes first and falls back to broader model invalidation when the write is not an exact PK match.
  - `broad` deletes all cached keys for the affected model.
  - `versioned` bumps the model generation token so old cache entries become unreachable.
  - Automatic fallback: when `targeted`/`broad` is configured but the store does not provide `del`/`list`, metadata-driven model/entity invalidation automatically switches to generation bumping.
5. Check store capabilities before issuing deletes.
  - If the chosen path needs key deletion, the store must implement `del`.
  - If the invalidation path needs namespace or model scans, the store must implement `list` as well.
  - In `versioned` mode, the middleware can avoid broad scans for normal model invalidation, but `incr` improves cross-instance generation bumps.
  - With automatic fallback enabled, metadata-driven uncache paths (detected model/entity invalidation) no longer require `del`/`list`; explicit key deletes still require `del`.
6. Apply the invalidation.
  - Explicit `keys` are deleted after optional namespace prefixing.
  - Model invalidation deletes the indexed keys for that model.
  - Entity invalidation deletes only the exact entity cache entry when the PK selector is complete.
7. Emit telemetry and finish.
  - Generation mode emits bump and cleanup events.
  - Detached store operation mode may schedule the store work in the background, but the invalidation decision itself is still made before the response leaves the middleware.

Effective rules:

- `uncacheAnnotation({ skip: true })` or `enabled: false` disables invalidation for that mutation.
- `uncacheAnnotation({ enabled: true })` forces invalidation even when global invalidation is disabled.
- `uncache` action list takes precedence when provided and runs each action in order.
- Affected models are derived automatically from execution plan AST where possible.

Strategy comparison:

| Mode | Invalidation behavior | Read hit behavior after mutation | Store requirements | Trade-off |
|---|---|---|---|---|
| `targeted` | entity-targeted for simple id CRUD, else model-level | stale keys are actively deleted where targeted | `del` and often `list` required | best precision, more index bookkeeping |
| `broad` | broad model-level key deletion | broad invalidation per model | `del` and often `list` required | simple and safe, lower hit-rate on hot models |
| `versioned` | bump model version; no broad model key scan | old keys become unreachable through generation suffix | model invalidation works without `del/list` | robust under fanout; old keys live until TTL or eviction |

When `targeted` or `broad` is selected but `del`/`list` is missing, the middleware automatically falls back to generation invalidation for metadata-driven paths. This keeps uncache behavior available in constrained stores while preserving explicit-key safety checks.

Generation options:

Exact entity invalidation is driven by primary-key columns when the middleware can resolve them from the runtime contract. When that metadata is not available, the middleware falls back to the current `id`-based heuristic.

This works for both single-column and composite primary keys. When a write operation targets an entity via an equality filter on all PK columns, only the cached rows for that exact entity are invalidated — other entities in the same table remain cached.

```typescript
// Single-column PK (e.g. users.id)
await db.orm.User.delete({ id: 42 });
// → invalidates only the cache entry for user 42

// Composite PK (e.g. kv: { ns, key })
await db.sql
  .from(tables.kv)
  .delete()
  .where(
    eq(tables.kv.columns.ns, 'tenant-a'),
    eq(tables.kv.columns.key, 'feature-x'),
  )
  .build();
// → invalidates only the cache entry for { ns: 'tenant-a', key: 'feature-x' }
// → leaves all other kv entries in the cache untouched
```

Queries that do not match exactly on all PK columns (list queries, range filters, partial matches) fall through to broad or versioned invalidation depending on `cacheStrategy.mode`.

- `cacheStrategy.generation.bumpOn`:
  - `uncache` (default): bump only on uncache path.
  - `all-writes`: bump on every successful write.
- `cacheStrategy.generation.scope`:
  - `detected-models` (default): use models from write AST.
  - `action-models-preferred`: prefer annotation action models when present.
- `cacheStrategy.generation.guard`:
  - `enabled`: best-effort stale-key cleanup (requires `store.del`).
  - `maxDeletesPerBump`: cleanup cap per bump.

The implementation is table-driven internally, so future strategies can be added by extending the strategy definition map instead of spreading new branches through the middleware.

For a shared backend across multiple Node.js services, the important store contract is:

- `broad` / `targeted` need `list` and `del` so the shared reverse indexes can be discovered and cleared across instances.
- `versioned` additionally benefits from `incr` so generation bumps are shared robustly instead of relying on get & set by default.

Telemetry emitted in generation mode:

- `middleware.cache.generation.bump` with `models` and `deletedKeys`
- `middleware.cache.generation.guard.cleanup` with `models`, `deletedKeys`, and `maxDeletesPerBump`

## Detached store operations

`storeOperationMode` controls whether cache store writes/deletes are part of the request critical path:

- `await` (default): middleware waits for cache store `set`/`del` work to finish.
- `detached`: middleware schedules store work in the background and does not wait.

```typescript
const middleware = createCacheMiddleware({
  store,
  storeOperationMode: 'detached',
});
```

Pros (`detached`):

- Lower response-time impact from slow cache backends.
- Mutations and cache commits are less likely to inherit cache backend latency spikes.

Cons (`detached`):

- Eventual consistency window: invalidation/commit may complete shortly after the response.
- Best-effort error handling: detached store failures are logged (`ctx.log.warn`) but do not fail the request.
- Operational visibility becomes more important; monitor warning logs for detached task failures.

## Hit and dedupe signals

The runtime already exposes whether an execution was served by middleware or by the driver through `AfterExecuteResult.source`:

- `source: 'middleware'` covers both cache hits and deduped followers.
- `source: 'driver'` means the query executed normally and the rows came from the driver.

If you need to distinguish cache hits from dedupe followers, use the middleware logs:

- `middleware.cache.hit` marks a direct cache hit.
- `middleware.cache.dedupe.wait` marks a follower waiting for an in-flight miss.
- `middleware.cache.dedupe.hit` marks a follower that reused the leader's result.

## `CacheStore` pluggability

The default in-memory store is per-process and **not** coherent across replicas. For shared caching, supply a custom `CacheStore`:

```typescript
import type { CacheStore, CachedEntry } from '@prisma-next/middleware-cache';

const redis: CacheStore = {
  async get(key) {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as CachedEntry) : undefined;
  },
  async set(key, entry, ttlMs) {
    await redisClient.set(key, JSON.stringify(entry), 'PX', ttlMs);
  },
  async list(prefix) {
    const match = prefix ? `${prefix}*` : '*';
    const keys: string[] = [];
    for await (const key of redisClient.scanIterator({ MATCH: match, COUNT: 500 })) {
      keys.push(key as string);
    }
    return keys;
  },
  async del(key) {
    await redisClient.del(key);
  },
  async incr(key) {
    return redisClient.incr(key);
  },
};

const middleware = createCacheMiddleware({ store: redis });
```

`CacheStore` interface:

```typescript
export interface CacheStore {
  get(key: string): Promise<CachedEntry | undefined>;
  set(key: string, entry: CachedEntry, ttlMs: number): Promise<void>;
  list?(prefix?: string): Promise<readonly string[]>;
  del?(key: string): Promise<void>;
  delByTag?(tags: readonly string[]): Promise<void>;
  incr?(key: string, delta?: number): Promise<number>;
}
```

For key-deletion-based invalidation paths (`uncacheOnMutation` with model/key deletes, `uncacheAnnotation` actions, or `middleware.uncache`), your store should implement `del` and, for full namespace scans, `list`.

For generation mode, implement `incr` so model generation bumps can be shared robustly across processes instead of falling back to a process-local counter.

In generation mode, model invalidation can work without `list`/`del` because invalidation is performed by generation bumps; `incr` improves cross-instance coherence.

## Transaction-scope guard

The middleware bypasses the cache entirely when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`. Only top-level `runtime.execute` (`scope === 'runtime'`) consults the store.

This avoids two surprises:

- Inside a transaction, the caller expects read-after-write coherence with their own writes — the cache cannot meaningfully serve those reads without tracking the transaction's pending writes, which is out of scope for this milestone.
- On a checked-out connection (`runtime.connection().execute(...)`), the caller has explicitly stepped outside the shared runtime surface and likely does not expect the global cache to inject results.

## TTL and LRU semantics

The default `createInMemoryCacheStore({ maxEntries, clock? })`:

- **TTL.** Each entry is committed with the per-query `ttl` (in milliseconds). The store evaluates expiry against its injected clock (defaults to `Date.now`); reads of expired entries return `undefined` and drop the entry as a side effect.
- **LRU.** Iteration order is the LRU order. Reads and writes both bump recency. When the live count would exceed `maxEntries`, the oldest entry is evicted.
- **Failure handling.** The middleware commits to the store only when `afterExecute` reports `completed: true && source: 'driver'`. Driver errors mid-stream and middleware-served executions never populate the cache.

## Caveats

- **Default store is not coherent across replicas.** Multiple processes / pods do not share state. Use a custom `CacheStore` (Redis, etc.) for cross-process coherence.
- **Concurrent misses both populate by default.** Two concurrent first-time reads of the same key both run the driver and both commit; last writer wins. Enable single-flight/coalescing with `readDedupe: true` globally or `cacheAnnotation({ dedupe: true })` per query.
- **Reads of stale-on-arrival entries.** With a custom replicated store, a follower may serve a stale entry for a brief window after the writer commits. Use the storage-hash discrimination plus a sensible TTL.
- **No invalidation beyond TTL.** Entries are not invalidated by writes by default; mutation invalidation requires `uncacheOnMutation`, `uncacheAnnotation`, or explicit `middleware.uncache(...)`. If a write invalidates a cached read, choose a TTL short enough to bound the staleness window, or pass `cacheAnnotation({ skip: true })` on reads that must be authoritative.
- **Versioned mode keeps old keys until TTL/eviction.** In `cacheStrategy.mode = 'versioned'`, old-generation keys become unreachable after bump but may remain physically present until TTL or eviction; guard cleanup is best-effort and optional.

## See also

- [Runtime & Middleware Framework](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md) for the SPI and middleware lifecycle (including the `intercept` hook the cache uses).
- [ADR 204 — Single-tier runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-tier%20runtime.md) for why the cache middleware is family-agnostic by construction.
