# Cache invalidation on write — spec

Linear: [TML-3399](https://linear.app/prisma-company/issue/TML-3399) (slice 1, `afterTransaction`), [TML-3400](https://linear.app/prisma-company/issue/TML-3400) (slice 2, `invalidateAnnotation`, blocked by slice 1). Design of the cache middleware itself: [ADR 259](../../docs/architecture%20docs/adrs/ADR%20259%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md).

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

The write annotation belongs in `@internal/middleware-cache` even though ADR 259 keeps policy out of core. It decides nothing about what to invalidate. The annotation names its own target, which reaches the same `invalidate` call as the manual form. What the package adds is the timing: the middleware already holds the store, so it is the one place that calls `invalidate` once the write is final, instead of every extension doing it again.

## Why the write annotation waits for slice 1

ORM writes that return rows fire `afterQuery`; count-style writes fire `afterExecute`. Both fire per statement, before any enclosing transaction commits. If the cache invalidated there:

1. The write's transaction updates user 1, and the hook removes the cached entry.
2. The transaction has not committed. A concurrent request reads user 1, misses, reads the old committed row, and stores it.
3. The transaction commits. The cache holds the old row until it expires.

This is the default path, not an edge case. These ORM mutations run in a transaction of their own (`withMutationScope` in [`mutation-executor.ts`](../../packages/3-extensions/sql-orm-client/src/mutation-executor.ts)): single-row `update()` and `delete()`, nested creates and updates, a `create()` on a multi-table-inheritance variant, and a `delete()` with includes. A plain `create()` does not, and neither does `upsert`. The correct moment to invalidate is after the commit.

## Slice 1: the `afterTransaction` stage (TML-3399)

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

Outside a transaction (`ctx.scope` is `'runtime'` or `'connection'`), the runtime fires it right after `afterQuery` or `afterExecute`, with `committed`. It fires whether or not the query completed. A statement run on its own has committed, or failed without effect, by the time it returns.

Inside a transaction, the SQL runtime's `wrapTransaction` ([`sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts)) remembers every plan executed on the transaction, with its context. When the transaction ends, it fires the stage once for each plan, in execution order:

| What happened | Outcome |
|---|---|
| `commit()` resolves | `committed` |
| `rollback()` resolves, no commit attempted | `rolled-back` |
| `rollback()` rejects, no commit attempted | `rolled-back` |
| `commit()` rejects | `unknown` |

- `unknown` fires for every rejected `commit()`, whether or not the `rollback()` that follows succeeds. A `COMMIT` that errors may already have landed, for example when it fails on the response path. A cleanup `ROLLBACK` that succeeds proves nothing about it.
- A rejected `rollback()` with no commit attempted fires `rolled-back`, because no `COMMIT` was sent, so none of the transaction's writes can have landed.
- A `rollback()` after a rejected `commit()` fires nothing more. Both `withTransaction` and the ORM's `runInTransaction` call `rollback()` after a rejected `commit()`.
- The stage fires exactly once per plan per transaction.
- `commit()` and `rollback()` resolve only after the hooks have run. A write that has returned has already had its stage run.
- The stage fires after `commit()` or `rollback()` resolves and before the connection is released. The hook must not use the connection.

A transaction that never ends, such as an abandoned manual `connection().transaction()`, never fires the stage for its plans.

Why `wrapTransaction` and not `withTransaction`: the ORM's `withMutationScope` calls `runtime.connection()`, then `connection.transaction()`, and then `commit()` or `rollback()` on the returned wrapper. It never goes through `withTransaction`. A stage fired from `withTransaction` would miss every ORM mutation that opens its own transaction.

Mongo declares the hook and fires it with `committed` right after `afterQuery` or `afterExecute`, since every Mongo query runs outside a transaction.

### Hook errors

A runner in [`run-with-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/run-with-middleware.ts) calls each middleware's `afterTransaction` in registration order. An error from a hook is logged through `ctx.log.error` and swallowed, and later hooks still run. The commit has already happened, so failing the caller would report a failure for work that succeeded. ActiveRecord raises in this position; not raising is a conscious difference.

### Prior art

ActiveRecord's `after_commit` is declared on the record being saved. It runs once the outermost transaction commits, and runs immediately when the save was outside an explicit transaction. `afterTransaction` follows the same shape: it belongs to the query, not to the transaction.

### Not in this slice

- No `beforeTransaction`, and no hook that belongs to a transaction rather than to a query.
- No transaction id, and no way to store data on a transaction or on a context.

Hooks for transactions are a later, separate decision. When one is needed, it goes in a `transaction` object on the middleware with its own begin and end hooks, kept apart from the query hooks. That way a middleware author never has to match a transaction's events to its queries.

### Tests

- Runner: calls hooks in registration order; a throwing hook is logged through `ctx.log.error`, swallowed, and does not stop later hooks.
- SQL runtime lifecycle:
  - a query in runtime scope, and one in connection scope, fires `committed` right after its after-hook, including when the query fails;
  - every `withTransaction` branch fires once per plan with the right outcome: resolved commit gives `committed`; callback error then resolved or rejected rollback gives `rolled-back`; rejected commit gives `unknown`, whether the cleanup rollback then succeeds or fails, with no second call;
  - the same outcomes through `connection().transaction()` driven by hand, as the ORM does;
  - several plans on one transaction fire in execution order, each with the same `planExecutionId` its other hooks saw;
  - a throwing hook does not fail `commit()`;
  - `commit()` resolves only after the hooks have run.
- Postgres integration: an ORM single-row `update()` fires `afterTransaction` with `committed` once.
- Type test: a middleware with `afterTransaction` is assignable to `SqlMiddleware[]` and to `MongoMiddleware[]`.

### Docs

- An ADR of its own: the stage, its outcomes (including `unknown` for every rejected commit), where it fires inside and outside a transaction, the exactly-once rule, that `commit()` and `rollback()` wait for the hooks, and why transaction hooks are left for later.
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
- An abandoned row stream fires no after-hook. Outside a transaction it therefore fires no `afterTransaction` either, and a write whose returned rows the caller never drains does not invalidate.

### Tests

- Type tests: `invalidateAnnotation` is accepted on every write terminal and refused on reads; `TMeta` checks `meta`.
- Middleware:
  - `committed` invalidates once with the annotation's `keys` and `meta`;
  - `unknown` invalidates;
  - `rolled-back` does nothing;
  - a plan without the annotation does nothing;
  - a store error propagates to the runner, which logs it.
- [`cache-query-only.test.ts`](../../packages/3-extensions/middleware-cache/test/cache-query-only.test.ts) changes to check that the middleware's only hook for writes is `afterTransaction`.
- Postgres integration: an ORM `update()` with the annotation, then a read, sees the new row with one driver call.

### Docs

The package README's Scope section stops listing write-side invalidation as missing and documents the annotation, when it runs, and the known limits. ADR 259's consequence about the runtime hook, and its paragraph on invalidation that comes with a write, are updated in the same PR.

## Non-goals

- Table detection from the plan. An extension that wants table-based invalidation still ships its own middleware.
- Serve-stale strategies.
- Hooks for transactions, including `beforeTransaction`.

## Definition of done

- `afterTransaction` fires exactly once per query with the right outcome: right after the query outside a transaction, and when the transaction ends inside one, including for ORM writes.
- An annotated write invalidates after its transaction commits or ends with an unknown outcome, never before, and never after a rollback.
- The ADR for the stage is merged, the runtime subsystem doc, the runtime skill reference, ADR 259 and the package README describe the shipped behaviour, and this folder is deleted at close-out.
