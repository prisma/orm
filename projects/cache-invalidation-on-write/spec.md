# Cache invalidation on write — spec

Linear: [TML-3399](https://linear.app/prisma-company/issue/TML-3399) (slice 1, `afterTransaction`), [TML-3400](https://linear.app/prisma-company/issue/TML-3400) (slice 2, `invalidateAnnotation`, blocked by slice 1). Design of the cache middleware itself: [ADR 259](../../docs/architecture%20docs/adrs/ADR%20259%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md).

## At a glance

```ts
// Today: the application invalidates after the write has returned.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
await cache.invalidate({ keys: ['user-1'] });

// After this project: the invalidation rides on the write and runs once its transaction has committed.
await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (m) =>
  m.annotate(invalidateAnnotation({ keys: ['user-1'] })),
);
```

## Purpose

This is the second half of the cache work. The first half shipped the cache middleware's primitives, including `cache.invalidate({ keys, meta })`, which the application calls after a write has returned. This project lets a write carry its own invalidation. That needs a point in the runtime where the write's transaction is known to have committed, which the runtime does not have yet. Slice 1 adds it; slice 2 builds the write annotation on it.

The write annotation belongs in `@internal/middleware-cache` even though ADR 259 keeps policy out of core. It decides nothing about what to invalidate: the annotation names its target, which reaches the same `invalidate` call as the manual form. What it adds is the deferral until the commit, and that then has one owner, the middleware that already holds the store, instead of every extension re-implementing it.

## Why the write annotation waits for a post-commit hook

ORM writes that return rows fire `afterQuery`; count-style writes fire `afterExecute`. Both fire per statement, before any enclosing transaction commits. If the cache invalidated there:

1. The write's transaction updates user 1, and the hook removes the cached entry.
2. The transaction has not committed. A concurrent request reads user 1, misses, reads the old committed row, and stores it.
3. The transaction commits. The cache holds the old row until it expires.

This is the default path, not an edge case: the ORM's single-row `update()` and `delete()`, nested creates and updates, a `create()` on a multi-table-inheritance variant, and a `delete()` with includes run in a transaction of their own (`withMutationScope` in [`mutation-executor.ts`](../../packages/3-extensions/sql-orm-client/src/mutation-executor.ts)). The correct moment to invalidate is after the commit.

## Slice 1: the `afterTransaction` middleware hook (TML-3399)

### Surface

In [`runtime-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/runtime-middleware.ts):

```ts
export interface AfterTransactionResult {
  readonly outcome: 'committed' | 'rolled-back' | 'unknown';
}

export interface TransactionMiddlewareContext {
  readonly contract: unknown;
  readonly mode: 'strict' | 'permissive';
  readonly now: () => number;
  readonly log: RuntimeLog;
  readonly scope: 'transaction';
  readonly transactionId: string;
}

export interface RuntimeMiddleware<TPlan, TMutator> {
  // ...existing hooks
  afterTransaction?(result: AfterTransactionResult, ctx: TransactionMiddlewareContext): Promise<void>;
}

export interface RuntimeMiddlewareContext {
  // ...existing fields
  readonly transactionId?: string;
}
```

- `TransactionMiddlewareContext` has no `contentHash`, `planExecutionId` or `signal`: the hook belongs to a transaction, not to one operation.
- `transactionId` is minted once per transaction with `crypto.randomUUID()` in the SQL runtime's `wrapTransaction` ([`sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts)). Every operation run on that transaction carries it on its `RuntimeMiddlewareContext`, and the same value reaches `afterTransaction`. It is absent outside a transaction.

### Firing

A `runAfterTransaction` helper in [`run-with-middleware.ts`](../../packages/1-framework/1-core/framework-components/src/execution/run-with-middleware.ts) calls each middleware's `afterTransaction` in registration order. An error from a hook is logged through `ctx.log.error` and swallowed: the commit has already happened, so failing the caller would report a failure for work that succeeded. Later hooks still run.

The hook fires inside `wrapTransaction`, on the wrapper's own `commit()` and `rollback()`:

| What happened | Outcome |
|---|---|
| `commit()` resolves | `committed` |
| `rollback()` resolves | `rolled-back` |
| `commit()` rejects | `unknown` |

The wrapper's `commit()` and `rollback()` await `runAfterTransaction` before resolving, so a write that has returned has already run its `afterTransaction` hooks.

It fires exactly once per transaction. `unknown` is fired for every rejected `commit()`, whether or not the cleanup rollback that follows succeeds: a successful rollback cannot prove the commit did not land, because a commit can apply and still fail on the response path. After `commit()` rejects, both `withTransaction` and the ORM's `runInTransaction` call `rollback()` to clean up; that rollback must not fire the hook a second time. A `rollback()` that rejects with no commit attempted fires `rolled-back`: no COMMIT was sent, so none of the transaction's writes can have landed.

