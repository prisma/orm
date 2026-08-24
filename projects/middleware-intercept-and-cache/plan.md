# Middleware Intercept Hook + Caching Middleware

## Summary

Deliver the April stop condition for TML-2143 / WS3 VP4: a repeated query is served from cache without hitting the database, and the middleware interface supports short-circuiting and result injection. Implemented as three stacked milestones — framework SPI (`intercept` hook in `runWithMiddleware` + `defineAnnotation` + `AfterExecuteResult.source`), lane-level annotation surface (SQL DSL + ORM `Collection`), and the first-party cache middleware package.

**Spec:** `projects/middleware-intercept-and-cache/spec.md`

## Stack position

This project is branched off `tml-2242-unified-runtime-executor-and-query-plan-interfaces-across` (Will's TML-2242 unification, PR #381). TML-2306 (`beforeCompile`) is already on `main` and incorporated into that branch. Rebase onto `main` once #381 lands; further pushes from #381's review iteration are expected to be doc/lint touch-ups, not architectural.

## Architectural anchors (post-ADR 204)

- All runtime SPI lives in `@internal/framework-components/runtime`. The `runtime-executor` package is gone.
- `RuntimeCore<TPlan, TExec, TMiddleware>` is the abstract base; `SqlRuntimeImpl` and `MongoRuntimeImpl` extend it.
- `runWithMiddleware` is the single canonical orchestrator for `beforeExecute → driver loop → onRow → afterExecute`. **This is where `intercept` lives — adding it once gives both families the hook via inheritance.**
- `RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan>` is generic; family-specific middleware narrows to its `*ExecutionPlan`.
- Hooks observe the post-lowering `TExec` plan, not the pre-lowering `TPlan`.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Alexey | Drives execution; WS3 runtime pipeline owner |
| Architectural prerequisite | Will (TML-2242) | Single-tier runtime + `RuntimeCore` + `runWithMiddleware` |
| Beforehand | Serhii (TML-2306) | `beforeCompile` chain on `SqlRuntimeImpl.runBeforeCompile()` (already on `main`) |
| Adjacent | orm-consolidation project | `Collection` surface reshape ongoing; proceed without blocking, rebase as needed |

## Milestones

### Milestone 1: Framework SPI — `intercept` hook + annotations + `source` field

Lands the additions to `@internal/framework-components/runtime`. Because `intercept` lives in `runWithMiddleware`, both family runtimes inherit it for free — there is no per-family wiring task this milestone.

**Tasks:**

- [ ] **1.0 Add `contentHash` to `RuntimeMiddlewareContext`.** Required method `contentHash(exec: ExecutionPlan): Promise<string>` in `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`. The signature is async because the landed `hashContent` implementation uses `crypto.subtle.digest`, which returns a `Promise`. Update the existing `RuntimeMiddlewareContext` type test in `framework-components/test/runtime-middleware.types.test-d.ts` to assert the new property (and that its return type is `Promise<string>`). Update the three in-repo `RuntimeMiddlewareContext` fixtures (`framework-components/test/mock-family.test.ts`, `framework-components/test/run-with-middleware.test.ts`, `framework-components/test/runtime-core.test.ts`) with an async stub implementation (e.g. `contentHash: async () => 'mock-hash'`). `pnpm typecheck` must remain green; surface any other fixture sites the typechecker reveals.

- [ ] **1.0a Add `canonicalStringify` to `@internal/utils`.** New module `packages/1-framework/0-foundation/utils/src/canonical-stringify.ts` exporting `canonicalStringify(value: unknown): string`. Stable JSON-like serialization with sorted object keys. Handles: primitives, arrays (order-preserving), plain objects (key-sorted), `BigInt` (suffixed with `n` to disambiguate from `number`), `Date` (ISO string), `Buffer` / `Uint8Array` (hex-encoded with a type tag), `null` / `undefined` distinction. Throws on functions/symbols. Export from `exports/index.ts` (or wherever the existing utils export surface lives — confirm at implementation time). Unit tests: stable across object key order; BigInt and number with same numeric value produce distinct strings; Date round-trips; Buffer hex-encoded; nested structures; deterministic across runs.

- [ ] **1.0a' Add `hashContent` to `@internal/utils`.** New module `packages/1-framework/0-foundation/utils/src/hash-content.ts` exporting `hashContent(value: string): Promise<string>`. Wraps WebCrypto's `crypto.subtle.digest('SHA-512', …)` and returns `` `sha512:${hex}` `` — 135 chars total (literal `sha512:` prefix + 128 lowercase hex chars), fixed regardless of input size. The function is async because `crypto.subtle.digest` is async by design; callers must `await` the result. The contract is "produce a bounded, opaque digest of a canonical-string identity." Two reasons for hashing rather than using the canonical string directly: (a) bounded memory — a 10 MB JSON parameter would otherwise produce a 10 MB cache key, scaling to gigabytes at `maxEntries=1000`; (b) sensitive-data isolation — parameter values flow into debug logs, Redis `KEYS` output, persistence dumps, and any user-supplied `CacheStore` implementation. SHA-512 via WebCrypto chosen over a Node-only stdlib hash because `crypto.subtle.digest` is built into Node and the browser (no native dependency); 512-bit output for collision headroom at negligible incremental cost over 256-bit. The algorithm tag in the prefix is self-describing so a future migration produces visibly distinct keys. Unit tests: fixed-length output (135 chars); deterministic across repeated calls; discriminates differing inputs (incl. trailing-character and separator-placement edge cases); opacity (output does not embed input); UTF-8 multi-byte handling; Unicode normalization is byte-significant (NFC vs NFD differ).

- [ ] **1.0b Populate `contentHash` in `SqlRuntimeImpl`.** In `packages/2-sql/5-runtime/src/sql-runtime.ts` (via a new `sql-runtime/src/content-hash.ts` helper), populate `sqlCtx.contentHash(exec)` as an async function that returns `` await hashContent(`${exec.meta.storageHash}|${exec.sql}|${canonicalStringify(exec.params)}`) ``. Import `canonicalStringify` from `@internal/utils/canonical-stringify` and `hashContent` from `@internal/utils/hash-content`. Note that `hashContent` is async (it wraps `crypto.subtle.digest`), so the helper and the populated `contentHash` are also async. Do **not** reuse `computeSqlFingerprint` (it strips literals for telemetry grouping and is a separate, synchronous concern; `contentHash` needs the opposite — raw SQL plus per-param discrimination, hashed via `hashContent` + `canonicalStringify`). Unit-test in `sql-runtime/test/` (using `await`): same `(sql, params, storageHash)` → same key; differing params → different keys; differing `storageHash` → different keys; key order in object params does not affect key; output matches `^sha512:[0-9a-f]{128}$`; output does not embed raw SQL or params (opacity); fixed-size output regardless of payload size.

- [ ] **1.0c Populate `contentHash` in `MongoRuntimeImpl`.** In `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` (via a new `mongo-runtime/src/content-hash.ts` helper), populate `ctx.contentHash(exec)` as an async function that returns `` await hashContent(`${exec.meta.storageHash}|${canonicalStringify(exec.command)}`) ``. Import the same `canonicalStringify` and `hashContent` from `@internal/utils`. As in 1.0b, the helper and populated `contentHash` are async because `hashContent` wraps `crypto.subtle.digest`. Unit-test in `mongo-runtime/test/` (using `await`): distinct commands → distinct keys; equivalent commands with shuffled object key order → same key; output matches `^sha512:[0-9a-f]{128}$`; output does not embed command payload (opacity); fixed-size output regardless of payload size.

- [ ] **1.1 Define `InterceptResult` and extend `RuntimeMiddleware`.** Add `InterceptResult` type and `intercept?` method to `RuntimeMiddleware<TPlan>` in `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`. `InterceptResult.rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>` (the union covers arrays, sync generators, and async generators; `for await` natively handles both via `Symbol.asyncIterator` / `Symbol.iterator` fallback, so the orchestrator needs no branching). Export from `exports/runtime.ts`. Write type tests in `framework-components/test/runtime-middleware.types.test-d.ts`: `intercept` is optional; arrays satisfy `Iterable<Row>` (positive); sync generators satisfy `Iterable<Row>`; async generators satisfy `AsyncIterable<Row>`; return type is `Promise<InterceptResult | undefined>`; `intercept` parameter is `TPlan` (verify with both `QueryPlan` default and a narrowed `SqlExecutionPlan`).

- [ ] **1.2 Extend `AfterExecuteResult` with `source`.** Add `source: 'driver' | 'middleware'` to `AfterExecuteResult` in `runtime-middleware.ts`. Audit telemetry middleware (`packages/3-extensions/middleware-telemetry/src/telemetry-middleware.ts`) to round-trip the field. Verify existing `runtime-middleware.types.test-d.ts` and Mongo/SQL type tests still pass.

- [ ] **1.3 Wire `intercept` chain in `runWithMiddleware`.** Update `packages/1-framework/1-core/framework-components/src/run-with-middleware.ts`. Iterate middleware in registration order calling `mw.intercept?.(exec, ctx)`; first non-`undefined` result wins. On hit: skip the `beforeExecute` loop, skip `runDriver`, skip `onRow`; iterate the intercepted `rows` (handling both array and `AsyncIterable`); fire `afterExecute` with `source: 'middleware'`. On all-passthrough: existing behavior, `source: 'driver'`. On hit followed by error during row iteration: `afterExecute` fires with `completed: false`, `source: 'middleware'`. Emit `ctx.log.debug?.({ event: 'middleware.intercept', middleware: mw.name })` on hit.

- [ ] **1.4 Unit tests for `runWithMiddleware` intercept semantics.** In `framework-components/test/run-with-middleware.test.ts` (or new `run-with-middleware.intercept.test.ts`):
  - First interceptor wins; second's `intercept` does not fire.
  - Hit path: `beforeExecute` not called; `runDriver` factory not invoked; `onRow` not called; `afterExecute` fires once with `source: 'middleware'` and correct `rowCount`.
  - Miss path (all `undefined`): identical behavior to pre-change with `source: 'driver'`.
  - Hit path with array rows yields all rows in order.
  - Hit path with sync `Iterable` (generator function) yields all rows in order.
  - Hit path with `AsyncIterable` rows yields all rows in order.
  - Interceptor throw: `afterExecute` fires with `completed: false`, error rethrown, swallow semantics for `afterExecute`-during-error preserved.
  - Mixed: middleware A returns `undefined`, B intercepts → only B's `intercept` runs, but A's `beforeExecute` does *not* run (it's a hit).

- [ ] **1.5 SQL runtime: verify intercepted rows get decoded.** No production code change expected — `executeAgainstQueryable` already wraps the `runWithMiddleware` row stream with `decodeRow`. Add an integration test in `packages/2-sql/5-runtime/test/sql-runtime.test.ts` (or alongside) that registers a mock `SqlMiddleware` with `intercept` returning raw rows containing values that need codec decoding (e.g. a JSON column) and asserts the consumer sees decoded values. Documents the contract: cache the raw, decode on the way out.

- [ ] **1.6 Mongo parity test.** Extend `test/integration/test/cross-package/cross-family-middleware.test.ts` (the cross-family proof from TML-2255) with a generic mock interceptor that returns canned rows. Run it through both SQL and Mongo runtimes. Assert: driver not invoked in either family; `afterExecute` sees `source: 'middleware'` in both; rows match canned. No production code change required — Mongo inherits `intercept` via `runWithMiddleware`.

- [ ] **1.7 Implement `defineAnnotation` helper with applicability.** Add `packages/1-framework/1-core/framework-components/src/annotations.ts`. Export `OperationKind = 'read' | 'write'`. **Curried two-step signature:** `defineAnnotation<Payload>(): <const Kinds extends OperationKind>(options: { namespace: string; applicableTo: readonly Kinds[] }) => AnnotationHandle<Payload, Kinds>`. The first call takes only `Payload` as an explicit type argument; the second call takes the runtime options and infers `Kinds` from `applicableTo` via a `const` type parameter, so the operation kinds appear once at the call site rather than being repeated as a type argument. Currying is required because TypeScript does not support partial type-argument inference: with a single-step `defineAnnotation<Payload, const Kinds>` form, callers would still have to pass both type arguments explicitly (TS2558) since `Payload` is not inferable from anywhere. The returned handle is a **callable function** (not a plain object): `handle(value: Payload)` produces an `AnnotationValue<Payload, Kinds>`. The function also carries `namespace: string`, `applicableTo: ReadonlySet<Kinds>` (frozen), and `read(plan: { meta: { annotations?: Record<string, unknown> } }): Payload | undefined` as attached properties. Implementation pattern: outer factory returns an inner generic factory; the inner factory defines a local `function handle(value: Payload) { … }`, then `Object.assign(handle, { namespace, applicableTo, read })` and freezes the result before returning. Type the return value as a hybrid `AnnotationHandle<Payload, Kinds>` interface that combines a call signature with the property bag. There is intentionally no `.apply(...)` method — calling the handle directly is the sole construction path. `AnnotationValue` carries `__annotation: true`, `namespace`, `value`, `applicableTo`. Export from `exports/runtime.ts`.

- [ ] **1.7a Define `ValidAnnotations<K, As>` mapped tuple.** In the same module. `type ValidAnnotations<K extends OperationKind, As extends readonly AnnotationValue<unknown, OperationKind>[]> = { readonly [I in keyof As]: As[I] extends AnnotationValue<infer P, infer Kinds> ? K extends Kinds ? AnnotationValue<P, Kinds> : never : never }`. Export. This is the gate type lane terminals consume.

- [ ] **1.7b Lane-side runtime applicability check helper.** Export `assertAnnotationsApplicable(annotations: readonly AnnotationValue<unknown, OperationKind>[], kind: OperationKind, terminalName: string): void` from the same module. Iterates the array; on any annotation whose `applicableTo` set lacks `kind`, throws `runtimeError('RUNTIME.ANNOTATION_INAPPLICABLE', …)` naming the offending namespace and the terminal. Used by both SQL DSL builders and ORM `Collection` terminals.

- [ ] **1.8 Unit + type tests for `defineAnnotation` and `ValidAnnotations`.** In `framework-components/test/annotations.test.ts` and `annotations.types.test-d.ts`:
  - Two handles with different namespaces do not interfere.
  - `read` returns `Payload | undefined` with preserved type (negative test on wrong payload).
  - Calling the handle (e.g. `handle({ ttl: 60 })`) produces an `AnnotationValue<Payload, Kinds>` with the `__annotation` brand and frozen `applicableTo`.
  - Handle is callable as a function (typeof handle === 'function') and exposes `namespace`, `applicableTo`, and `read` as own properties.
  - Handle does **not** expose a `.apply` method (negative test: `'apply' extends keyof typeof handle` is `false`, or equivalently `handle.apply` is the inherited `Function.prototype.apply` rather than the construction entry point).
  - `read` of an absent annotation returns `undefined`.
  - `read` ignores annotations applied via a different handle even when the namespace string matches (sanity check on the brand).
  - `ValidAnnotations<'read', [readOnly, both]>` resolves all elements to live `AnnotationValue` types.
  - `ValidAnnotations<'read', [writeOnly]>` resolves the element to `never` (negative type test).
  - `ValidAnnotations<'write', [readOnly]>` resolves the element to `never` (negative type test).
  - `assertAnnotationsApplicable` throws `RUNTIME.ANNOTATION_INAPPLICABLE` on a mismatched annotation; passes on matching ones; passes on empty arrays.

- [ ] **1.9 Document reserved namespaces.** TSDoc on `defineAnnotation` listing `codecs` and target-specific keys (`pg`, …) as reserved framework namespaces. No structural prevention.

### Milestone 2: Lane annotation surface — SQL DSL + ORM `Collection`

Adds the user-facing `.annotate(...)` surface on both query lanes. After this milestone, users can attach typed payloads to any plan, but nothing yet consumes them.

**Tasks:**

- [ ] **2.1 Add `.annotate()` to SQL DSL select builders (read-typed).** In `packages/2-sql/4-lanes/sql-builder/src/runtime/query-impl.ts`, add `.annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(...annotations: As & ValidAnnotations<'read', As>): this` to `SelectQueryImpl` and `GroupedQueryImpl`. **The `As & ValidAnnotations<...>` intersection is load-bearing** — see the discovery note in Open Items and the TSDoc on `ValidAnnotations`. Builder records annotations on internal state (immutable clone, like other builder methods). At `.build()` time, call `assertAnnotationsApplicable(annotations, 'read', 'select.build')` and merge into `plan.meta.annotations` by namespace. Last-write-wins on duplicate namespaces. Plumb the type through `packages/2-sql/4-lanes/sql-builder/src/types/select-query.ts` and `grouped-query.ts` so chaining typechecks in any position.

- [ ] **2.2 Add `.annotate()` to SQL DSL mutation builders (write-typed).** In `packages/2-sql/4-lanes/sql-builder/src/runtime/mutation-impl.ts`, add `.annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(...annotations: As & ValidAnnotations<'write', As>): this` to `InsertQueryImpl`, `UpdateQueryImpl`, `DeleteQueryImpl`. Same recording / merge / runtime-check pattern as 2.1, with `kind = 'write'`. Plumb the type through `packages/2-sql/4-lanes/sql-builder/src/types/mutation-query.ts`.

- [ ] **2.3 Unit tests for SQL DSL annotations.** In `sql-builder/test/runtime/`:
  - Read builders: single `.annotate()` populates `plan.meta.annotations[namespace]`.
  - Write builders: same.
  - Multiple `.annotate()` calls with different namespaces coexist.
  - Duplicate namespace = last wins.
  - `.annotate()` does not affect `plan.ast` shape (snapshot diff before/after).
  - Chainable in any position on read builders (`.from().annotate().where().select().build()`, `.from().where().annotate().build()`, etc.).
  - Chainable in any position on write builders.
  - Runtime check: passing a write-only annotation through a cast to a select builder's `.annotate(...)` then `.build()` throws `RUNTIME.ANNOTATION_INAPPLICABLE`.
  - Runtime check: read-only annotation on a mutation builder via cast throws likewise.

- [ ] **2.4 Type tests for SQL DSL annotations.** Type-d tests in `sql-builder/test/playground/`:
  - `cacheAnnotation` (read-only) accepted on `SelectQueryImpl.annotate(...)`.
  - `cacheAnnotation` (read-only) on `InsertQueryImpl.annotate(...)` fails to compile (negative).
  - A write-only annotation accepted on `InsertQueryImpl` / `UpdateQueryImpl` / `DeleteQueryImpl`.
  - A write-only annotation on `SelectQueryImpl` fails to compile (negative).
  - A `'read' | 'write'` annotation accepted on every builder kind.
  - A handle defined as `defineAnnotation<{ ttl: number }>()({ namespace, applicableTo: ['read'] })` accepts only the typed payload when called (`handle({ ttl: 60 })` typechecks; `handle({ ttl: 'sixty' })` fails to compile — negative). `Kinds` is inferred from `applicableTo` (`'read'` here) — verify by asserting the handle's static type is `AnnotationHandle<{ ttl: number }, 'read'>`, not `AnnotationHandle<{ ttl: number }, OperationKind>`.
  - `.annotate()` does not widen the resulting plan's `Row` type.

- [ ] **2.5 Add variadic annotation arg to ORM read terminals.** In `packages/3-extensions/sql-orm-client/src/collection.ts` and `model-accessor.ts`, extend each read terminal's signature with a variadic last argument `<As extends readonly AnnotationValue<unknown, OperationKind>[]>(...annotations: As & ValidAnnotations<'read', As>)`: `first`, `find`, `all`, `take().all`, `count`, aggregate methods, and any `findMany`-equivalent terminals. **Use the `As & ValidAnnotations<...>` intersection** — without it the type-level gate silently lets inapplicable annotations through (see Open Items). The terminal calls `assertAnnotationsApplicable(annotations, 'read', '<terminalName>')` before plan construction and merges annotations into `meta.annotations` via the existing plan-builder path (`query-plan-select.ts`, `query-plan-aggregate.ts`). Enumerate the exhaustive terminal list during implementation; if `orm-consolidation` reshapes terminals mid-project, rebase mechanically.

- [ ] **2.6 Add variadic annotation arg to ORM write terminals.** Same as 2.5 for `create`, `update`, `delete`, `upsert`, and any in-place mutation entry points. Kind = `'write'`; signature uses `As & ValidAnnotations<'write', As>`. Plan-builder path in `query-plan-mutations.ts` and `mutation-executor.ts`.

- [ ] **2.7 Drop chainable `Collection.annotate()` if any draft survives.** Belt-and-suspenders: confirm no `.annotate()` survives on `Collection` itself or on grouped/include collection types. Annotations only attach via terminal arguments. `Collection<Row>` should be type-identical to its pre-annotation shape minus terminal signatures.

- [ ] **2.8 Unit tests for ORM annotations.** In `sql-orm-client/test/`:
  - `db.User.first({ id }, cacheAnnotation({ ttl: 60 }))` produces a plan with `meta.annotations.cache`.
  - `db.User.where({active: true}).limit(10).all(cacheAnnotation({ ttl: 60 }))` likewise.
  - `db.User.create(input, writeAnnotation(...))` produces a plan with the annotation.
  - Annotation survives `.include(...)` (relation queries) and grouped paths when attached at the appropriate terminal.
  - Multiple annotations on a single terminal call coexist; duplicate namespace last-wins.
  - Runtime check: a write-only annotation cast through `as any` and passed to `first()` throws `RUNTIME.ANNOTATION_INAPPLICABLE` at the lane.
  - Runtime check: read-only annotation via cast on `create()` throws likewise.

- [ ] **2.9 Type tests for ORM annotations.** In `sql-orm-client/test/`:
  - `db.User.first({ id }, cacheAnnotation({ ttl: 60 }))` typechecks.
  - `db.User.create(input, cacheAnnotation({ ttl: 60 }))` does not compile (negative).
  - Read-only annotation accepted on `first` / `find` / `all` / `count` / aggregates; rejected on `create` / `update` / `delete` / `upsert` (one negative case per write terminal).
  - Write-only annotation: mirror image.
  - `'read' | 'write'` annotation accepted on every terminal.
  - Annotation arg preserves terminal return types (e.g. `first` still returns `Row | null`, not widened).
  - `Collection.annotate` does *not* exist as a method (negative type test asserts `'annotate' extends keyof Collection<Row>` is false).

- [ ] **2.10 Refresh package declarations.** Run `pnpm build` on `framework-components`, `sql-runtime`, `sql-builder`, `sql-orm-client` to refresh `dist/*.d.mts` for downstream packages. Run `pnpm typecheck` and `pnpm lint:deps` to confirm clean.

### Milestone 3: Cache middleware package — April stop condition

Delivers `@internal/middleware-cache`. Exit: integration test proves a repeated query is served from cache without hitting the driver, composes with `softDelete` and telemetry. **The stop condition lives in task 3.16.**

**Tasks:**

- [ ] **3.1 Resolve transaction-scope signaling.** Implement spec open question 2 before scaffolding the cache middleware. Lean: extend `RuntimeMiddlewareContext` in `framework-components/src/runtime-middleware.ts` with `scope: 'runtime' | 'connection' | 'transaction'`. `SqlRuntimeImpl` populates per scope: top-level `executeAgainstQueryable` uses `'runtime'`; `connection()`/`transaction()`/`withTransaction` build a derived context with the appropriate scope. Mongo runtime uses `'runtime'` for now (no transaction surface yet). Backwards compatibility: existing middleware ignoring the field continue to work.

- [ ] **3.2 ~~Mutation classification.~~** **Dropped.** Resolved at the lane level by the applicability gate (M2). `cacheAnnotation` declares `applicableTo: ['read']`; lane terminals reject inapplicable annotations at type and runtime levels; the cache middleware ships without `isMutationPlan`, without `plan.meta.lane` parsing, without `ast.kind` fallback.

- [ ] **3.3 Scaffold `@internal/middleware-cache`.** Create `packages/3-extensions/middleware-cache/` following the `middleware-telemetry` layout (`package.json`, `tsconfig.json`, `tsconfig.prod.json`, `tsdown.config.ts`, `vitest.config.ts`, `biome.jsonc`, `src/exports/index.ts`, `README.md` stub). Add to `pnpm-workspace` if needed. Run `pnpm lint:deps` after scaffold (before adding real code) to verify clean baseline.

- [ ] **3.4 Define `cacheAnnotation` handle and `CachePayload` type.** In `src/cache-annotation.ts`: `cacheAnnotation = defineAnnotation<CachePayload>()({ namespace: 'cache', applicableTo: ['read'] })` (curried form: `Payload` explicit, `Kinds` inferred as `'read'` from `applicableTo`). `CachePayload = { ttl?: number; skip?: boolean; key?: string }`. Export from `exports/index.ts`.

- [ ] **3.5 Define `CacheStore` interface and in-memory LRU default.** In `src/cache-store.ts`: `CacheStore` interface (`get`, `set`), `CachedEntry = { rows: readonly Record<string, unknown>[]; storedAt: number }`, `createInMemoryCacheStore({ maxEntries }: { maxEntries: number })` factory producing an LRU-with-TTL store. Injectable clock (`now: () => number`) for TTL testing. Export interface, factory, and `CachedEntry`.

- [ ] **3.6 Implement `createCacheMiddleware`.** In `src/cache-middleware.ts`. Returns a cross-family `RuntimeMiddleware` (no `familyId`) with `intercept` / `onRow` / `afterExecute` wired. Private `WeakMap<object, { key: string; buffer: Record<string, unknown>[] }>` keyed on the post-lowering plan object identity. Options: `{ store?: CacheStore; maxEntries?: number; clock?: () => number }`. Default `maxEntries`: 1000. The package depends only on `@internal/framework-components/runtime` — no SQL or Mongo runtime dependency.

- [ ] **3.7 Resolve cache keys via `contentHash`.** Two-tier resolution: per-query `cacheAnnotation({ key })` overrides everything; otherwise `ctx.contentHash(exec)` from the family runtime. The resolved string is an opaque, bounded SHA-512 digest (literal prefix `sha512:` plus 128 lowercase hex chars, 135 chars total) produced by the family runtime via `hashContent` (`@internal/utils/hash-content`, which wraps `crypto.subtle.digest` and is async); the cache middleware awaits `ctx.contentHash(exec)` and uses the resolved string as the `Map<string, …>` key as-is. The cache middleware itself never reads `exec.sql`, `exec.command`, or any other family-specific field. No `keyFn` option, no structural probe, no error path for non-SQL plans — Mongo and any future family work day one as long as their runtime populates `contentHash`. The cache package itself does not import `node:crypto`; hashing is the family runtime's responsibility, and the cache package depends only on `@internal/framework-components/runtime`. User-supplied `cacheAnnotation({ key })` is **not** rehashed — that's the user's responsibility (document in M3.20 README that user keys are stored as-is).

- [ ] **3.8 ~~Mutation guard.~~** **Dropped.** Lane-level applicability gate (M2) makes a separate in-middleware mutation guard redundant. The cache middleware's `intercept` does not classify operation kind.

- [ ] **3.9 Transaction-scope guard.** In `intercept`, check `ctx.scope` (from 3.1). If `scope !== 'runtime'`, pass through.

- [ ] **3.10 Hit-path behavior.** Read `cacheAnnotation` from `exec.meta.annotations`; if absent, `skip: true`, or no `ttl`, return `undefined`. Compute key. `await store.get(key)`. On hit with non-expired entry, log `middleware.cache.hit` via `ctx.log.debug` and return `{ rows: entry.rows }`.

- [ ] **3.11 Miss-path behavior.** On `intercept` miss, record `{ key, buffer: [] }` in the `WeakMap` keyed by `exec`. `onRow` reads the entry, pushes the row to the buffer. `afterExecute` reads the entry; if `result.completed === true && result.source === 'driver'`, calls `store.set(key, { rows: buffer, storedAt: clock() }, ttlMs)`. Always cleans up the `WeakMap` entry. Log `middleware.cache.miss` (and `middleware.cache.store` on commit) via `ctx.log.debug`.

- [ ] **3.12 Unit tests — opt-in semantics.** In `middleware-cache/test/cache-middleware.test.ts`:
  - Un-annotated query: store never called.
  - `cacheAnnotation({ skip: true })`: store never called.
  - `cacheAnnotation({ })` (no `ttl`): store never called.
  - Presence of annotation alone without `ttl` does not cache.

- [ ] **3.13 Unit tests — store mechanics.** In `middleware-cache/test/cache-store.test.ts`:
  - LRU eviction at `maxEntries`.
  - TTL expiry via injected clock.
  - `store.set` only called on `completed: true && source === 'driver'`.
  - Partial failure (driver throws mid-stream): cache not populated; `WeakMap` entry cleaned up.
  - Concurrent `set` of same key: last-write-wins; no crash.

- [ ] **3.14 Unit tests — guards.** In `middleware-cache/test/cache-middleware.test.ts`:
  - `scope: 'connection'` bypasses cache.
  - `scope: 'transaction'` bypasses cache.
  - (Mutation rejection is verified at the lane level by M2 acceptance criteria, not inside the cache middleware.)

- [ ] **3.15 Unit tests — key composition.** In `middleware-cache/test/cache-key.test.ts`:
  - Default path: `ctx.contentHash(exec)` is invoked and its return value is used directly as the `Map` key (no further transformation in the cache middleware; the family runtime is responsible for hashing inside `contentHash`).
  - Different `storageHash` → different keys for otherwise-identical SQL (validates SQL `contentHash` impl from 1.0b end-to-end).
  - Different params → different keys.
  - User-supplied `cacheAnnotation({ key })` short-circuits `ctx.contentHash` (assert `contentHash` is not invoked when annotation `key` is supplied). User-supplied keys are stored as-is — no rehashing.
  - (Canonicalization stability across object-key order is covered by `canonicalStringify` tests in 1.0a; hash output format / opacity / bounded size are covered by `hashContent` tests in 1.0a'; not duplicated here.)

- [ ] **3.16 Integration test — stop condition.** In `test/integration/test/cross-package/middleware-cache.test.ts`. Real Postgres (per `cross-family-middleware.test.ts` pattern) + ORM. Execute the same annotated ORM query twice. Assert: driver invocation count is 1 (mock-spy or driver-level counter); decoded rows equivalent on both calls; second call's `afterExecute` event sees `source: 'middleware'`.

- [ ] **3.17 Integration test — composition with `softDelete`.** Register `softDelete` (TML-2306-style `beforeCompile` middleware) + `cacheMiddleware` + `telemetry`. First call: `runBeforeCompile` rewrites AST, `lower` produces SQL with the soft-delete predicate, cache stores. Second call: cache hit, driver skipped. Soft-deleted rows absent from cached results. Cache key differs from a query without `softDelete` registered (because the lowered SQL differs).

- [ ] **3.18 Integration test — composition with telemetry.** Telemetry observes `beforeExecute` on miss only. `afterExecute` fires in both cases with `source: 'driver'` then `source: 'middleware'`. `rowCount` and `latencyMs` populated correctly on both paths.

- [ ] **3.19 Concurrency regression test.** Two parallel `db.execute()` calls of the same annotated query. Each produces correct results. Both cache-miss paths populate the store (last-write-wins acceptable). Assert no crash, no cross-talk via `WeakMap` (each parallel call gets its own buffer, no rows leak between them). Pin the plan-identity invariant: assert that the two calls receive distinct frozen `SqlExecutionPlan` objects.

- [ ] **3.19a Cross-family unit tests — key resolution and Mongo parity.** In `middleware-cache/test/cache-key.test.ts`:
  - Default path: `ctx.contentHash(exec)` is invoked; the returned string is used as the cache key.
  - Per-query `cacheAnnotation({ key })` overrides `ctx.contentHash` (assert `contentHash` is not invoked when annotation `key` is supplied).
  - Mongo parity: with a mock `RuntimeMiddlewareContext` whose `contentHash` returns a Mongo-style string, the cache middleware works end-to-end against a non-SQL mock plan (no SQL fields present). Demonstrates the package is genuinely family-agnostic.
  - Two distinct `contentHash` returns produce two distinct cache entries.

- [ ] **3.20 Write package README.** `packages/3-extensions/middleware-cache/README.md`: opt-in behavior, cache key composition (note that keys are canonical strings, not hashes; explain why), `CacheStore` interface + pluggability, transaction-scope guard, TTL/LRU semantics, "not coherent across replicas" caveat for the default store, usage example matching the spec's "After" section, link to subsystem doc and ADR 204. Note that mutation rejection is structural (annotation applicability) and lives at the lane, not in the cache middleware.

### Close-out

- [ ] **C.1 Verify all acceptance criteria in `projects/middleware-intercept-and-cache/spec.md`.** Produce a PASS/PARTIAL/FAIL/NOT VERIFIED scoreboard in the close-out PR description (mirror Will's TML-2242 close-out format).

- [ ] **C.2 Update subsystem doc.** In `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`: new "Intercepting Execution" section after the existing `runWithMiddleware` description; document `intercept` hook semantics (placement, chain semantics, hit/miss paths, error path); update the `runWithMiddleware` lifecycle diagram to show the `intercept` step before `beforeExecute`; document `AfterExecuteResult.source`; add an "Annotations" subsection with the `defineAnnotation` example; document reserved namespaces; cross-link to the cache middleware README as the canonical interceptor example. Document the plan-identity invariant for `WeakMap`-correlated middleware.

- [ ] **C.3 Update TML-2143.** Post a comment on Linear summarizing what landed (intercept hook in `runWithMiddleware`, annotations, cache middleware) and restating May deferrals (full API redesign, `next()` composition, ordering metadata, invalidation beyond TTL, ORM option-bag annotations, Mongo cache).

- [ ] **C.4 Strip repo-wide references to `projects/middleware-intercept-and-cache/**`.** Replace with canonical `docs/` links or remove. *(After merge.)*

- [ ] **C.5 Delete `projects/middleware-intercept-and-cache/`.** *(After merge.)*

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `canonicalStringify` exists in `@internal/utils` | Unit | 1.0a | Stable across key order |
| `canonicalStringify` distinguishes BigInt from number | Unit | 1.0a | `1n` vs `1` produce different strings |
| `canonicalStringify` round-trips Date / Buffer / nested | Unit | 1.0a | Coverage of nontrivial types |
| `hashContent` exists in `@internal/utils` | Unit | 1.0a' | `sha512:HEX128` format (async, returns `Promise<string>`) |
| `hashContent` produces fixed-length output regardless of input | Unit | 1.0a' | 135 chars (`sha512:` + 128 hex) |
| `hashContent` is deterministic and discriminating | Unit | 1.0a' | Trailing chars + separator placement |
| `hashContent` output does not embed raw input (opacity) | Unit | 1.0a' | Sensitive-data isolation |
| `OperationKind = 'read' \| 'write'` exported | Type test | 1.7 | Binary kind for April |
| `defineAnnotation<P>()({namespace, applicableTo})` signature | Type test | 1.7 | Curried; `Payload` explicit, `Kinds` inferred from `applicableTo` via `const` |
| `Kinds` inferred narrowly (not widened to `OperationKind`) | Type test | 1.8 | `applicableTo: ['read']` ⇒ `Kinds = 'read'`, not `'read' \| 'write'` |
| `AnnotationHandle.applicableTo` is `ReadonlySet<Kinds>` | Unit | 1.7 | Frozen at construction |
| `ValidAnnotations<K, As>` resolves matching elements | Type test | 1.8 | Positive |
| `ValidAnnotations<K, As>` resolves mismatched elements to `never` | Type test | 1.8 | Negative both directions |
| `assertAnnotationsApplicable` throws on mismatch | Unit | 1.8 | `RUNTIME.ANNOTATION_INAPPLICABLE` |
| `assertAnnotationsApplicable` passes on match / empty | Unit | 1.8 | No-op cases |
| SQL DSL select builder accepts read annotations | Unit + Type | 2.3, 2.4 | `SelectQueryImpl.annotate(...)` |
| SQL DSL select builder rejects write annotations | Type test | 2.4 | Negative |
| SQL DSL mutation builders accept write annotations | Unit + Type | 2.3, 2.4 | Insert/Update/Delete |
| SQL DSL mutation builders reject read annotations | Type test | 2.4 | Negative |
| SQL DSL `'read' \| 'write'` annotation accepted everywhere | Type test | 2.4 | Positive |
| SQL DSL runtime check throws on cast-bypass | Unit | 2.3 | `RUNTIME.ANNOTATION_INAPPLICABLE` |
| ORM read terminals accept read annotations | Unit + Type | 2.8, 2.9 | `first`/`find`/`all`/`count`/aggregates |
| ORM read terminals reject write annotations | Type test | 2.9 | Negative per terminal |
| ORM write terminals accept write annotations | Unit + Type | 2.8, 2.9 | `create`/`update`/`delete`/`upsert` |
| ORM write terminals reject read annotations | Type test | 2.9 | Negative — including `cacheAnnotation` on `create` |
| ORM `Collection.annotate` does not exist | Type test | 2.9 | Chainable form removed |
| ORM runtime check throws on cast-bypass | Unit | 2.8 | Both directions |
| Annotation arg preserves terminal return types | Type test | 2.9 | `first` still `Row \| null` |
| `RuntimeMiddlewareContext.contentHash(exec)` exists, returns `Promise<string>` | Type test | 1.0 | Required field; async signature; existing fixtures updated |
| SQL `contentHash`: same `(sql, params, storageHash)` → same key | Unit | 1.0b | Stable canonicalization |
| SQL `contentHash`: differing params → differing keys | Unit | 1.0b | Discriminator |
| SQL `contentHash`: differing `storageHash` → differing keys | Unit | 1.0b | Schema-change invalidation |
| SQL `contentHash`: object-key order in params does not matter | Unit | 1.0b | Via shared `canonicalStringify` |
| Mongo `contentHash`: distinct commands → distinct keys | Unit | 1.0c | Family-owned impl |
| Mongo `contentHash`: equivalent commands with shuffled keys → same key | Unit | 1.0c | Via shared `canonicalStringify` |
| SQL `contentHash` returns `sha512:` digest (fixed-size, opaque) | Unit | 1.0b | Output matches `^sha512:[0-9a-f]{128}$`; opacity + size |
| Mongo `contentHash` returns `sha512:` digest (fixed-size, opaque) | Unit | 1.0c | Output matches `^sha512:[0-9a-f]{128}$`; opacity + size |
| Cache middleware uses `contentHash` output directly (no rehash) | Unit | 3.15 | `Map<string, …>` key is `contentHash` output as-is |
| Cache package does not import `node:crypto` | Smoke | 3.3 | `pnpm lint:deps` + grep; hashing is the family runtime's responsibility |
| `RuntimeMiddleware.intercept` exists with correct signature | Type test | 1.1 | Optional; row shape union; promise return; `TPlan`-narrowable |
| `InterceptResult` accepts iterable + array | Type test | 1.1 | Union verified by type fixtures |
| `AfterExecuteResult.source` is `'driver' \| 'middleware'` | Type test | 1.2 | Additive; observers unaffected |
| First `intercept` wins; subsequent skipped | Unit | 1.4 | Mock chain with two interceptors |
| Hit path skips `beforeExecute` / driver / `onRow` | Unit | 1.4 | Spies on each hook + `runDriver` factory not invoked |
| `afterExecute` fires with `source: 'middleware'` on hit | Unit | 1.4 | Assert field on observed event |
| Hit accepts iterable rows | Unit | 1.4 | `AsyncIterable` source |
| Hit accepts array rows | Unit | 1.4 | Array source |
| Miss path = zero-change behavior | Regression | 1.4 | Existing fixtures pass with `source: 'driver'` |
| Interceptor throw → `runtimeError`, `completed: false` | Unit | 1.4 | Error envelope assertion + swallow semantics |
| Mixed chain: A passthrough, B intercepts → only B's intercept | Unit | 1.4 | A's `beforeExecute` not called (it was a hit) |
| Intercepted rows go through codec decoding | Integration | 1.5 | Raw → decoded row assertion via SQL runtime |
| Mongo runtime observes `intercept` via inherited helper | Integration | 1.6 | Cross-family proof extension |
| `defineAnnotation<P, Kinds>` preserves `P` across call signature and read | Type test | 1.8 | Negative test for wrong payload |
| Handle is callable; no `.apply` method on the handle | Unit + Type | 1.8 | `typeof handle === 'function'`; `handle({...})` is the sole construction path |
| Different namespaces do not interfere | Unit | 1.8 | Two handles, disjoint reads |
| `read` ignores cross-handle namespace match | Unit | 1.8 | Brand check |
| SQL DSL `.annotate()` merges into `meta.annotations` (read + write) | Unit | 2.3 | All five builder kinds |
| SQL DSL last-write-wins on duplicate namespace | Unit | 2.3 | Two applies of same handle |
| SQL DSL `.annotate()` does not affect `plan.ast` | Unit | 2.3 | Snapshot diff |
| SQL DSL `.annotate()` chainable in any position | Unit + Type | 2.3, 2.4 | Before/after `from`/`select`/`where` |
| ORM annotation survives terminal call → plan | Integration | 2.8 | Assert `meta.annotations[ns]` |
| ORM annotated read terminal returns same plan shape | Type test | 2.9 | `Row` unchanged |
| Un-annotated query never cached | Unit | 3.12 | Store never called |
| `skip: true` → not cached | Unit | 3.12 | Store never called |
| Missing `ttl` → not cached | Unit | 3.12 | Store never called |
| Mutation rejected at lane (annotation gate) | Type + Unit | 2.4, 2.9, 2.3, 2.8 | No in-middleware classifier |
| Connection-scope bypasses cache | Unit | 3.14 | `ctx.scope === 'connection'` |
| Transaction-scope bypasses cache | Unit | 3.14 | `ctx.scope === 'transaction'` |
| LRU eviction at `maxEntries` | Unit | 3.13 | Injectable store config |
| TTL expiry evicts | Unit | 3.13 | Injected clock |
| `store.set` only on `completed: true && source === 'driver'` | Unit | 3.13 | Inject driver error mid-stream |
| Different `storageHash` → different keys (end-to-end) | Unit | 3.15 | Two contracts, same SQL |
| User-supplied annotation `key` short-circuits `contentHash` | Unit | 3.15, 3.19a | Custom key wins |
| Default path invokes `ctx.contentHash(exec)` | Unit | 3.19a | Spy on context method |
| Mongo-style mock plan + Mongo `contentHash` → end-to-end cache | Unit | 3.19a | Family-agnostic proof |
| Distinct `contentHash` returns produce distinct cache entries | Unit | 3.19a | Discriminator |
| Cache package has no SQL/Mongo runtime dep | Smoke | 3.3 | `pnpm lint:deps` after impl |
| **Stop condition**: second call skips driver | Integration | 3.16 | Driver invocation count + `source` |
| Cache composes with `softDelete` | Integration | 3.17 | Rewritten SQL in cache key; soft-deleted rows absent |
| Cache composes with telemetry | Integration | 3.18 | `beforeExecute` miss-only; `source` correct on both |
| Concurrent execution: no cross-talk | Regression | 3.19 | Two parallel executes; plan-identity pinned |
| `pnpm lint:deps` clean for new package | Smoke | 3.3 | Run after scaffold, before implementation |

## Open Items

- **Transaction-scope signaling (spec OQ 2)** — Resolve in 3.1 before any cache-middleware code lands. Lean (a): `scope` on `RuntimeMiddlewareContext`. If 3.1 surfaces wider implications (e.g. existing `budgets`/`lints` would behave differently in transactions), step back and reconsider whether telemetry-in-transaction silence (option b) is acceptable as a bounded loss.
- **Mutation classification signal (spec OQ 1)** — Resolved by the applicability gate at the lane (M2). No in-middleware classifier; spec OQ 1 is closed.
- **ORM terminal enumeration (spec OQ 9)** — Enumerate at 2.5/2.6 implementation time. If `orm-consolidation` reshapes terminals, rebase mechanically.
- **Per-builder vs. shared `.annotate()` typing in SQL DSL** — Per builder (M2.1, M2.2). Shared on `BuilderBase` was considered and rejected because it could not narrow the kind constraint. Two near-identical implementations is acceptable; a future helper can fold the pattern if duplication grows.
- **`As & ValidAnnotations<K, As>` intersection is load-bearing on lane terminals (discovered in M1.8).** TypeScript's variadic-tuple inference is too forgiving when the parameter type refers to `As` only through `ValidAnnotations`: it picks an `As` that makes the call valid even when the gated tuple would contain `never` for an inapplicable element. The intersection pins `As` to the actual call-site tuple AND requires assignability to the gated form, so a `never` element collapses the corresponding intersection position to `never` and the inapplicable argument fails to assign. M2 lane terminals (SQL DSL `.annotate()` on each builder kind, ORM terminals) must use the intersection pattern; the type-d tests in M1.8 demonstrate the difference. Documented on the `ValidAnnotations` TSDoc as the canonical call shape.
- **Cache key hashing perf (spec OQ 5)** — Resolved: hash via SHA-512 (WebCrypto `crypto.subtle.digest`). Earlier analysis (per prior Prisma query-plan caching work) suggested skipping hashing because V8's internal string-interning Map performance dominates any user-space hash. That analysis applies to **parametric** plan caching with small structural fingerprints — it does not generalize to **per-execution** content hashes that embed concrete parameter values. Two failure modes drove the reversal: memory (10 MB JSON params → 10 MB key, scaling to gigabytes at `maxEntries=1000`) and sensitive-data isolation (parameter values flowing into debug logs, Redis `KEYS`, persistence dumps, user-supplied `CacheStore` implementations). SHA-512 via WebCrypto chosen because `crypto.subtle.digest` is built into Node and the browser (no native dependency); 512-bit output for collision headroom at negligible incremental cost over 256-bit. The function is async by design, which is why `contentHash` returns `Promise<string>`. `canonicalStringify` (1.0a) and `hashContent` (1.0a') both live in `@internal/utils` so SQL and Mongo runtimes share a single source of truth. Output format: `sha512:HEX128` (literal `sha512:` prefix + 128 lowercase hex chars, 135 chars fixed).
- **Family scope of cache middleware (spec OQ 6)** — Resolved: cross-family `RuntimeMiddleware`. Cache keys come from `ctx.contentHash(exec)`, populated by the family runtime. The cache package depends only on `framework-components/runtime`. Mongo gets first-class support day one because `MongoRuntimeImpl` populates `contentHash` alongside SQL.
- **`contentHash` design surface** — Returns a `Promise<string>` (not a structured `{statement, params}` shape, not batched). The async return type is forced by `crypto.subtle.digest`; callers `await` the result. Future content-hash-keyed middleware (request coalescing, single-flight) consume the same string. If a structured shape becomes necessary, evolving the SPI is additive.
- **Plan memoization (ADR 025) future compat** — Plan-identity invariant documented in subsystem doc (C.2) and pinned by 3.19. No code changes required now; reviewers will see 3.19 break if memoization ever ships and re-uses the post-lowering plan object.
- **Rebase cadence** — Rebase on Will's branch as he pushes review touch-ups; rebase on `main` once #381 lands. Architectural deviation from #381 is unlikely; if Will's later commits move public surface (e.g. the export layout in `framework-components/src/exports/runtime.ts`), update import paths mechanically.