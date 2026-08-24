# Summary

Add a family-agnostic `intercept` hook to the `runWithMiddleware` orchestrator that lets middleware short-circuit query execution and return rows without hitting the driver. Add a typed annotation surface (`.annotate(...)` on SQL DSL and ORM `Collection`) so middleware can read per-query metadata. Ship a first-party caching middleware as the proof point and the April stop condition for TML-2143's VP4 milestone.

# Description

Today, `RuntimeMiddleware` is observer-only: `beforeExecute`, `onRow`, and `afterExecute` can inspect execution and raise errors, but they cannot substitute a result. This blocks the whole class of interception use cases listed in TML-2143 — caching, mocking, rate limiting, circuit breaking — and forces those features to live outside the middleware pipeline as bespoke wrappers around lanes or runtimes.

Two prerequisites have already landed on `main`:

- **`beforeCompile` rewrite hook (TML-2306).** SQL middleware can rewrite the AST between lane `.build()` and `adapter.lower()`. The chain runs inside `SqlRuntimeImpl.runBeforeCompile()` (an override of `RuntimeCore`'s template).
- **Single-tier runtime (TML-2242, ADR 204).** The `runtime-executor` package has been collapsed into `@internal/framework-components`. Both `SqlRuntimeImpl` and `MongoRuntimeImpl` now extend an abstract `RuntimeCore<TPlan, TExec, TMiddleware>` whose `execute()` template is `runBeforeCompile → lower → runWithMiddleware(beforeExecute → driver loop → onRow → afterExecute)`. The `runWithMiddleware` helper is the single canonical implementation of the middleware lifecycle; both families inherit it.

This project adds the second piece of the TML-2143 vision — short-circuiting with static results — and the minimum annotation surface needed to make interception opt-in on a per-query basis. The third piece (full middleware-API redesign, composition ordering metadata, cache invalidation semantics beyond TTL) is explicitly deferred to May.

The architectural simplification from ADR 204 means the `intercept` hook lives in exactly one place — `runWithMiddleware` — and both families pick it up via inheritance. There is no per-family wiring.

Genuinely cross-family interception requires one small SPI addition: middleware that need a per-execution identity (the cache middleware, future request-coalescing middleware) cannot synthesize one from a content-free `ExecutionPlan` marker without reaching into family-specific fields. We add `RuntimeMiddlewareContext.contentHash(exec)` so the family runtime — which knows the concrete shape — supplies the canonical key, and middleware author against the framework type without family-specific imports or runtime probing. This keeps the cache middleware genuinely cross-family from day one and follows the same pattern any future content-hash-keyed middleware will reuse.

The annotation surface carries an applicability constraint: each annotation handle declares the operation kinds (`'read'` / `'write'`) it applies to, and lane terminals enforce that constraint at both the type level and runtime. This makes "caching a mutation" — the obvious footgun for an opt-in cache — structurally impossible: `cacheAnnotation` declares `applicableTo: ['read']`, so passing it to `create()` / `update()` / `delete()` / `upsert()` fails to compile. The cache middleware needs no mutation classifier, no `plan.meta.lane` heuristic, no `ast.kind` fallback. Other annotations (audit, OTel) declare their own applicability and reuse the same gate.

The forcing function is the April milestone VP4 stop condition: *a repeated query is served from cache without hitting the database; the middleware interface supports short-circuiting and result injection*. A caching middleware exercises the full range — interception, opt-in via annotations, composition with existing observers and rewriters — and validates that the interface supports use cases beyond observability.

# Before / After

## Middleware SPI

**Before** — middleware can observe but not substitute:

```typescript
export interface RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan> {
  readonly name: string
  beforeExecute?(plan: TPlan, ctx): Promise<void>  // can throw, cannot answer
  onRow?(row, plan, ctx): Promise<void>
  afterExecute?(plan, result, ctx): Promise<void>
}
```

**After** — middleware can answer the query directly:

```typescript
export interface RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan> {
  readonly name: string
  intercept?(plan: TPlan, ctx): Promise<InterceptResult | undefined>  // NEW
  beforeExecute?(plan: TPlan, ctx): Promise<void>
  onRow?(row, plan, ctx): Promise<void>
  afterExecute?(plan, result, ctx): Promise<void>
}

export type InterceptResult = {
  readonly rows:
    | AsyncIterable<Record<string, unknown>>
    | Iterable<Record<string, unknown>>
}
```

`intercept` operates on the post-lowering `TExec` plan, mirroring how `beforeExecute` / `onRow` / `afterExecute` already do. It runs inside `runWithMiddleware`, after the orchestrator receives the lowered plan but before any `beforeExecute` hook fires.

## Query-level annotations

**Before** — no way to attach per-query metadata that middleware can read:

```typescript
// SQL DSL
const plan = db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .build()

// ORM
const users = await db.orm.User.limit(10).all()
```

**After** — applicability-typed annotations:

```typescript
import { cacheAnnotation } from '@internal/middleware-cache'

// SQL DSL — chainable per builder kind. SelectQueryBuilder accepts read
// annotations; Insert/Update/DeleteQueryBuilder accepts write annotations.
const plan = db.sql
  .from(tables.user)
  .annotate(cacheAnnotation({ ttl: 60 }))   // ✓ select builder, read annotation
  .select({ id: tables.user.columns.id })
  .build()

// ORM — variadic last argument on terminal methods. Each terminal
// constrains the accepted annotations to the kinds applicable to it.
const user = await db.orm.User.first(
  { id },
  cacheAnnotation({ ttl: 60 })              // ✓ read annotation on read terminal
)

const created = await db.orm.User.create(
  { email: 'a@b.com' },
  cacheAnnotation({ ttl: 60 })              // ✗ type error: write terminal rejects read-only annotation
)
```

## Caching middleware usage

```typescript
import { createCacheMiddleware, cacheAnnotation } from '@internal/middleware-cache'

const db = postgres<Contract, TypeMaps>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: [createCacheMiddleware({ maxEntries: 1000 })],
})

// First call: hits the database, caches raw rows.
const a = await db.orm.User
  .annotate(cacheAnnotation({ ttl: 60 }))
  .where({ active: true })
  .all()

// Second call with identical plan: served from cache, driver not invoked.
const b = await db.orm.User
  .annotate(cacheAnnotation({ ttl: 60 }))
  .where({ active: true })
  .all()

// Un-annotated queries are never cached — caching is strictly opt-in.
const c = await db.orm.User.all()  // always hits DB
```

# Requirements

## Functional Requirements

### Intercept hook (framework SPI)

0. **`contentHash` on `RuntimeMiddlewareContext`.** Required method `contentHash(exec: ExecutionPlan): Promise<string>` on `RuntimeMiddlewareContext` in `@internal/framework-components/runtime`. Family runtimes compose a canonical string and pipe it through `hashContent` (SHA-512 via WebCrypto, from `@internal/utils/hash-content`) to produce a bounded, opaque digest. The method is async because `hashContent` uses `crypto.subtle.digest`, which returns a `Promise`; the resolved value is the literal string `sha512:` followed by a 128-character lowercase hex digest (a fixed 135-character total). SQL composes `meta.storageHash + '|' + exec.sql + '|' + canonicalStringify(exec.params)`; Mongo composes `meta.storageHash + '|' + canonicalStringify(exec.command)`. Two semantically equivalent executions produce the same digest. **The contract is "an opaque, bounded-size string"** — implementations must not return raw concatenated output. Two reasons for hashing: (a) **bounded memory** — a query bound to a 10 MB JSON column would otherwise produce a 10 MB cache key, scaling to gigabytes at `maxEntries=1000`; (b) **sensitive-data isolation** — parameter values appear verbatim in the canonical string and would otherwise leak into debug logs, Redis `KEYS` / `MONITOR` output, persistence dumps, monitoring tools, and any user-supplied `CacheStore` implementation. **Note:** `computeSqlFingerprint` (which exists in `sql-runtime/src/fingerprint.ts` for telemetry) strips literals to group executions by statement shape — the *opposite* of what `contentHash` needs. Do not reuse it; `contentHash` wants the raw SQL plus canonicalized params so it discriminates between executions of the same statement with different parameter values.

1. **`intercept` hook on `RuntimeMiddleware`.** Optional async method on the cross-family `RuntimeMiddleware<TPlan>` interface in `@internal/framework-components/runtime`. Signature: `intercept(plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<InterceptResult | undefined>`. Returning `undefined` signals passthrough; returning an `InterceptResult` short-circuits execution. The `TPlan` parameter follows the existing `RuntimeMiddleware<TPlan>` generic — middleware sees the post-lowering `TExec` plan, the same shape `beforeExecute` / `onRow` / `afterExecute` already see.

2. **Pipeline placement.** `intercept` runs inside `runWithMiddleware`, *after* the orchestrator receives the lowered plan and *before* any `beforeExecute` hook fires. On a hit: `beforeExecute`, the driver loop, and `onRow` are all skipped. `afterExecute` still fires.

3. **Chain semantics.** Middleware run in registration order. The first middleware to return a non-`undefined` result wins; subsequent middleware's `intercept` does not fire. The runtime emits a `ctx.log.debug` event naming the middleware that intercepted (mirrors the `middleware.rewrite` event from TML-2306).

4. **Verification ordering preserved.** Contract-marker verification happens upstream of `runWithMiddleware` in `SqlRuntimeImpl.executeAgainstQueryable` (and would in any other family that needs it). A stale-schema query still throws `contract/hash-mismatch` before any interceptor sees it. This requirement does not change verification placement; it only states that the new hook does not bypass verification.

5. **`AfterExecuteResult.source`.** Extend `AfterExecuteResult` with `source: 'driver' | 'middleware'` (additive). Observers ignoring the field are unaffected. Set inside `runWithMiddleware` based on whether interception occurred.

6. **Row shape at the orchestrator.** `InterceptResult.rows` carries untyped rows (`Record<string, unknown>`), matching the row type `runWithMiddleware` already yields and the row type passed to `onRow`. The SQL runtime's decode pass (which wraps the orchestrator output) runs on intercepted rows the same way it runs on driver rows, so interceptors cache and return raw (undecoded) rows.

7. **Family-agnostic.** The hook lives on `RuntimeMiddleware` in `framework-components`, not on `SqlMiddleware` or `MongoMiddleware`. Because both family runtimes inherit `RuntimeCore.execute` → `runWithMiddleware`, no family-specific wiring is required. The first-party cache middleware is SQL-focused for April but should work unchanged against Mongo.

8. **Error propagation.** Errors thrown by a middleware inside `intercept` propagate as raw `Error`s like `beforeExecute` errors do. `afterExecute` still fires with `completed: false`, mirroring `runWithMiddleware`'s existing error-path semantics. Errors thrown by `afterExecute` during the error path remain swallowed (existing behavior, unchanged).

9. **Raw-SQL lanes.** Raw-SQL plans arrive as fully-lowered `SqlExecutionPlan` and skip `runBeforeCompile`/`lower` via the early-return in `executeAgainstQueryable`. They still reach `runWithMiddleware` and are therefore eligible for interception like any other plan; the cache middleware's own policy decides whether to cache them.

### Annotation surface

1. **`OperationKind`.** `type OperationKind = 'read' | 'write'`. Exported from `@internal/framework-components/runtime`. Read = `SELECT` / `find` / `first` / `all` / `count` / aggregates. Write = `INSERT` / `UPDATE` / `DELETE` / `create` / `update` / `delete` / `upsert`. Finer-grained kinds (`'select' | 'insert' | 'update' | 'delete' | 'upsert'`) are deferred; if an annotation appears that needs them, we widen.

2. **`defineAnnotation` helper.** Exported from `@internal/framework-components/runtime`. Two-step call form: `defineAnnotation<Payload>()({ namespace: string; applicableTo: readonly Kinds[] }): AnnotationHandle<Payload, Kinds>`. The first step takes only `Payload` as an explicit type argument; the second step takes the runtime options and infers `Kinds` from the `applicableTo` array via a `const` type parameter, so the operation kinds appear once at the call site rather than being repeated in the type-argument list. (TypeScript does not support partial type-argument inference within a single call: a single-step `defineAnnotation<Payload, const Kinds>` would still require both type arguments be passed explicitly because `Payload` cannot be inferred from anywhere; currying separates the explicit-from-inferred step. The cost is one extra `()` at definition; once defined, handles are used identically.) The returned handle is **callable**: invoking `handle(value)` produces an `AnnotationValue<Payload, Kinds>` ready to pass to a lane terminal's variadic `annotations` argument. The handle also exposes `namespace`, `applicableTo: ReadonlySet<Kinds>`, and `read(plan)` as properties on the function. Handles are the only supported public entry point for reading/writing annotations. (No `.apply(...)` method — calling the handle directly is the sole construction path; this keeps user-facing call sites compact: `cacheAnnotation({ ttl: 60 })` rather than `cacheAnnotation.apply({ ttl: 60 })`.)

3. **Applicability gate type.** `ValidAnnotations<K extends OperationKind, As extends readonly AnnotationValue<unknown, OperationKind>[]>` mapped tuple type that resolves each element of `As` to `never` when its declared `Kinds` does not include `K`. Lane terminals use this to constrain their variadic annotation argument.

4. **Storage.** Applied annotations land under `plan.meta.annotations[namespace]`. Framework-reserved namespaces (`codecs`, target-specific keys such as `pg`) are documented as off-limits for user handles.

5. **SQL DSL `.annotate()`.** Chainable builder method, typed per builder kind. `SelectQueryImpl` / `GroupedQueryImpl` (in `packages/2-sql/4-lanes/sql-builder/src/runtime/query-impl.ts`) accept `ValidAnnotations<'read', As>`; `InsertQueryImpl` / `UpdateQueryImpl` / `DeleteQueryImpl` (in `mutation-impl.ts`) accept `ValidAnnotations<'write', As>`. Annotations merge into `plan.meta.annotations` at `.build()` time. Multiple `.annotate()` calls compose; duplicate namespaces use last-write-wins.

6. **ORM terminal-argument annotations.** Each terminal method on `Collection` (`packages/3-extensions/sql-orm-client/src/collection.ts`) accepts a variadic last argument `...annotations: ValidAnnotations<K, As>` where `K` is the terminal's operation kind. Read terminals (`first`, `find`, `all`, `take().all`, `count`, aggregate methods, `get`, `findMany`-equivalents): `K = 'read'`. Write terminals (`create`, `update`, `delete`, `upsert`, and any in-place mutation entry points): `K = 'write'`. There is **no** chainable `.annotate()` on `Collection`; this is an intentional scope cut from earlier drafts (it would have required a separate mutation-classifier in the cache middleware). *(Superseded post-M2 by `api-revision-meta-callback.md`: the variadic last argument is replaced by an optional `configure: (meta: MetaBuilder<K>) => void` callback. The applicability gate `K` and its semantics carry over; see the revision spec for the call-site shape and the rationale.)*

7. **Runtime applicability check at the lane.** Each lane terminal walks its variadic `annotations` array and rejects any whose `applicableTo` set does not include the terminal's operation kind, throwing a clear `runtimeError` (e.g. `RUNTIME.ANNOTATION_INAPPLICABLE`) naming the annotation namespace and the terminal. The runtime check is belt-and-suspenders: the type system fails closed for type-aware callers, and the runtime check fails closed for casts / `any` / dynamic invocations.

8. **Type safety.** `defineAnnotation<Payload, Kinds>` preserves `Payload` and `Kinds` across the handle's call signature and `read`. Reading an absent annotation returns `undefined`. No `any` or unchecked casts in the public surface.

### Cache middleware (`@internal/middleware-cache`, new package)

1. **Opt-in by annotation.** `cacheAnnotation = defineAnnotation<CachePayload>()({ namespace: 'cache', applicableTo: ['read'] })` (`Kinds` inferred as `'read'`). Payload: `{ ttl?: number; skip?: boolean; key?: string }`. A query without `cacheAnnotation`, or with `skip: true`, or without a `ttl`, passes through untouched. Because `cacheAnnotation` declares `applicableTo: ['read']`, the lane gate (type-level + runtime) rejects passing it to a write terminal — there is no in-middleware mutation guard.

2. **Cache key resolution.** Two-tier priority: per-query `cacheAnnotation({ key })` overrides everything; otherwise `ctx.contentHash(exec)` from the family runtime. The cache middleware itself never reads `exec.sql`, `exec.command`, or any other family-specific field — it depends only on `@internal/framework-components/runtime`.

3. **Cache hit path.** On lookup hit, `intercept` returns the cached raw rows. The SQL runtime decodes them through its normal codec pass (which wraps the orchestrator output). `afterExecute` observes `source: 'middleware'`.

4. **Cache miss path.** On lookup miss, `intercept` returns `undefined` (passthrough). The middleware records the per-query key/buffer in a private `WeakMap<TExec, …>`, accumulates rows via `onRow`, and commits to the store in `afterExecute` only when `completed: true`. Partial/failed queries are not cached.

5. **`CacheStore` interface.** Pluggable storage:

   ```typescript
   interface CacheStore {
     get(key: string): Promise<CachedEntry | undefined>
     set(key: string, entry: CachedEntry, ttlMs: number): Promise<void>
   }
   interface CachedEntry {
     readonly rows: readonly Record<string, unknown>[]
     readonly storedAt: number
   }
   ```

   Default implementation: in-memory LRU with TTL. The interface is exported so users can supply Redis, Memcached, etc.

6. **No in-middleware mutation guard.** The applicability gate in the annotation system makes a separate mutation guard inside the cache middleware redundant. The cache middleware does not inspect `plan.meta.lane`, `plan.ast.kind`, or any operation-kind signal. If a mutation reaches the middleware with `cacheAnnotation` applied, it means somebody bypassed the lane gate (cast, `any`, direct plan construction) — that's outside the trust boundary the cache middleware is responsible for.

7. **Transaction-scope guard.** The cache middleware only intercepts on the top-level runtime `execute`, not on `connection().execute`, `transaction().execute`, or the transaction-scoped `RuntimeQueryable` produced by `withTransaction`. Mechanism is defined in the plan (lean: extend `RuntimeMiddlewareContext` with `scope: 'runtime' | 'connection' | 'transaction'`, populated by `SqlRuntimeImpl` at context-creation time per scope).

8. **Concurrency.** Per-query correlation uses `WeakMap<TExec, {key, buffer}>` keyed on the post-lowering `TExec` object identity. Plan identity per-invocation is documented as an invariant and covered by a regression test. The SQL runtime currently freezes the executable plan inside `executeAgainstQueryable` (one fresh frozen object per call); this satisfies the invariant.

## Non-Functional Requirements

1. **Performance budget.** Zero-middleware path regression ≤ 0 (no change). Cache-miss path overhead ≤ 1 ms median on local driver baseline. Cache-hit path returns without IO latency.

2. **Additive framework changes.** All SPI changes are additive. Existing middleware (`budgets`, `lints`, telemetry) continue to work without modification.

3. **Type safety.** No `any`, no `@ts-expect-error` outside negative type tests, no unchecked casts in the public surface. The `intercept` row shape (`Record<string, unknown>`) matches the existing `onRow` / driver-loop shape, so no new casts appear in `runWithMiddleware`.

4. **Logging fidelity.** Cache hits and misses log via `ctx.log.debug` with middleware name and a key digest (not the raw key, to keep logs PII-light). Mirrors the `middleware.rewrite` pattern from TML-2306.

## Non-goals

- **Full middleware-API redesign (`next()`-style onion composition).** Deferred to May. The hook model — now augmented with `intercept` — is sufficient for OTel, tracing, rate limiting, and interception; if a genuine onion use case surfaces, we revisit.
- **`ctx.state` per-query scratch space.** Not needed for the cache middleware; not added opportunistically. Middleware that need correlation use per-instance `WeakMap<TExec, …>` keyed on plan identity.
- **Middleware ordering metadata (`dependsOn`, `conflictsWith`).** Registration order remains the sole source of truth.
- **Cache invalidation strategies beyond TTL and storage-hash keying.** No event-based invalidation, no tag-based invalidation, no `db.orm.User.invalidate()`. Deferred to May.
- **Chainable ORM `.annotate()`.** Annotations attach via the variadic last argument on terminal methods only. The original draft proposed a chainable `Collection.annotate()`; that was dropped because it forced an in-middleware mutation guard and fought the applicability-gate design. May reconsider if a real ergonomic problem surfaces. *(Update: a real ergonomic problem did surface — variadic-on-terminal forecloses on adding any future per-call options. The replacement is not a chainable `Collection.annotate()` but a meta-callback configurator: `db.orm.User.find({ id }, (meta) => meta.annotate(cacheAnnotation({ ttl })))`. See `api-revision-meta-callback.md` for the delta spec. The "no chainable on `Collection`" cut still holds — the chainable would have lived on `Collection`; the configurator lives on a `MetaBuilder<K>` constructed by the terminal.)*
- **Finer-grained `OperationKind`.** `'read' | 'write'` for April. No `'select' | 'insert' | 'update' | 'delete' | 'upsert'`, no per-aggregate distinctions. Widening is additive — handles already accept a `Kinds` set, so a future split keeps existing handles compiling.
- **`contentHash` API surface beyond what the cache middleware needs.** The method returns `Promise<string>` (resolving to a `sha512:HEX128` digest). No structured (`{statement, params}`) shape and no batch variant. Future content-hash-keyed middleware (request coalescing, single-flight) consume the same string.
- **Annotation validation at contract-emit time.** Annotations are runtime metadata only; they do not affect the Contract or its hashes.
- **In-cache mutation classification.** Replaced by lane-level applicability gates (see Functional Requirements). The cache middleware ships without `isMutationPlan`, without `plan.meta.lane` parsing, without `ast.kind` fallback.
- **ADR 014 deprecation.** TML-2306 already flagged ADR 014 as stale; this project does not formally retire it. (ADR 204 supersedes the runtime-separation portion of ADR 140 separately.)

# Acceptance Criteria

## Intercept hook

- [ ] `RuntimeMiddlewareContext.contentHash(exec)` is declared in `@internal/framework-components/runtime` returning `Promise<string>` (resolving to a `sha512:HEX128` digest produced via `hashContent`).
- [ ] `SqlRuntimeImpl` populates `contentHash` with `meta.storageHash` + `exec.sql` + canonicalized `exec.params`. Two executions of the same SQL with the same params produce the same string; different params produce different strings (unit test).
- [ ] `MongoRuntimeImpl` populates `contentHash` with `meta.storageHash` + canonicalized `exec.command` (unit test in mongo-runtime).
- [ ] All in-repo `RuntimeMiddlewareContext` fixtures compile after the addition (regression — three test files in `framework-components/test/` plus any others surfaced by `pnpm typecheck`).
- [ ] `RuntimeMiddleware.intercept` is declared in `@internal/framework-components/runtime` with the signature above.
- [ ] `AfterExecuteResult.source` is `'driver' | 'middleware'` and is populated by `runWithMiddleware`.
- [ ] First middleware returning a non-`undefined` `InterceptResult` wins; subsequent interceptors' `intercept` does not fire (unit test against `runWithMiddleware`).
- [ ] On a hit, `beforeExecute`, the driver loop, and `onRow` are skipped; `afterExecute` fires with `source: 'middleware'` (unit test).
- [ ] On all passthroughs (`undefined` from every interceptor), `runWithMiddleware` behaves identically to pre-change (regression test against existing fixtures).
- [ ] An interceptor that throws surfaces via `runtimeError`; `afterExecute` receives `completed: false` (unit test). Errors thrown by `afterExecute` during the error path remain swallowed.
- [ ] `intercept` runs after marker verification — a hash mismatch still throws `contract/hash-mismatch` even if an interceptor would have answered (integration test against the SQL runtime).
- [ ] SQL runtime decodes intercepted raw rows through the same codec pass as driver rows (integration test). `executeAgainstQueryable` wraps `runWithMiddleware`'s row stream with `decodeRow`; intercepted rows take the same path.
- [ ] Mongo runtime observes `intercept` for free via inherited `runWithMiddleware` (parity test with a generic mock interceptor; existing cross-family proof test from TML-2255 is extended).

## Annotation surface

- [ ] `OperationKind` exported from `@internal/framework-components/runtime` as `'read' | 'write'` (type test).
- [ ] `defineAnnotation<Payload>()({ namespace, applicableTo })` exists in `@internal/framework-components/runtime`, typed as described (curried; `Kinds` inferred from `applicableTo` via a `const` type parameter on the inner call).
- [ ] `read` returns `Payload | undefined` with full type preservation (type-level test).
- [ ] Handle exposes `applicableTo: ReadonlySet<Kinds>` for runtime checks (unit test).
- [ ] Two handles with different namespaces do not interfere (unit test).
- [ ] `ValidAnnotations<K, As>` resolves each tuple element to `never` when its declared kinds do not include `K` (type test, positive + negative).
- [ ] SQL DSL `SelectQueryImpl.annotate(...)` accepts a read-only annotation; the same call against `InsertQueryImpl` fails to compile (type test).
- [ ] SQL DSL `InsertQueryImpl.annotate(...)` accepts a write-only annotation; the same call against `SelectQueryImpl` fails to compile (type test).
- [ ] SQL DSL `.annotate(...)` merges into `plan.meta.annotations[namespace]` at `.build()` time across all five builder kinds (unit test).
- [ ] Multiple `.annotate()` calls compose; duplicate namespace = last-write-wins (unit test).
- [ ] ORM read-terminal call `db.User.first(where, cacheAnnotation({ ttl: 60 }))` typechecks; `db.User.create(input, cacheAnnotation({ ttl: 60 }))` does not (type test, both directions).
- [ ] ORM write-only annotation accepted on `create` / `update` / `delete` / `upsert`; rejected on `first` / `find` / `all` / `count` (type test).
- [ ] Annotations applicable to both kinds (e.g. `defineAnnotation<P>()({ namespace, applicableTo: ['read', 'write'] })`) accepted on every terminal (type test).
- [ ] An annotated ORM read produces a `SqlQueryPlan` whose `meta.annotations[namespace]` carries the payload (integration test).
- [ ] An annotated SQL DSL query produces a `SqlQueryPlan` whose `meta.annotations[namespace]` carries the payload (integration test).
- [ ] Lane runtime check rejects an annotation whose `applicableTo` set does not include the terminal's kind, with `RUNTIME.ANNOTATION_INAPPLICABLE` naming the annotation and terminal (unit test, exercised via cast bypass of the type gate).
- [ ] Framework-reserved namespaces (`codecs`) are documented in the `defineAnnotation` TSDoc; user-supplied `defineAnnotation('codecs')` is not structurally prevented, but its behavior with the emitter is documented as undefined.

## Cache middleware

- [ ] `@internal/middleware-cache` package exists under `packages/3-extensions/`, following the layering conventions validated by `pnpm lint:deps`.
- [ ] `cacheAnnotation` handle is exported; payload shape matches the spec.
- [ ] `CacheStore` interface is exported; default in-memory LRU implementation is exported.
- [ ] `createCacheMiddleware(options)` returns a cross-family `RuntimeMiddleware` with `intercept` / `onRow` / `afterExecute` wired. The middleware reads cache keys from `ctx.contentHash(exec)` (or `cacheAnnotation({ key })` when supplied per-query). The package depends only on `@internal/framework-components/runtime` — no SQL or Mongo runtime dependency.
- [ ] Un-annotated queries are never cached (unit test).
- [ ] Queries with `skip: true` are never cached (unit test).
- [ ] Queries with no `ttl` are never cached (unit test).
- [ ] First call of an annotated query misses cache, hits driver, populates store on success (integration test; driver invocation asserted via mock).
- [ ] Second identical call hits cache, skips driver, returns equivalent decoded rows (integration test; telemetry sees `source: 'middleware'`).
- [ ] A failed first call (driver throws) does not populate the cache (integration test).
- [ ] `cacheAnnotation` is rejected at write terminals by both type-level and runtime gates (covered by annotation-surface ACs above; cache middleware itself contains no mutation classifier).
- [ ] Queries executed via `connection().execute()` or `transaction().execute()` bypass the cache (integration test).
- [ ] TTL expiry evicts entries (unit test with injectable clock).
- [ ] LRU eviction at `maxEntries` (unit test).
- [ ] Concurrent execution of the same plan from parallel callers produces correct results; plan-identity invariant holds (regression test).
- [ ] Storage-hash changes (schema migration) produce different cache keys and invalidate old entries (unit test).

## Composition

- [ ] Cache middleware composes with `softDelete` (TML-2306 `beforeCompile`): soft-deleted rows are absent from cached results; the cache key reflects the rewritten AST because the lowered SQL the cache middleware sees is post-rewrite (integration test).
- [ ] Cache middleware composes with telemetry: telemetry observes `beforeExecute` on miss but not on hit; `afterExecute` fires in both cases with the correct `source` (integration test).

## Documentation

- [ ] `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` updated: new "Intercepting Execution" section after the existing `runWithMiddleware` description; document `intercept` hook semantics, lifecycle diagram update, `source` field, annotation surface with `defineAnnotation` example, reserved-namespace note.
- [ ] `packages/3-extensions/middleware-cache/README.md` covers opt-in behavior, key composition, store pluggability, mutation/transaction guards, TTL/LRU semantics.
- [ ] TML-2143 Linear ticket updated to reflect that the April stop condition is met; May deferrals restated explicitly.

# Other Considerations

## Coordination

- **Stack position.** Branched off the post-#381 `tml-2242-unified-runtime-executor-and-query-plan-interfaces-across` branch (Will's TML-2242 unification). TML-2306 (`beforeCompile`) is already on `main`. As Will's branch lands on `main`, we rebase mechanically. Per Will's review iteration so far, the architecture (single-tier `RuntimeCore`, `runWithMiddleware`, plan markers) is stable; further pushes are likely to be doc/lint touch-ups.
- **orm-consolidation.** Reshaping the ORM client call surface in parallel. This project adds `.annotate()` to `Collection` and proceeds without blocking on consolidation. If the consolidation work moves `Collection` or replaces its builder, `.annotate()` travels with it — mechanical rebase.

## Risk

- **Plan-identity invariant for `WeakMap` correlation.** The cache middleware keys per-query state on the post-lowering `TExec` object identity. `SqlRuntimeImpl.executeAgainstQueryable` constructs a fresh `Object.freeze({...lowered, params: ...})` on every call, so identity per-invocation holds today. ADR 025's future plan-memoization work could violate it silently. Mitigation: document the invariant in the subsystem doc and pin it with a concurrency regression test. If memoization ever ships, reviewers see the test break.
- **Annotations namespace collision.** `plan.meta.annotations.codecs` is already consumed by the emitter. User handles using `'codecs'` would collide. Mitigation: document reserved namespaces in the `defineAnnotation` TSDoc; do not attempt structural prevention (it would constrain the schema surface unnecessarily).
- **Cache correctness under concurrent refresh.** Two concurrent misses of the same key both populate the store; last writer wins. Acceptable for April. Request-coalescing / single-flight semantics are a follow-up.
- **Cache coherence across replicas.** In-memory cache is per-process. A Redis-backed store is the documented answer; the default in-memory store is explicitly not coherent across processes. Documented in the README.
- **Security.** No new SQL-injection surface — annotations are metadata, not SQL. Cached rows inherit the same trust boundary as the driver's results. The cache key includes `storageHash`, preventing stale-schema hits. No user-controlled data influences SQL generation.

## Observability

Cache hits and misses are logged via `ctx.log.debug` with the middleware name and key digest. No new telemetry events are added at the runtime level — existing `afterExecute` telemetry captures the outcome, augmented by the `source` field.

## Cost

No infrastructure cost change. The default in-memory store trades memory for DB round-trips; `maxEntries` bounds memory. Redis/Memcached adapters are the user's responsibility and outside the default path.

# References

- **TML-2143 — Enhanced middleware API to replace runtime plugin system** (this project's umbrella ticket): https://linear.app/prisma-company/issue/TML-2143
- **TML-2306 — Middleware rewriteable AST: beforeCompile hook** (prerequisite, on `main`): https://linear.app/prisma-company/issue/TML-2306
- **TML-2242 — Unified runtime executor and query-plan interfaces across SQL and Mongo** (architectural prerequisite, in PR #381): https://linear.app/prisma-company/issue/TML-2242
- **TML-2255 — Cross-family runtime & middleware SPI** (cross-family middleware foundation): https://linear.app/prisma-company/issue/TML-2255
- **VP4 milestone** — WS3: Runtime pipeline, "VP4: Middleware supports request rewriting"
- **ADR 204 — Single-tier runtime: collapse `runtime-executor` into `framework-components`**: `docs/architecture docs/adrs/ADR 204 - Single-tier runtime.md`
- Subsystem doc — `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Runtime middleware SPI: `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`
- Abstract base: `packages/1-framework/1-core/framework-components/src/runtime-core.ts`
- Canonical orchestrator: `packages/1-framework/1-core/framework-components/src/run-with-middleware.ts`
- Plan markers: `packages/1-framework/1-core/framework-components/src/query-plan.ts`
- SQL runtime: `packages/2-sql/5-runtime/src/sql-runtime.ts` (`SqlRuntimeImpl extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>`)
- SQL `beforeCompile` chain: `packages/2-sql/5-runtime/src/middleware/before-compile-chain.ts`
- Mongo runtime: `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` (`MongoRuntimeImpl extends RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>`)
- SQL DSL builder base: `packages/2-sql/4-lanes/sql-builder/src/runtime/builder-base.ts`
- ORM `Collection`: `packages/3-extensions/sql-orm-client/src/collection.ts`
- Telemetry middleware (shape reference): `packages/3-extensions/middleware-telemetry/`
- `plan.meta.annotations` schema: `packages/1-framework/0-foundation/contract/src/types.ts` (`PlanMeta`)
- ADR 025 — Plan caching & memoization in runtime
- ADR 027 — Error envelope & stable codes
- ADR 030 — Result decoding & codecs registry

# Open Questions

1. **~~Mutation classification.~~** Resolved by the applicability gate: `cacheAnnotation` declares `applicableTo: ['read']`; lane terminals reject inapplicable annotations at type and runtime levels; the cache middleware no longer needs a classifier.

2. **Transaction-scope signaling.** Two candidates:
   (a) `RuntimeMiddlewareContext` gains an optional `scope: 'runtime' | 'connection' | 'transaction'` flag, populated per scope by `SqlRuntimeImpl`.
   (b) Top-level-only middleware invocation: `connection()`/`transaction()` paths build a separate runtime context that omits middleware.
   Option (b) is cleaner architecturally but silently disables telemetry inside transactions, which is worse. Lean: (a). Resolve in the plan before M3.

3. **`InterceptResult` row shape.** `AsyncIterable<Record<string, unknown>> | readonly Record<string, unknown>[]`, or just one of the two? Array is simpler for the cache middleware; iterable supports future streaming interceptors (e.g. mock layers replaying recordings). Lean: accept both via a union.

4. **Default `maxEntries`.** 1000? 10000? Pick a sensible default; document it; make it overridable. Not a blocker.

5. **~~Cache key hashing cost.~~** Resolved: hash via SHA-512 (WebCrypto `crypto.subtle.digest`). Earlier analysis (per prior Prisma query-plan caching work) was that V8's internal string-interning Map performance dominates any user-space hash, suggesting we should skip hashing. That analysis applies to **parametric** plan caching where keys are small structural fingerprints — it does not generalize to **per-execution** content hashes, which embed concrete parameter values and therefore inherit the size and sensitivity of those values. Two failure modes drove the reversal: (a) **memory** — a query bound to a 10 MB JSON column produces a 10 MB cache key, scaling to gigabytes at `maxEntries=1000`; (b) **PII / secrets isolation** — parameter values flow into debug logs, Redis `KEYS` output, persistence dumps, monitoring, and user-supplied `CacheStore` implementations. SHA-512 via WebCrypto was chosen: `crypto.subtle.digest` is built into Node and the browser (no native dependency), it is async (which is why `contentHash` returns `Promise<string>`), and the 512-bit output makes accidental collisions astronomically improbable at negligible cost over 256-bit output. Output format: the literal prefix `sha512:` followed by a 128-character lowercase hex digest (`sha512:HEX128`, a fixed 135-character total). `canonicalStringify` and `hashContent` both live in `@internal/utils` so SQL and Mongo runtimes share a single source of truth.

6. **Family scope of cache middleware.** Resolved: cross-family `RuntimeMiddleware`. Cache keys come from `ctx.contentHash(exec)`, populated by the family runtime. The cache package depends only on `framework-components/runtime`. Mongo gets first-class support day one because `MongoRuntimeImpl` populates `contentHash` alongside SQL.

7. **`contentHash` collision risk.** With no output hash, the only collision path is canonicalization losing information (dropping a param, unstable object-key order, type-confusion across BigInt/number boundaries). Mitigation: family runtimes own their `contentHash` implementation but delegate canonicalization to the shared `@internal/utils/canonical-stringify` helper; canonicalization is unit-tested for stability across object-key order, BigInt/number distinctness, Date round-trip, Buffer hex-encoding, and nested structures. The cache middleware tests pin the end-to-end behavior.

8. **Per-aggregate / per-mutation kind discrimination.** Future annotations may need finer-grained kinds (e.g. an audit annotation that applies to `update` and `delete` but not `insert`). The current `'read' | 'write'` binary is sufficient for `cacheAnnotation`; widening is additive (`OperationKind` becomes a wider union, existing handles' `Kinds` parameter still typechecks). Not a blocker for April.

9. **ORM terminal enumeration.** The set of "terminal methods" that need the variadic annotation argument depends on the orm-consolidation reshape. M2 will enumerate them at implementation time; the spec pins the kind classification but not the exhaustive list.