Why `wrapTransaction` and not `withTransaction`: the ORM's `withMutationScope` calls `runtime.connection()`, then `connection.transaction()`, and then `commit()` or `rollback()` on the returned wrapper. It never goes through `withTransaction`. A hook fired from `withTransaction` would miss every ORM operation that runs through `withMutationScope`: single-row `update()` and `delete()`, nested creates and updates, a `create()` on a multi-table-inheritance variant, and a `delete()` with includes.

The hook fires before the connection is released. It must not use the connection, and it receives no queryable.

### Not in this slice

- No `beforeTransaction`. No consumer needs it.
- Mongo: the Mongo runtime has no transaction surface yet. Mongo middleware can declare `afterTransaction`, but it never fires.

### Tests

- Framework: `runAfterTransaction` calls hooks in registration order; a throwing hook is logged through `ctx.log.error`, swallowed, and does not stop later hooks; type tests that `afterTransaction` is optional and that `TransactionMiddlewareContext` has no `contentHash`, `planExecutionId` or `signal`.
- SQL runtime: `committed` on a resolved commit, `rolled-back` on a resolved rollback, `unknown` on a rejected commit whether the cleanup rollback then succeeds or fails; `commit()` resolves only after the hooks have run; exactly one call when a rejected commit is followed by `withTransaction`'s rollback; the same through `connection().transaction()` driven by hand, as the ORM does; every operation on one transaction sees the same `transactionId`, which matches the one `afterTransaction` receives; two transactions see different ids; operations outside a transaction have no `transactionId`.
- ORM integration: a single-row `update()` fires `afterTransaction` with `committed` once.

### Docs

- The runtime subsystem doc ([`4. Runtime & Middleware Framework.md`](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md)) describes the hook, its outcomes, and that it fires from the transaction wrapper.
- An ADR of its own lands with this slice: the post-commit hook, its outcomes (including `unknown` for every rejected commit), the firing point, that `commit()` and `rollback()` wait for the hooks, and the exactly-once rule.

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

The payload has the same shape as `cache.invalidate`'s target, typed by `TMeta` the same way `cacheAnnotation<TMeta>` is. A read terminal refuses it at compile time and at run time.

### Behaviour

The cache middleware reads the annotation in two hooks:

- `afterQuery`, for writes that return rows: ORM `create`, `update`, `delete`, `updateAll`, `deleteAll`, `upsert`, and SQL `.returning()`.
- `afterExecute`, for count terminals and plain `execute`.

It invalidates whether or not `result.completed` is true, because a write can apply and still report failure. On the runtime's failure path hook errors are swallowed, so the middleware logs them itself. On the success path a store error propagates to the caller, and the README says that the write has already been applied when this happens.

Timing depends on scope:

- **Runtime scope:** invalidate immediately. The statement ran on its own, so it has committed.
- **Connection scope:** invalidate immediately, as in runtime scope. A pinned connection without a transaction is autocommit.
- **Transaction scope:** queue the invalidation under `ctx.transactionId`. On `afterTransaction`, run the queue on `committed` or `unknown` and drop it on `rolled-back`. `unknown` invalidates because the write may have committed, and an unneeded invalidation costs only a miss.

Several annotated writes in one transaction each queue their target; the queue runs once on the outcome.

### Known limits to document

- Nested-relation writes discard annotations: the ORM runs them as a graph of internal statements, and the annotation reaches none of them.
- The Mongo ORM cannot annotate writes.
- An abandoned row stream fires no after-hook. A write whose returned rows the caller never drains does not invalidate.
- A transaction that ends with neither `commit()` nor `rollback()`, such as an abandoned manual `connection().transaction()`, leaves its queued invalidations unrun, and the queue entry is held until the connection is destroyed. This is bounded by abandoned transactions; `withTransaction` and the ORM always end theirs.

### Tests

- Type tests: `invalidateAnnotation` is accepted on every write terminal and refused on reads; `TMeta` checks `meta`.
- Middleware: runtime-scope write invalidates once with the annotation's `keys` and `meta`; connection-scope write invalidates immediately; `completed: false` still invalidates and logs a store error instead of throwing; a store error on the success path propagates; transaction-scope write does not invalidate before `afterTransaction`; `committed` and `unknown` run the queue; `rolled-back` drops it; two transactions with different ids keep separate queues.
- Integration: an ORM single-row `update()` with the annotation invalidates after the commit, and a read after it sees the new row with one driver call; a write in a rolled-back transaction leaves the entry.

### Docs

The package README's Scope section stops listing write-side invalidation as missing and documents the annotation, its timing, and the known limits. ADR 259's consequence about the runtime hook and its paragraph on invalidation attached to a write are updated in the same PR.

## Non-goals

- Table detection from the plan. An extension that wants table-based invalidation still ships its own middleware.
- Serve-stale strategies.
- A `beforeTransaction` hook.

## Definition of done

- `afterTransaction` fires exactly once per SQL transaction with the right outcome, including for ORM writes, and `transactionId` correlates operations to their transaction.
- An annotated write invalidates after its transaction commits, never before, and never after a rollback.
- The ADR for the hook is merged, ADR 259 and the package README describe write-side invalidation, and this folder is deleted at close-out.
