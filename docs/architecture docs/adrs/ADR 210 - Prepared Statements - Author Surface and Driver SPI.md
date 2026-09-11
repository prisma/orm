# ADR 210 — Prepared Statements: Author Surface and Driver SPI

> **Update — the prepared handle is one of two shapes, per [ADR 247](<./ADR 247 - Whole-query raw SQL is the fragment mechanism at statement position.md>):** `prepare()` reads the plan's declared result. A rows plan returns the `PreparedStatement<Params, Row>` this ADR describes, consumed with `.query(target, params)`. A plan declaring an affected-row count returns a `PreparedExecution<Params>`, consumed with `.execute(target, params)` and resolving `SqlStatementStats`. The declaration, the bind-site callback, the lower-once contract, and the internal bridge below hold for both. So does the request record the driver receives — the same lowered SQL, encoded params, and opaque `preparedStatementHandle` slot, with the driver still never seeing the `PreparedStatement` object. What differs is the method that request goes to: the "Driver SPI" section below describes rows going to `SqlQueryable.query()`, and the statistics face goes to `SqlQueryable.execute()` instead, which resolves `SqlStatementStats` rather than streaming rows.

## Status

Accepted. May 5, 2026.

## Overview

Executing a SQL DSL query end to end has three costs: lowering the relational AST to dialect SQL, encoding parameters for the wire, and the server parsing and planning the SQL. The first two are pure work in the framework; the third lives on the database. All three repeat on every ad-hoc query call against the same query — a tight loop running the same lookup ten thousand times pays each one ten thousand times.

Two of those costs are amortizable. Lowering depends only on the AST, so the result can be cached. Most SQL servers can keep a parsed plan keyed by a name in the connection's session and reuse it on subsequent executions; the client sends `EXECUTE` once the plan is registered, skipping the parse.

The SQL DSL exposes one primitive that opts into both kinds of reuse: a *prepared statement*. The user calls `db.prepare(declaration, callback)` once and gets back a `PreparedStatement<Params, Row>` object. The runtime invokes the callback to obtain a plan, runs the `beforeCompile` middleware chain on it, lowers the result once, and freezes the lowered SQL onto the object. On the first `.query()` against a connection, the driver allocates whatever per-target handle it needs — a name, a statement reference, an integer, anything — and stores it back on the `PreparedStatement` through a slot wrapper. Subsequent queries reuse the lowered SQL and the handle until the connection ends.

The primitive lives on the runtime: the underlying call is `runtime.prepare(declaration, callback)`. It lives there because the `beforeCompile` middleware chain is owned and invoked by the runtime, and `prepare` has to run that chain so AST rewrites are baked into the lowered SQL. Each DB-specific facade (the Postgres client, the SQLite client, etc.) re-exposes `prepare(declaration, callback)` as a top-level convenience method that delegates to the runtime. The `db` proxy returned by `sql({ context })` itself is unchanged — it still maps top-level keys to user-defined tables and exposes nothing else.

There is no global cache. The lowered SQL lives on the user's `PreparedStatement` reference; the per-connection server-side state lives on the connection. When either ends, that state ends with it.

This ADR is family-level: it pins the author surface, the driver SPI shape, the lifetime model, and the retry contract. Per-driver caching strategies and per-driver staleness detection live in the drivers, not here.

## Grounding example

```ts
const ps = await runtime.prepare(
  { userId: 'pg/int4@1' },
  (params) =>
    db.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.id, params.userId))
      .build(),
);

await ps.query(runtime, { userId: 124 });
await ps.query(runtime, { userId: 125 });

await withTransaction(runtime, async (tx) => {
  await ps.query(tx, { userId: 126 });
});
```

A few things to notice:

