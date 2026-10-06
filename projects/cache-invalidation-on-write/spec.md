# Cache invalidation on write — spec

Linear: [TML-3399](https://linear.app/prisma-company/issue/TML-3399) (slice 1, `afterTransaction`), [TML-3400](https://linear.app/prisma-company/issue/TML-3400) (slice 2, `invalidateAnnotation`, blocked by slice 1). Design of the cache middleware itself: [ADR 266](../../docs/architecture%20docs/adrs/ADR%20266%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md).

## At a glance

```ts
// Today: the application invalidates after the write has returned.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ keys: ['user-1'] });

// After this project: the write carries its invalidation, which runs once the write's transaction has committed.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (m) =>
  m.annotate(invalidateAnnotation({ keys: ['user-1'] })),
);
```

## Purpose

This is the second half of the cache work. The first half shipped the cache middleware's primitives, including `cache.invalidate({ keys, meta })`, which the application calls after a write has returned. This project lets a write carry its own invalidation.

That needs a point in a query's lifecycle where the query's effects are final, which the runtime does not have yet. Slice 1 adds it as a new middleware stage, `afterTransaction`. Slice 2 builds the write annotation on it.

The write annotation belongs in `@internal/middleware-cache` even though ADR 266 keeps policy out of core. It decides nothing about what to invalidate. The annotation names its own target, which reaches the same `invalidate` call as the manual form. What the package adds is the timing: the middleware already holds the store, so it is the one place that calls `invalidate` once the write is final, instead of every extension doing it again.

## Why the write annotation waits for slice 1

ORM writes that return rows fire `afterQuery`; count-style writes fire `afterExecute`. Both fire per statement, before any enclosing transaction commits. If the cache invalidated there:

1. The write's transaction updates user 1, and the hook removes the cached entry.
2. The transaction has not committed. A concurrent request reads user 1, misses, reads the old committed row, and stores it.
3. The transaction commits. The cache holds the old row until it expires.

This is the default path, not an edge case. These ORM mutations run in a transaction of their own (`withMutationScope` in [`mutation-executor.ts`](../../packages/3-extensions/sql-orm-client/src/mutation-executor.ts)): single-row `update()` and `delete()`, nested creates and updates, a `create()` on a multi-table-inheritance variant, and a `delete()` with includes. A plain `create()` does not, and neither does `upsert`. The correct moment to invalidate is after the commit.

## Slice 1: the `afterTransaction` stage (TML-3399)

The decision itself, with its reasoning, prior art and the alternatives that were rejected, is written up in [ADR 260](../../docs/architecture%20docs/adrs/ADR%20260%20-%20Every%20query%20has%20an%20afterTransaction%20stage%20that%20fires%20when%20its%20enclosing%20transaction%20ends.md). This section holds the implementation detail the slice needs.

### Surface

The query lifecycle gains one more stage: the point where the query's effects are final. In [`runtime-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/runtime-middleware.ts):

```ts
export interface AfterTransactionResult {
  readonly outcome: 'committed' | 'rolled-back' | 'unknown';
}

export interface RuntimeMiddleware<TPlan, TMutator> {
  // ...existing hooks
  afterTransaction?(
    plan: TPlan,
    result: AfterTransactionResult,
    ctx: RuntimeMiddlewareContext,
  ): Promise<void>;
}
```

Read it as "the transaction enclosing this query has ended, with this outcome". The hook receives the same plan and the same context, with the same `planExecutionId`, as the query's other hooks. It is declared on the cross-family `RuntimeMiddleware`, so SQL and Mongo middleware both accept it.

### When it fires

Every query whose before-hooks and parameter encoding succeeded gets exactly one `afterTransaction`, and it is the query's last hook, inside or outside a transaction. The one exception: when a transaction ends while one of its queries is still running, that query's stage fires at the end, before its after-hook, with the transaction's outcome, which may not be the query's. The query may reach the database after the `COMMIT` or `ROLLBACK` and run outside the transaction, and its own failure is not counted.

Outside a transaction, the runtime fires it when the query ends. It fires `committed` when the query completed, right after `afterQuery` or `afterExecute`. It fires `unknown` when the query did not complete: the driver or a hook failed, the signal aborted between rows, a row failed to decode, or the caller stopped reading the rows. A statement that errors on the response path may already have applied, the same reasoning as a rejected commit. `RuntimeCore` delivers the stage this way with `reportQueryEnding` and `reportExecuteEnding` ([`run-with-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/run-with-middleware.ts)), and the SQL and Mongo runtimes call the same helpers. The helpers report how the query ended (`completed`, `failed` or `stopped`), and `onQueryEndOutsideTransaction` turns that into the outcome.

Inside a transaction, the SQL runtime's `wrapTransaction` ([`sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts)) remembers every plan executed on the transaction, with its context, from when `BEGIN` resolves until `commit()` or `rollback()` is called. A query sent on the transaction's connection in that time runs inside the transaction, because a driver transaction runs on its connection's session (see `SqlConnection.beginTransaction`), so it is remembered too. A query sent on the connection while `transaction()` is still pending is treated as outside the transaction, although on Postgres it may run inside it. Every transaction the runtime hands out goes through it, including a Supabase role session's. When the transaction ends, it fires the stage once for each plan, in execution order:

| What happened | Outcome |
|---|---|
| `commit()` resolves and no query on the transaction failed | `committed` |
| `commit()` resolves after a query on the transaction failed | `unknown` |
| `rollback()` resolves, no commit attempted | `rolled-back` |
| `rollback()` rejects, no commit attempted | `rolled-back` |
| `commit()` rejects | `unknown` |
| `rollback()` settles while `commit()` is pending | `unknown` |

- A query failed when an error came out of it: the driver or a hook threw, a row failed to decode, or the signal aborted. The runtime does not tell server errors from client errors, so it counts every such error as a failure that may have aborted the transaction. Postgres answers `COMMIT` on a transaction that a failed statement aborted with a rollback, and the driver's `commit()` still resolves; other databases keep the transaction. `unknown` is the answer that holds on every database. A caller that stops reading a row stream, with `break`, `return()` or `throw()`, raises no error from the query and does not abort the transaction, so a commit after it fires `committed`. The transaction learns how each query ended from the same helpers that deliver the stage outside a transaction.
- `unknown` fires for every rejected `commit()`, whether or not the `rollback()` that follows succeeds. A `COMMIT` that errors may already have landed, for example when it fails on the response path. A cleanup `ROLLBACK` that succeeds proves nothing about it.
- A rejected `rollback()` with no commit attempted fires `rolled-back`, because no `COMMIT` was sent, so no write that ran inside the transaction can have landed. A query still running when the transaction ends is the exception above.
- A `rollback()` after a rejected `commit()` fires nothing more. Both `withTransaction` and the ORM's `runInTransaction` call `rollback()` after a rejected `commit()`.
- The stage fires exactly once per plan per transaction.
- `commit()` and `rollback()` resolve only after the hooks have run. A write that has returned has already had its stage run.
- The stage fires after `commit()` or `rollback()` settles and before the connection is released. The hook must not use the connection. Hooks run one after another while the connection is still checked out, so their time adds to how long it is held. A hook must not wait on a connection from the same pool, for example by awaiting a query through the same runtime. A write that a hook sends through the same runtime gets its own `afterTransaction`.

The runtime remembers a plan on the transaction once the query's parameters are encoded and before the query runs. A query whose row stream the caller abandons inside a transaction therefore still gets its `afterTransaction` stage when the transaction ends, with its plan and the transaction's outcome. A query that fails earlier, in a before-hook or while encoding its parameters, gets no stage.

The transaction stops remembering when `commit()` or `rollback()` is called, not when it settles, and drops the plans it remembered, with their encoded parameters, when it ends. A statement sent after that call reaches the database after the `COMMIT` or `ROLLBACK` (see `SqlTransaction`), so a query sent then on the transaction or on its connection runs in autocommit, and fires its stage when it ends, as a query outside a transaction does.

The direct Postgres driver runs every query on a single client, so a runtime-scope query sent while a transaction is open runs inside that transaction. The runtime does not track this, and fires its stage as for a query outside a transaction. The driver interface does not report a driver whose connections share one session with the driver itself, which is why the runtime cannot track this case.

A transaction that never ends, such as an abandoned manual `connection().transaction()`, never fires the stage for its plans, or for later queries on its connection. It keeps them until the application drops its references to the transaction and to its connection.

The runtime checks once, when it is created, whether any of its middleware declares `afterTransaction`; when none does, it registers nothing when a transaction opens, remembers no plans and fires nothing.

Why `wrapTransaction` and not `withTransaction`: the ORM's `withMutationScope` calls `runtime.connection()`, then `connection.transaction()`, and then `commit()` or `rollback()` on the returned wrapper. It never goes through `withTransaction`. A stage fired from `withTransaction` would miss every ORM mutation that opens its own transaction.

Mongo fires the stage as a query outside a transaction, through the same helpers, since every Mongo query runs outside a transaction.

### Hook errors

A runner in [`run-with-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/run-with-middleware.ts) calls each middleware's `afterTransaction` in registration order. An error from a hook is logged through `ctx.log.error` and swallowed, and later hooks still run. The commit has already happened, so failing the caller would report a failure for work that succeeded. ActiveRecord raises in this position; not raising is a conscious difference.

### Prior art

ActiveRecord's `after_commit` is declared on the record being saved. It runs once the outermost transaction commits, and runs immediately when the save was outside an explicit transaction. `afterTransaction` follows the same shape: it belongs to the query, not to the transaction.

### Not in this slice

- No `beforeTransaction`, and no hook that belongs to a transaction rather than to a query.
- No transaction id, and no way to store data on a transaction or on a context.

Hooks for transactions are a later, separate decision. Whatever their shape, they stay apart from the query hooks, so a middleware author never has to match a transaction's events to its queries. A separate object on the middleware with its own begin and end hooks is the expected direction.

### Tests

- Runner: calls hooks in registration order; a throwing hook is logged through `ctx.log.error`, swallowed, and does not stop later hooks.
- SQL runtime lifecycle:
  - a query in runtime scope, and one in connection scope, fires `committed` right after its after-hook, and `unknown` when it fails, when the caller stops reading its rows, or when the signal aborts between rows;
  - a query sent on a connection while its transaction is open fires when the transaction ends, with its outcome;
  - a query whose before-hook throws gets no stage, inside or outside a transaction;
  - a decode failure, a marker read failure, and an abort during the marker read fire `unknown` outside a transaction;
  - a failing execute, a failing row stream, or a decode failure inside a transaction makes a resolved `commit()` fire `unknown` for every plan, also when another query's row stream was abandoned, through `withTransaction` and by hand, and a `rollback()` still fires `rolled-back`;
  - an abandoned row stream alone inside a transaction gets `committed` when `commit()` resolves;
  - prepared queries and prepared executes inside a transaction fire when it ends;
  - a query run on a hand-driven transaction after `commit()` fires its stage right after its after-hook;
  - a write sent on the transaction or on its connection while `commit()` or `rollback()` is pending fires `committed` right after its after-hook, and the transaction's earlier queries get the transaction's outcome;
  - a caller that throws into a row stream inside a transaction does not make the commit report `unknown`;
  - a `rollback()` that settles while `commit()` is pending fires `unknown` once;
  - every `withTransaction` branch fires once per plan with the right outcome: resolved commit gives `committed`; callback error then resolved or rejected rollback gives `rolled-back`; rejected commit gives `unknown`, whether the cleanup rollback then succeeds or fails, with no second call;
  - the same outcomes through `connection().transaction()` driven by hand, as the ORM does;
  - several plans on one transaction fire in execution order, each with the same `planExecutionId` its other hooks saw;
  - a throwing hook does not fail `commit()`;
  - `commit()` and `rollback()` resolve only after the hooks have run.
- `RuntimeCore`: a mock family fires `committed` after the after-hook, `unknown` on failure and when the caller stops reading, and nothing when a before-hook throws; middleware added to the caller's array after creation do not run.
- Supabase: a role session's transaction fires `committed` after its commit and `rolled-back` after its rollback, once per query, including for prepared statements; `close()` waits for a pending role commit or rollback.
- Postgres integration: an ORM single-row `update()` fires `afterTransaction` with `committed` once; a statement that fails inside a transaction, caught by the callback, makes the commit report `unknown`; the runtime does not count a row stream the caller stopped inside a transaction as a failed query, so the commit reports `committed`.
- Type test: a middleware with `afterTransaction` is assignable to `SqlMiddleware[]` and to `MongoMiddleware[]`.

### Docs

- [ADR 260](../../docs/architecture%20docs/adrs/ADR%20260%20-%20Every%20query%20has%20an%20afterTransaction%20stage%20that%20fires%20when%20its%20enclosing%20transaction%20ends.md): the stage, its outcomes (including `unknown` for every rejected commit), where it fires inside and outside a transaction, the exactly-once rule, that `commit()` and `rollback()` wait for the hooks, and why transaction hooks are left for later.
- The runtime subsystem doc ([`4. Runtime & Middleware Framework.md`](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md)) adds the stage to the query lifecycle.
- The runtime skill reference ([`runtime.md`](../../skills/prisma-8/references/runtime.md)) lists the hook.

## Slice 2: `invalidateAnnotation` on writes (TML-3400)

### Surface

In `@internal/middleware-cache`:

```ts
export interface InvalidateAnnotationOptions<TMeta = unknown> {
  readonly keys?: readonly string[];
  readonly meta?: TMeta;
}
// invalidateAnnotation<TMeta>({ keys, meta }), defined with applicableTo: ['write']
```

The payload has the same shape as `cache.invalidate`'s target, typed by `TMeta` the way `cacheAnnotation<TMeta>` is. A read terminal refuses it at compile time and at run time.

### Behaviour

The cache middleware does nothing for writes in `afterQuery` or `afterExecute`. It implements `afterTransaction`. When the stage fires for a plan that carries the annotation, it calls `invalidate` with the annotation's `keys` and `meta`, unless the outcome is `rolled-back`. `unknown` invalidates, because the write may have committed and an unneeded invalidation costs only a miss. Plans without the annotation are ignored.

The middleware keeps no state per transaction. The runtime decides when the stage fires, so the same code serves every scope. Several annotated writes in one transaction each invalidate when the transaction ends.

A store error from `invalidate` propagates out of the hook. The runner logs it and swallows it, as for any hook error.

### Known limits to document

- Nested-relation writes discard annotations: the ORM runs them as a graph of internal statements, and the annotation reaches none of them.
- The Mongo ORM cannot annotate writes.
- Outside a transaction, a write whose row stream the caller drops without finishing it or calling `return()` fires nothing, so it does not invalidate. A stream stopped with `break` fires `unknown` and invalidates. Inside a transaction the dropped write still invalidates when the transaction ends.
- On the direct Postgres driver, a read in runtime scope sent while a transaction is open runs inside that transaction, so the cache can store rows that are not committed. This is older than this slice and is not fixed here.

### Tests

- Type tests: `invalidateAnnotation` is accepted on every write terminal and refused on reads; `TMeta` checks `meta`.
- Middleware:
  - `committed` invalidates once with the annotation's `keys` and `meta`;
  - `unknown` invalidates;
  - `rolled-back` does nothing;
  - a plan without the annotation does nothing;
  - a store error propagates to the runner, which logs it.
- [`cache-query-only.test.ts`](../../packages/3-extensions/middleware-cache/test/cache-query-only.test.ts) changes to check that the middleware's only hook for writes is `afterTransaction`.
- Postgres integration:
  - an ORM `update()` with the annotation, then a read, sees the new row with one driver call;
  - a `db.transaction(fn)` that contains an annotated write and rolls back leaves the cached entry in place, and the next read is still served from the cache.

### Docs

The package README's Scope section stops listing write-side invalidation as missing and documents the annotation, when it runs, and the known limits. ADR 266's consequence about the runtime hook, and its paragraph on invalidation that comes with a write, are updated in the same PR.

## Non-goals

- Table detection from the plan. An extension that wants table-based invalidation still ships its own middleware.
- Serve-stale strategies.
- Hooks for transactions, including `beforeTransaction`.

## Definition of done

- `afterTransaction` fires exactly once per query with the right outcome: right after the query outside a transaction, and when the transaction ends inside one, including for ORM writes.
- An annotated write invalidates after its transaction commits or ends with an unknown outcome, never before, and never after a rollback.
- The ADR for the stage is merged, the runtime subsystem doc, the runtime skill reference, ADR 266 and the package README describe the shipped behaviour, and this folder is deleted at close-out.
