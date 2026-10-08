# The runtime's middleware sees a tree of activities, not a flat list of queries

Status: design settled on 2026-10-07 and 2026-10-08. Recorded as [ADR 267](../../docs/architecture%20docs/adrs/ADR%20267%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20settled.md), status Proposed. Not built, not ticketed. Names were settled on 2026-10-08; see "Still open".

This document records the decisions and the reasoning behind them. It replaces the discussion document `discussion-query-grouping.md` from the cache project (branch `docs/cache-invalidation-handover`), which contained two claims that did not come from the discussion and do not hold against the code: that the tree is "parent pointers only, nothing walks down", and that a target without `RETURNING` makes the ORM follow every write with a read-back. Neither is true; see "Rejected".

## The problem in one example

```ts
await db.transaction(async (tx) => {
  await tx.orm.public.User.where({ id: 1 }).update(
    { name: 'Alicia', posts: (p) => p.create([{ title: 'Hello' }]) },
    (m) => m.annotate(invalidateAnnotation({ keys: ['user-1'] })),
  );
});
```

The user wrote one transaction containing one ORM call, and annotated the call. The runtime runs four statements, and middleware sees four unrelated queries:

```
SELECT ... FROM "user" WHERE id = $1
UPDATE "user" SET name = $1 WHERE id = $2
INSERT INTO "post" ...
SELECT ... FROM "user" WHERE id = $1          (reload)
```

Each has a plan, a `planExecutionId`, a `scope` string and its own hook lifecycle. Nothing says they belong to one ORM call, which transaction they belong to, or what the user annotated the call with. The ORM validates the annotation and discards it ([`collection.ts`](../../packages/3-extensions/sql-orm-client/src/collection.ts), the note on `create()` and `update()`).

Most ORM calls run more than one statement. A single-row `update()` is a `SELECT` then an `UPDATE`, in a transaction the ORM opens for it. `delete()` with includes, `create()` on a multi-table-inheritance variant and every write with a relation callback run several. "One user call, several queries" is the common case.

## What middleware asks, and from where

Every middleware need we have is a question about something other than the query it is asked from:

| Middleware | Question, asked from inside one query | What it is about |
|---|---|---|
| Cache invalidation on a write | when are my effects final? | the enclosing transaction |
| Cache invalidation on an ORM call | what did the user ask to invalidate? | the enclosing ORM call |
| Tracing | which user action am I part of? | the ORM call, the transaction, the request |
| Audit | record once per thing the user did | the ORM call |
| Budgets, lints | is this statement within limits? | the query itself |

We have answered these one at a time: ADR 160's `groupingKey` (an id per ORM call on each plan, never built), ADR 220's `planExecutionId` (an id per query), ADR 260's `afterTransaction` (the runtime walks from each query to its transaction on the query's behalf), transaction begin and end hooks (agreed as a later addition, not built), and a convention that copies the call's annotations onto every statement (discussed 2026-10-06, rejected). Each is a special case of one missing structure.

## Decisions

### 1. An activity represents one act by an actor

The user calls an ORM method. The ORM opens a transaction and issues statements. The user opens `db.transaction(fn)`. A SQL builder user issues a query. Each act is an activity. An activity may have a parent, to any depth.

The runtime is not an actor. It hosts the tree, attaches each new activity under its parent, and fires the hooks. It opens nothing on its own.

This is the test for what deserves an activity, and it makes the next decision true by construction.

### 2. Every ORM terminal opens a activity

Including a `create()` that runs one `INSERT`, and a call that runs no query at all because the cache served it. The activity is the user's intent: "you called this method, and we turned it into these statements for you."

Why not only multi-statement terminals: the user would have to know how many statements a terminal runs, and that changes with the target. Middleware would have to handle "sometimes the query is the call". A tracer would show different trees for the same application code on Postgres and SQLite. One activity per terminal costs one `activityStarted` and one `activityEnded` per ORM call, and the runtime does nothing extra: the client opens and closes it.

### 3. The tree is discovered as it executes

A parent is open while children start and end beneath it, and it ends last. Nobody declares the structure up front. `db.transaction(fn)` runs user code, and the ORM's statements depend on earlier results: a single-row `update()` runs its `UPDATE` only if the `SELECT` found a row. OpenTelemetry's spans work the same way.

### 4. An activity has a parent and, while open, its direct children