- **`runtime.prepare(...)` is the underlying primitive.** Each DB-specific facade re-exposes it as a top-level convenience (`db.prepare(...)` on facades that surface one). SQL-plan callbacks return the same SQL handle. Postgres and SQLite facades additionally accept ORM row descriptions and compose their complete terminal results without teaching runtime about ORM.
- **The first argument declares the parameter shape.** Names mapped to codec ids drawn from the codec registry. The editor autocompletes the codec id strings; the type system rejects unknown ones.
- **The callback receives a `params` object whose values are bind-site references.** It is the *only* callback argument; the DSL root (`db`) is captured from the enclosing scope. `params.userId` flowing into `fns.eq(f.id, …)` slots in like any other expression — the type at that position is the same arm of `CodecExpression` that the DSL accepts wherever a literal would normally go (`eq`, `update`, `where` predicates, and so on). Slot reuse is implicit by reference equality: referring to `params.userId` twice is one slot used twice.
- **`.query(target, params, options?)` is typed end to end.** `Params` comes from the declaration via each codec's `TInput` mapping; `Row` comes from the plan returned by the callback.
- **The execution scope is always explicit.** The first argument is a `RuntimeQueryable` — the top-level runtime, an explicit connection, or an active transaction (or its `TransactionContext`). The same `PreparedStatement` redirects between them without re-preparation; there is no implicit binding back to the runtime that produced it.
- **The first query allocates a server-side handle; the second reuses it.** Subsequent queries against the same connection skip both lowering and parsing.

Without `prepare`, an ad-hoc `db.user.select(...).where(...).all()` (or `.build()` + `runtime.query(plan)`) runs as before: lowered every time, parsed by the server every time, and the framework keeps no state about it.

## Design principles

1. **Reuse is opt-in and explicit.** Two `prepare` calls with identical SQL produce two independent `PreparedStatement` handles. The framework does not deduplicate, does not maintain a global shape-keyed cache, and does not infer reuse from call patterns. Users hold the reference; users decide when to reuse.

2. **Cache lifetime equals the user's reference, bounded by connection lifetime.** The lowered SQL lives on the `PreparedStatement` object — when it goes out of scope, so does the cache. Server-side prepared-plan state lives on the connection — when the connection ends, the plan ends with it. There is no dispose path, because there is nothing for one to do beyond what these two natural boundaries already do.

3. **The runtime treats the handle as opaque.** The runtime has no concept of the handle's shape. It hands the driver a getter/setter slot and the driver fills it. This keeps the runtime agnostic to per-target preparation primitives, which differ widely across SQL dialects.

4. **The framework pins the retry contract; the driver picks the trigger.** When a cached plan goes stale on the server, the framework guarantees the user-visible behaviour: clear the slot, allocate a fresh handle, retry the query exactly once, surface a stable error if the retry fails. *When* to do that — what signal counts as staleness — is per-target. The contract is symmetric across drivers; the trigger is asymmetric.

The rest of the document elaborates each principle.

## Author surface

### Where `prepare` lives

The primitive is `runtime.prepare(declaration, callback)`. It lives on the runtime because that is where the `beforeCompile` middleware chain is owned and run. `prepare` has to invoke that chain so any AST rewrites a middleware applies are baked into the lowered SQL — placing `prepare` anywhere else would mean either splitting the middleware chain across two homes or punting middleware work into the I/O path on the first query.

Postgres and SQLite facades expose `prepare(declaration, params => ...)`, capturing `db.sql` or `db.orm` lexically. SQL-plan callbacks delegate to runtime and retain `PreparedFor` row/statistics semantics. ORM callbacks return a synchronous `.prepared.all()` or `.prepared.first()` description. The facade invokes the callback once, passes only its SQL plan to runtime for one lowering, and composes the prepared statement with the ORM-owned consumer. Runtime continues accepting SQL plans only.

The ORM handle's `query(target, params, options?)` returns the complete terminal result directly: a thenable async row stream for `all`, or a row-or-null promise for `first`. An async wrapper around `query` would assimilate the thenable and erase streaming, so only preparation itself is async. Each invocation owns its result-processing state and uses the explicit compatible runtime, connection or transaction, never the authoring collection's runtime.

