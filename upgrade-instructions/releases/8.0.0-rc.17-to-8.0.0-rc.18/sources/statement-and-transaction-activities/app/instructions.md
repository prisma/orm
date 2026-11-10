---
changes:
  - id: middleware-hooks-are-activity-hooks
    summary: |
      The per-statement middleware hooks are replaced. `beforeQuery` and `beforeExecute` become `beforeEncode`; `interceptQuery` and `interceptExecute` become `intercept.onQuery` and `intercept.onExecute`; `afterQuery` and `afterExecute` become `activityEnded` on a statement; `afterTransaction` becomes `activityFinalized` on a statement. `onRow` and `beforeCompile` are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(beforeQuery|beforeExecute|interceptQuery|interceptExecute|afterQuery|afterExecute|afterTransaction)\b'
  - id: middleware-context-is-activity-context
    summary: |
      `RuntimeMiddlewareContext` is renamed `ActivityContext`. It gains `parent`, `state(key)` and `inTransaction()`, and loses `planExecutionId`; use `activity.id` instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bRuntimeMiddlewareContext\b'
        - '\bplanExecutionId\b'
  - id: after-result-types-removed
    summary: |
      `AfterQueryResult`, `AfterExecuteResult` and `AfterTransactionResult` are removed. Use `ActivityEndedResult` (narrow it with `result.kind === 'statement'` and `result.returns`) and `ActivityFinalizedResult`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bAfter(Query|Execute|Transaction)Result\b'
  - id: aborted-phase-before-encode
    summary: |
      A `RUNTIME.ABORTED` error raised during the middleware stage before encoding reports `details.phase: 'beforeEncode'`, not `'beforeQuery'` or `'beforeExecute'`. The phases `'afterQuery'` and `'afterExecute'` no longer occur. Mongo's `RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND` also reports `details.phase: 'beforeEncode'`, not `'beforeExecute'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '[''"`](beforeQuery|beforeExecute|afterQuery|afterExecute)[''"`]'
  - id: every-started-statement-is-ended-and-finalized
    summary: |
      Every statement the runtime accepts now starts an activity, and every started statement ends and is finalized exactly once. A call with an already-aborted signal fires `activityStarted` before it fails. A statement that fails before it runs, in `beforeCompile`, `beforeEncode` or parameter encoding, now ends `failed` and is finalized, where it got no `afterTransaction` before. `activityEnded` also fires for a statement the caller stopped reading (outcome `'stopped'`) and for a statement that failed before it ran (outcome `'failed'`, `latencyMs: 0`, `source: 'driver'`); `afterQuery` and `afterExecute` fired for neither, so a metrics or slow-query middleware now counts them unless it checks `result.outcome`. When a middleware's `activityStarted` throws, the middleware after it receive no `activityEnded` or `activityFinalized` for that activity. A statement still running when its transaction ends, such as a row stream still being read, is finalized when it ends, with the transaction's outcome, and keeps its `ctx.state` until then.
  - id: observed-row-budget-runs
    summary: |
      The `budgets()` middleware now counts the rows a query returns and enforces `maxRows` on them. Before, the observed-row check never ran. With the default row severity `'error'`, or in `strict` mode, a query that returns more than `maxRows` rows fails with `BUDGET.ROWS_EXCEEDED`; with `'warn'` in `permissive` mode it logs one warning for the statement and keeps streaming.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbudgets\('
---

# Middleware hooks are activity hooks

The runtime now runs every statement and every transaction as an **activity**. A middleware observes an activity through three lifecycle events, `activityStarted`, `activityEnded` and `activityFinalized`, and changes or stops a statement through interceptors: `beforeEncode`, `intercept.onQuery`, `intercept.onExecute` and `onRow`. The per-statement hooks are gone.

## Rename the hooks

| Before | After |
|---|---|
| `beforeQuery`, `beforeExecute` | `beforeEncode` |
| `interceptQuery`, `interceptExecute` | `intercept.onQuery`, `intercept.onExecute` |
| `onRow` | `onRow` |
| `afterQuery`, `afterExecute` | `activityEnded` on a statement |
| `afterTransaction` | `activityFinalized` on a statement |
| `beforeCompile` | `beforeCompile` |

`beforeEncode` keeps the arguments of `beforeQuery` and `beforeExecute`: the lowered plan, the context and the parameter mutator. It runs for both `query()` and `execute()`. A middleware that defined both `beforeQuery` and `beforeExecute` with the same body defines `beforeEncode` once. A middleware that must tell them apart reads `activity.returns` (`'rows'` or `'stats'`) in `activityStarted` and keeps it in `ctx.state`.

The interceptors move under one `intercept` object:

```diff
- async interceptQuery(plan, ctx) {
-   return { rows: cached };
- },
+ intercept: {
+   async onQuery(plan, ctx) {
+     return { rows: cached };
+   },
+ },
```

## Read the result from `activityEnded`

`afterQuery(plan, result, ctx)` and `afterExecute(plan, result, ctx)` become one hook, `activityEnded(activity, result, ctx)`. It fires for transactions too, so check the kind first. `result.completed` is replaced by `result.outcome`, which is `'succeeded'`, `'failed'` or `'stopped'` (the caller stopped reading the rows). `latencyMs` and `source` are unchanged; `rowCount` or `stats` is there according to `result.returns`. The plan the caller sent is `activity.plan`; the lowered SQL is not on the activity, so a middleware that logs it keeps it from `beforeEncode` in `ctx.state`:

```diff
- async afterQuery(plan, result, ctx) {
-   if (result.latencyMs > 250) ctx.log.warn({ sql: plan.sql, rowCount: result.rowCount });
- },
+ async beforeEncode(plan, ctx) {
+   ctx.state(statementSql)['sql'] = plan.sql;
+ },
+ async activityEnded(activity, result, ctx) {
+   if (result.kind !== 'statement' || result.latencyMs <= 250) return;
+   ctx.log.warn({
+     sql: ctx.state(statementSql)['sql'],
+     ...(result.returns === 'rows' ? { rowCount: result.rowCount } : {}),
+   });
+ },
```

`statementSql` is a module-level `Symbol('…')`, for example `const statementSql = Symbol('slow-query-warning.sql')`. An error thrown from `activityEnded` after a successful statement still fails it and reaches the caller, as an error from `afterQuery` did; every other middleware still receives `activityEnded`, and the caller receives the first error. A transaction also ends: `succeeded` when its `commit()` or `rollback()` resolved, `failed` when it rejected. So a rolled-back transaction ends `succeeded` and is finalized `rolled-back`. `activityEnded` also fires where `afterQuery` and `afterExecute` did not: for a statement the caller stopped reading, with `result.outcome` `'stopped'`, and for a statement that failed before it ran, in `beforeCompile`, `beforeEncode` or parameter encoding, with `result.outcome` `'failed'`, `latencyMs: 0` and `source: 'driver'`. A middleware that counts statements or latencies checks `result.outcome` if it should skip them.

## Replace `afterTransaction` with `activityFinalized`

`afterTransaction(plan, result, ctx)` becomes `activityFinalized(activity, result, ctx)`. A statement still running when its transaction ends is finalized when it ends, after its `activityEnded`, where `afterTransaction` fired at the transaction's end, before the statement's after-hook. `result.outcome` keeps its three values, `'committed'`, `'rolled-back'` and `'unknown'`, and the same rules decide it. An error thrown from it is still logged and swallowed. It also fires for transactions, after their statements, so a middleware that acts on statements checks `activity.kind === 'statement'`. A statement that fails before it runs, in `beforeCompile`, `beforeEncode` or parameter encoding, is now finalized too: `unknown` outside a transaction, and with the transaction's outcome inside one.

## Rename the context type and the execution id

`RuntimeMiddlewareContext` is now `ActivityContext`, and `SqlMiddlewareContext` and `MongoMiddlewareContext` extend it. A SQL middleware imports `SqlMiddleware` and `SqlMiddlewareContext` from `@prisma/orm-postgres/family-runtime` (or `@prisma/orm-sqlite/family-runtime`), a Mongo middleware imports `MongoMiddleware` and `MongoMiddlewareContext` from `@prisma/orm-mongo/family-runtime`, and a cross-family middleware imports `CrossFamilyMiddleware` and `ActivityContext` from `@prisma/orm-framework/components/runtime`. `ctx.planExecutionId` is removed; use `activity.id`, a fresh id for each activity that every hook of the activity sees. A log detail or field that carried `planExecutionId: ctx.planExecutionId` becomes `activityId: activity.id`. Keep per-statement state in `ctx.state(key)` instead of a `WeakMap` keyed by the plan: each activity has its own state, and middleware that use the same key share the object. `AfterQueryResult`, `AfterExecuteResult` and `AfterTransactionResult` are removed; use `ActivityEndedResult` and `ActivityFinalizedResult`.

## Abort phases and already-aborted calls

A `RUNTIME.ABORTED` error raised during the middleware stage before encoding has `details.phase` `'beforeEncode'`. Code that matches `'beforeQuery'` or `'beforeExecute'` matches `'beforeEncode'` instead. The same holds for the Mongo error `RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND`, raised when a Mongo `beforeEncode` hook calls `ctx.contentHash`: its `details.phase` is `'beforeEncode'`. A call whose signal was aborted before it was made now fires `activityStarted`, then ends `failed`, before it rejects with `RUNTIME.ABORTED`.

## The observed-row budget now runs

`budgets()` now counts the rows each query returns. Before, this check never ran, so a query that returned more than `maxRows` rows succeeded. Now, with the default row severity `'error'` or in `strict` mode, such a query fails with `BUDGET.ROWS_EXCEEDED` once the count passes `maxRows`; with `severities: { rowCount: 'warn' }` in `permissive` mode it logs one warning for the statement and keeps streaming. The `postgres()` client runs its runtime in `strict` mode, where every `budgets()` violation throws whatever its severity, so the warn path does not apply there until the client exposes `mode`. Raise `maxRows` for reads that are expected to return more rows. `tableRows` and `defaultTableRows` only change the estimate checked before a read runs; they do not change the limit on rows a read actually returns.