The runtime drops the child list when the activity ends. This is what the runtime already does for transactions: `rememberQueriesUntilEnd` in [`sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts) keeps each query's pending stage until `commit()` or `rollback()` is called. An activity that never ends holds its children, as an abandoned transaction does today.

### 5. Every activity has the same three lifecycle moments

- **`activityStarted`.** The act begins.
- **`activityEnded`.** The act ends. The outcome is what the actor saw: `completed` or `failed`.
- **`activitySettled`.** The effects are final. Outcome `committed`, `rolled-back` or `unknown`. Fires right after `activityEnded` when no enclosing transaction is open, otherwise when the outermost enclosing transaction ends. An error thrown from an `activitySettled` hook is logged and swallowed; later middleware still run.

This is the model of Spring's `TransactionSynchronization.afterCompletion(status)`: one completion callback, three statuses, errors logged and not propagated. ADR 260 already matches it for queries. The tree applies it to every activity.

Activity kinds are labels, useful to a tracer. No middleware branches on them. The cache reacts to `activitySettled` on any activity that carries its annotation and never checks what kind of activity it is.

ADR 260's outcome table is the rule for a transaction activity, applied to every activity beneath it:

| What happened | Outcome |
|---|---|
| `commit()` resolves and no query in the transaction failed | `committed` |
| `commit()` resolves after a query in the transaction failed | `unknown` |
| `rollback()` settles, no commit attempted | `rolled-back` |
| `commit()` rejects, whether or not a rollback follows | `unknown` |

### 6. `unknown` stays

Two cases produce it. A rejected `COMMIT` may have landed on the server before the error came back; the cleanup `ROLLBACK` succeeds either way and proves nothing. A resolved `COMMIT` after a failed statement is answered by Postgres with a silent `ROLLBACK`, while other databases commit; the runtime cannot tell which happened.

Prior art splits in two. The ORMs that collapse completion to two outcomes (Rails `after_commit`/`after_rollback`, Django `on_commit`, Hibernate's `successful` flag) fire nothing or `false` in these cases, and their documentation warns against relying on the hooks for external state. The transaction-manager APIs built for exactly that use (Spring, JTA `Synchronization`) keep a third status. Entity Framework 6 and PostgreSQL's `txid_status()` go further and ask the database. A cache that guesses "rolled back" when the write landed holds stale rows until they expire, which is the failure ADR 260 was written to prevent. A consumer that must not miss a committed write treats `unknown` like `committed`; for the cache that costs one miss.

### 7. The user's annotations live on the activity they annotated

An annotation on an ORM call lives on the call activity. The statements beneath it carry no user annotations. A SQL builder query the user annotates directly is itself the activity, and carries them as today. The ORM stops merging annotations onto its write plan.

### 8. Opening an activity returns a queryable, shaped like a transaction handle

```ts
// The ORM's structural dependency type, not the user-facing scope.
interface RuntimeQueryable extends RuntimeScope {
  connection?(): Promise<RuntimeConnection>;
  transaction?(): Promise<RuntimeTransaction>;
  startActivity?(activity: { kind: string; annotations?: Annotations }): Promise<ActivityHandle>;
}

interface ActivityHandle extends RuntimeQueryable {
  end(result: { outcome: 'completed' | 'failed' }): Promise<void>;
}
```

Queries run through the handle are the activity's children. `handle.transaction()` opens a transaction activity beneath it, so `withMutationScope` puts the ORM's transaction under the call activity by calling it on the handle. A call made on `tx` inside `db.transaction(fn)` opens its activity on `tx` and lands under the user's transaction. Depth needs nothing further.

The three entry points are one mechanism: `query()` and `execute()` start a query activity for the call's duration, `transaction()` starts a transaction activity that `commit()` and `rollback()` end, and `startActivity()` starts an activity for an act the runtime would not otherwise see.

The door is on the runtime's objects and on the clients' structural dependency type. The user-facing types omit it, as `tx` omits `transaction` today. Users see `query`, `execute`, `orm`, `sql`; clients see the door.

Research on 2026-10-08: every query the SQL ORM issues goes through a queryable it holds. Reads and single-statement writes use `ctx.runtime`; mutation graphs use the `scope` from `withMutationScope`; prepared queries take a `target: RuntimeQueryable` when run. The reload `SELECT` after a nested update runs on `ctx.runtime` after the transaction ends; under this design it runs on the call handle. There is no path where the ORM lacks a handle.

### 9. The activity is reached from the middleware context, not the plan

ADR 220 argued against putting per-execution facts on `PlanMeta`: the runtime would wrap the plan, the plan reference would no longer flow through unchanged, and content hashing would have to exclude the field. The same applies here. A hook reads its activity from `ctx`.

### 10. No ambient context

A child learns its parent because its opener passed it the handle. ADR 160 and ADR 220 both rejected `AsyncLocalStorage` for propagating execution context, under "explicit over implicit".

## What this collapses

| Today | Becomes |
|---|---|
| ADR 160 `groupingKey` (never built) | the parent activity's identity |
| ADR 220 `planExecutionId` | a query activity's identity |
| ADR 260 `afterTransaction` | `activitySettled` on a query activity |
| deferred transaction begin and end hooks | `activityStarted` and `activityEnded` on a transaction activity |
| the annotation-copying convention (never built) | annotations on the call activity |

## Scenarios

| Scenario | Needs | Covered by |
|---|---|---|
| Cache invalidation after commit | the annotated activity's `activitySettled` | decision 5, 7 |
| Annotated ORM call running several statements | annotations on the call activity | decision 2, 7 |
| ORM calls inside `db.transaction(fn)` | call under transaction; `activitySettled` waits for the transaction | decision 5, 8 |
| Tracing | `activityStarted` and `activityEnded` per activity, parent identity | decision 5 |
| Audit, once per call | the call activity's `activityEnded`, whatever it ran | decision 2, 5 |
| Nested transactions (an upcoming goal, not this project) | transaction under transaction; settles at the outermost | decision 5: "outermost" |
| A query sent on the connection while its transaction is open | attached to the transaction by the object it ran on | as today |
| An activity that never ends | holds its children | as today; documented |

## Assumptions

- Every orchestrator that runs queries holds a queryable it can replace with an activity handle. True for the SQL ORM. A new client follows the same pattern.
- An activity under an open transaction is held until the transaction ends. Same cost as `afterTransaction` today.
- Mongo has no transactions, so every Mongo activity settles right after it ends, as its queries do today.

## Rejected

- **Copying the call's annotations onto every statement.** Lets every middleware read a call-level annotation as if it were about the statement, and multiplies the payload. Rejected 2026-10-06.
- **Attaching the call's annotations to one chosen statement.** The ORM would decide which statement represents the call. Rejected 2026-10-06.
- **A reserved annotation namespace carrying the call's annotations.** A stopgap for the missing activity; discarded, not migrated, when the activity exists.
- **Parent pointers only, nothing walks down.** Came from an assistant draft, not the discussion. The runtime already keeps a child list for transactions, and the cache needs it.
- **The cache walks a transaction's children when the transaction ends.** Fails when the transaction is the call's child (a bare `update()`), and makes the cache know about transactions.
- **Two completion outcomes, as in Rails.** Leaves the two in-doubt cases silent; see decision 6.
- **The opening method on the user-facing scope.** Exposes a client-only door to users on `tx`.
- **Every write is followed by a read-back on targets without `RETURNING`.** Claimed in the earlier discussion document. The ORM refuses those writes with `ORM.CAPABILITY_MISSING`; no read-back path exists.

## Still open

- Nothing in the design. Names were settled on 2026-10-08: **activity** for a node (after .NET's `System.Diagnostics.Activity`, which has the same shape and maps onto OpenTelemetry without using its vocabulary); `activityStarted`, `activityEnded`, `activitySettled` for the hooks; `startActivity` and `ActivityHandle` for the client door; kinds `query`, `transaction`, `orm-call`. Rejected words: "operation" (ADR 220 uses it for one query), "scope" (`ctx.scope`), "call" (does not cover a transaction), "execution" (already means running a plan), "span" (ADR 160 keeps OpenTelemetry's words free).
- **When it is built.** This is its own project with its own ADR. It touches the middleware interface, the SQL runtime's transaction bookkeeping, the Mongo runtime, the Supabase role session and the ORM's terminals, and it amends ADR 160 and ADR 260.

## What it means for the cache project

`invalidateAnnotation({ keys, meta })` on write terminals is unchanged for the user. Under this design the cache reads it from the call activity in `activitySettled`, not from the `UPDATE` plan in `afterTransaction`. Built on `afterTransaction` now, the annotation reaches a plan only for single-statement writes (it is lost for relation-callback writes and multi-table-inheritance creates), and the cache's hook body is rewritten when the tree lands.

Recommendation: do not build TML-3400 on `afterTransaction`. Make it the first consumer of the tree, so the cache project closes on this design.

## References

- [ADR 014 — Runtime hook API](../../docs/architecture%20docs/adrs/ADR%20014%20-%20Runtime%20Hook%20API.md)
- [ADR 160 — Plan grouping keys for multi-statement orchestration](../../docs/architecture%20docs/adrs/ADR%20160%20-%20Plan%20grouping%20keys%20for%20multi-statement%20orchestration.md) (to be amended)
- [ADR 220 — Plan execution identity for middleware correlation](../../docs/architecture%20docs/adrs/ADR%20220%20-%20Plan%20execution%20identity%20for%20middleware%20correlation.md)
- [ADR 260 — Every query has an afterTransaction stage](../../docs/architecture%20docs/adrs/ADR%20260%20-%20Every%20query%20has%20an%20afterTransaction%20stage%20that%20fires%20when%20its%20enclosing%20transaction%20ends.md) (to be amended)
- [ADR 266 — The cache middleware passes data to its store](../../docs/architecture%20docs/adrs/ADR%20266%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md)
- [Runtime & Middleware Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md)
- Spring `TransactionSynchronization.afterCompletion`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html
- Rails `ActiveRecord::Transaction` callbacks: https://rubydoc.info/docs/rails/ActiveRecord/Transaction
- PostgreSQL `txid_status()` and in-doubt commits: https://enterprisedb.com/blog/traceable-commit-postgresql-10