The `db` proxy returned by `sql({ context })` is unchanged. It still maps top-level keys to user-defined tables and exposes nothing else; there is no `db.prepare` on the proxy itself. Anchoring `prepare` to the facade rather than the proxy keeps the proxy's namespace pristine for user-defined names.

### `prepare(declaration, callback)`

`declaration` is a name-keyed object whose values are codec-id strings drawn from the codec registry. The long form `{ codecId, nullable: true }` is used when nullability differs from the default. The codec-id position is statically typed against the registry, so the editor autocompletes it and unknown ids fail to compile.

`Params` for `.query(target, params)` is derived by looking each declared entry's codec up in the registry and using its `TInput` mapping, threading nullability through.

The callback receives `(params)` — a single argument. The DSL root (`db`) is captured from the enclosing scope rather than passed in, so the callback's only obligation is to turn declared params into a plan. Each `params.<name>` is a bind-site reference whose static type is `Expression<{ codecId; nullable }>` — the same arm of `CodecExpression` that the DSL accepts wherever a literal would go. Slot reuse is implicit by reference equality: if the callback refers to `params.userId` twice, that's one slot used twice. Literals not threaded through `params` get baked into the lowered SQL at lower time.

A SQL-builder callback ends with `.build()`, returning a plan; raw SQL callbacks also return plans. `Row` is derived from that plan's row type. An ORM facade callback ends with `.prepared.all()` or `.prepared.first()`, returning a description rather than executing an ordinary terminal. ORM predicates preserve non-nullable scalar placeholders in shorthand, callback, relation/include and terminal filters, including fixed lists of individual operands. Structured ORM comparisons reject nullable prepared references before execution, using declaration nullability retained on the frozen `PreparedParamRef` AST node. Shared ORM predicate binding enforces this boundary for nested expressions and structured interoperability inputs, without changing SQL-builder equality. Raw SQL remains opaque, including interpolation payloads: it is neither rewritten nor rejected based on nullable parameters. Literal-null ORM filters retain their null checks. Root and nested ORM pagination accepts SQL's existing non-nullable numeric expression operands, including distinct and scalar/combine include refinements. First-row terminals replace any earlier limit with `1`, retaining unused-declaration validation for overwritten placeholders. ORM aggregate/mutation preparation and dynamic parameter lists are not part of this row-terminal surface.

If a name in `declaration` isn't referenced by the callback's plan, `prepare` throws a stable error code under the `RUNTIME` namespace. (Type-level detection of unused declared params isn't achievable across the chained-builder type machinery; runtime detection is the contract.)

### `.query(target, params, options?)` takes an explicit target

`PreparedStatement.query(target, params, options?)` always names its execution scope. `target` is a `RuntimeQueryable` — the top-level `Runtime`, an explicit `RuntimeConnection`, or a `RuntimeTransaction` / `TransactionContext`. There is no default and no implicit binding back to the runtime that produced the statement.

`RuntimeQueryable` exposes the normal `query(plan)` and `execute(plan)` operations. Prepared execution uses a package-internal bridge installed on each scope; the public `PreparedStatement` invokes that bridge, and the scope routes it to its bound `SqlQueryable`. The bridge is not part of the consumer-facing `RuntimeQueryable` API.

This makes the same `PreparedStatement` reusable across scopes: prepare once at startup, and then run it against the runtime for one request, against an active transaction for another. Inside a transaction, `ps.query(tx, params)` routes through the transaction's connection — a write earlier in the transaction is visible to the prepared lookup, and a rollback discards both. After the transaction ends, the same statement runs unchanged against the runtime.

The alternative — letting `.query(params)` default to "the runtime that built me" — was rejected. It silently couples prepared statements to a specific scope, makes the transaction case ambiguous (does an outer-prepared statement see the tx's state?), and forces an awkward second API to redirect when the answer is "no". An explicit first argument carries no ambiguity and keeps the prepared statement object scope-free.

### Why `prepare` is async with no driver I/O

`prepare` performs no driver I/O. Internally it invokes the callback, awaits the async `beforeCompile` middleware chain on the resulting plan's AST so AST rewrites are baked into the lowered SQL, calls the adapter's `lower()`, and freezes the lowered SQL plus the parameter slot order onto the `PreparedStatement`. The handle slot starts unset.

The async return reflects an existing constraint, not a new one. `beforeCompile` is async-typed across the rest of the system. A sync `prepare` would force one of two compromises: split the chain into sync and async variants (inflating the hook surface), or defer the chain to the first query (defeating the "no I/O at prepare time" property by pushing middleware work into the I/O path). Returning `Promise<PreparedStatement<Params, Row>>` keeps the chain intact and costs one `await` at call sites. Driver I/O still happens only on `.query()`.

### Capability gating

`prepare` is available on every SQL target with no contract capability flag. Lowering reuse is universal — every adapter's `lower()` is pure work that can be cached. The server-side reuse benefit is opportunistic: the driver may or may not deliver it, and may be told not to via the per-driver opt-out described below. Gating `prepare` on a capability would force users to inspect the contract before deciding whether to call a method whose API is identical regardless. The call is exposed unconditionally; the driver decides what to do underneath.

## Driver SPI

> **Superseded in part** — "prepared statements are row queries" holds only for the rows face; a plan declaring an affected-row count prepares into a `PreparedExecution` that goes to `SqlQueryable.execute()`. See the update note above.

`SqlQueryable.query()` streams rows; `SqlQueryable.execute()` returns statement statistics. Prepared statements are row queries, so prepared execution uses `query()`. A prepared request carries the lowered SQL, encoded parameters, and an opaque handle slot:

```ts
interface PreparedStatementHandle {
  get(): unknown;
  set(value: unknown): void;
}

interface SqlExecuteRequest {
  readonly sql: string;
  readonly params?: readonly unknown[];
  readonly preparedStatementHandle?: PreparedStatementHandle;
}

interface SqlQueryable {
  query<Row>(request: SqlExecuteRequest): AsyncIterable<Row>;
  execute(request: SqlExecuteRequest): Promise<{ affectedRows: number }>;
}
```

The driver receives the lowered SQL, encoded params, and a slot wrapper — never the `PreparedStatement` object. The runtime constructs the slot wrapper around the `PreparedStatement`'s handle field; reads and writes flow through that single field on the user's object.

### Lazy handle allocation

The slot starts unset. On each call, the driver decides whether to allocate. The expected pattern is: read `req.preparedStatementHandle.get()`; if undefined, mint a handle of the driver's choosing and call `req.preparedStatementHandle.set(handle)`; thereafter, reuse the handle on calls against connections where the underlying server-side prepared plan is still valid.

Handle shape is the driver's choice and opaque to the runtime. The runtime never branches on the handle's shape, never logs it, and never compares two handles for equality. Allocation MUST be cheap and synchronous — the call sits inside an async-iterable query path, and the framework guarantees no I/O cost for handle allocation itself. Beyond that, the driver is free.

### Why a slot wrapper

Pinning the driver's contact surface to a three-field record keeps the SPI minimal. Drivers cannot reach into the `PreparedStatement` to inspect declarations, ASTs, or middleware state, even by accident. The runtime owns the rest of the object and can evolve it (additional middleware metadata, debug fields) without touching the driver SPI.

The slot pattern also covers the case where a driver does not implement server-side reuse. Such a driver returns correct results without ever touching the slot and performs a one-shot parameterized query. The request shape is the same; only the driver behavior changes. The same path serves the explicit opt-out described later.

## Lifetime and memory

The `PreparedStatement` carries the lowered SQL text and (lazily) one opaque handle — nothing else. No parameter values, no row data. Server-side state lives on the connection; reusing a `PreparedStatement` across two connections gives each connection its own server-side entry, allocated on its first query against that connection.

A `PreparedStatement` reused across two connections may end up with handles that are byte-identical or distinct, depending on what the driver finds convenient. The runtime makes no claims either way; consumers MUST NOT depend on either property.

Memory upper bound is roughly *(distinct PreparedStatements) × (live connections that have queried each)*, sized in low kilobytes per pair. Long-lived connections holding many `PreparedStatement` references will accumulate prepared-plan memory until the connection recycles. The cleanup mechanism is connection recycling; the system has no other dispose path (see [design principle #2](#design-principles)).

## Stale-handle retry

Server-side prepared plans outlive any single `.query()` call. A schema migration can change a column type, an administrator can reset the session, or a connection-internal eviction can drop the plan — any of which leaves the cached plan out of sync with the server's view.

The framework guarantees one retry path:

- The driver detects the staleness signal — its mechanism, its detection sensitivity.
- On detection, the driver clears the slot and allocates a fresh handle (calls `req.preparedStatementHandle.set(newHandle)` with a new value).
- The driver retries the query exactly once.
- On retry success, the user observes one `.query()` call that succeeded.
- On retry failure, the driver surfaces `DRIVER.PREPARE_FAILED`, preserving the originating error as `cause`. The error envelope is defined by [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md), which reserves `DRIVER.PREPARE_FAILED` for exactly this surface.

Detection sensitivity is a per-driver tradeoff. Some targets surface a clean signal that says "this prepared plan is gone"; the driver retries narrowly. Others have no such signal; the driver may treat any error originating from a cached query as a candidate for re-prepare. In the second case the false-positive cost is one extra preparation, paid only on otherwise-failing queries — the bound is small and self-correcting. The framework neither prefers nor mandates either policy; it pins the contract (clear, allocate, retry once, surface) and leaves the trigger to the driver (see [design principle #4](#design-principles)).

The runtime never re-lowers on retry. The lowered SQL on the `PreparedStatement` is invariant for the lifetime of the statement; only the handle changes.

## Reuse opt-out: `preparedStatements: boolean`

Some deployment topologies cannot rely on server-side prepared-plan persistence. The most common case is a connection multiplexer or pooling proxy that may switch the underlying physical connection between calls — a plan registered on one physical connection isn't visible on the next, and the cached handle silently breaks. Whether server-side reuse is safe is a topology question, not a target-version question, so neither the contract nor the driver tries to auto-detect it.

The supported escape hatch is an explicit driver option: `preparedStatements: boolean`, default `true`. When `false`, prepared `query()` runs a one-shot parameterized query and leaves the handle slot unset. The lowered SQL on the `PreparedStatement` is still reused — that is the universal half of the benefit, independent of server-side preparation. Users keep the lowering reuse and lose the parse-skip; the tradeoff is explicit.

The driver does not auto-detect topology. Auto-detection is unreliable (greeting strings vary, transparent proxies exist) and shifts a correctness decision from configuration to heuristics. Users opt out explicitly and own the decision.

## Middleware

All five SQL middleware hooks fire on the prepared path; `beforeCompile` fires earlier than the per-query hooks:

- `beforeCompile` runs **once at `prepare` time**. AST rewrites change the lowered SQL, so they have to be baked in before the SQL is frozen on the `PreparedStatement`. Re-running per query would defeat the cache — every query would have to re-lower.
- `beforeQuery`, `interceptQuery`, `onRow`, and `afterQuery` run **per `.query()` call**. They observe params and rows, which differ per query, and never see the lowered SQL changing.

Ad-hoc `query()` is unchanged: the query hooks run as today. The single asymmetry — `beforeCompile` running at prepare time versus query time — is the irreducible consequence of caching the lowered SQL.

## Non-goals

The following are deliberate exclusions, not omissions:

- **Global shape cache.** Two `prepare` calls with identical SQL produce two handles. Deduplication is the user's responsibility — they hold the reference, they decide whether to reuse it. A global cache would invert ownership and force lifetime decisions onto the framework (see [design principle #1](#design-principles)).
- **Cross-process or persistent caches.** All state is in-process and tied to live connections.
- **Cross-adapter reuse.** A `PreparedStatement` retains SQL lowered by the authoring adapter and decoding context from preparation. Each invocation must name an explicit runtime, connection or transaction compatible with that SQL, contract and codec context; it does not implicitly execute on the producing runtime or support arbitrary cross-adapter reuse. The surface is SQL-only; non-SQL families do not have a `prepare` semantic.
- **Explicit dispose.** No `.dispose()` method. The leak is bounded and self-heals on connection recycle. A dispose method would require tracking which connections have seen which handles, which is the cache the system explicitly avoids.
- **Pre-warming server-side preparation at pool init.** The first `.query()` per connection pays the preparation cost. Pre-warming would require the framework to know the full set of `PreparedStatement`s ahead of time; the user-owned-handle model puts that knowledge on the user.
- **Observability surface for prepared-statement execution.** Tracing, metrics, counters, structured logs — drivers may add their own; the framework does not standardise one.
- **List/array parameter slots.** The codec registry has no list codecs; `prepare` accepts only scalar slots. The design accommodates list codecs without further changes — adding a list codec extends `prepare` to array-typed slots automatically.

## Alternatives considered

**A. Implicit / shape-keyed global cache.** Lowering happens automatically the first time a given AST is queried; subsequent identical ASTs reuse the lowered SQL. Rejected. Cache invalidation becomes a framework problem (how big? what eviction policy? what about middleware that mutates the AST per call?), and the win is opaque to users — they cannot tell whether a given call is hot or cold without instrumentation. The user-owned handle keeps lifetime where it can be reasoned about: at the call site.

**B. `prepare` returns synchronously.** Considered. Would require either splitting `beforeCompile` into sync and async variants or running middleware lazily on the first query. The first inflates the hook surface; the second defeats the "no I/O at prepare time" property by deferring middleware work into the I/O path. Async return matches the existing chain and costs one `await`.

**C. Driver receives the `PreparedStatement` directly.** Rejected. Pins the driver's contact surface to the entire object, which carries declarations, callback closure references, AST metadata, and middleware state. The slot-wrapper SPI keeps the surface to three fields and lets the runtime evolve the rest of the object freely. It also means a driver that does not implement server-side reuse can route through the same SPI by ignoring the slot — the same shape that the `preparedStatements: false` opt-out produces.

**D. Auto-detect topologies that do not support server-side reuse.** Rejected. Detection is unreliable across deployment topologies. Misdetecting in either direction is worse than asking users to flip a flag once: a false positive disables a real optimisation; a false negative causes runtime errors deep inside hot loops. The explicit option puts the decision where the deployment topology is known.

**E. Allocate the driver handle at `prepare` time.** Rejected. Forces driver I/O into a method whose contract is "no I/O", and mints handles for connections the statement may never reach. Lazy allocation on the first query matches the lifetime of the underlying server-side state and keeps `prepare` cheap, I/O-free, and idempotent.

**F. Mandate a single stale-detection policy across drivers.** Rejected. The detection signal is target-specific; the framework's job is to pin the contract (clear, allocate, retry once, surface), not to legislate a detection mechanism a target may not be able to provide. Symmetric policy at the contract level, asymmetric policy at the trigger level (see [design principle #4](#design-principles)).

## References

- [ADR 016 — Adapter SPI for Lowering](./ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) defines the adapter SPI used by prepared queries. Lowering runs once at `prepare` time and is bypassed on the prepared query path.
- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md) defines the `DRIVER.PREPARE_FAILED` envelope returned when stale-handle retry fails.
- [ADR 205 — SQL cast emission is adapter policy](./ADR%20205%20-%20SQL%20cast%20emission%20is%20adapter%20policy.md) describes when adapters emit explicit type casts on parameter sites. A cached prepared plan keeps parameter types stable across queries, so unconditional casts are not required for correctness on the prepared path.
