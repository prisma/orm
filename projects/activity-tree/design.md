# The runtime's middleware sees a tree of activities, not a flat list of statements

Status: design settled on 2026-10-07, 2026-10-08 and 2026-10-09. Recorded as [ADR 271](../../docs/architecture%20docs/adrs/ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20completed.md), status Proposed. Not built, not ticketed.

This document records the decisions and the reasoning behind them. The ADR states the decision; this document holds the scenarios, the prior art and every rejected alternative.

## The problem in one example

```ts
await db.transaction(async (tx) => {
  await tx.orm.public.User.where({ id: 1 }).update(
    { name: 'Alicia', posts: (p) => p.create([{ title: 'Hello' }]) },
    (m) => m.annotate(invalidateAnnotation({ keys: ['user-1'] })),
  );
});
```

The user wrote one transaction containing one ORM call, and annotated the call. The runtime runs four statements, and middleware sees four unrelated statements:

```
SELECT ... FROM "user" WHERE id = $1
UPDATE "user" SET name = $1 WHERE id = $2
INSERT INTO "post" ...
SELECT ... FROM "user" WHERE id = $1          (reload)
```

Each has a plan, a `planExecutionId`, a `scope` string and its own hooks. Nothing says they belong to one ORM call, which transaction they belong to, or what the user annotated the call with. Because this write has a relation callback, the ORM validates the annotation and discards it ([`collection.ts`](../../packages/3-extensions/sql-orm-client/src/collection.ts), the note on `create()` and `update()`). For a plain single-row `update()`, the annotation reaches the `UPDATE` but not the `SELECT` before it. For a create on a model with multi-table inheritance, it reaches nothing, and no comment says so.

Most ORM calls send more than one statement. "One user call, several statements" is the common case.

## What middleware asks, and from where

| Middleware | Question, asked from inside one statement | What it is about |
|---|---|---|
| Cache invalidation on a write | when are my effects final? | the enclosing transaction |
| Cache invalidation on an ORM call | what did the user ask to invalidate? | the enclosing ORM call |
| Caching an ORM call | can the whole call be served without running it? | the ORM call |
| Tracing | which user action am I part of? | the ORM call, the transaction, the request |
| Audit | record once per thing the user did | the ORM call |
| Budgets, lints | is this statement within limits? | the statement itself |

These were answered one at a time: ADR 160's `groupingKey` (never built), ADR 220's `planExecutionId`, ADR 260's `afterTransaction`, transaction begin and end hooks (agreed for later, never built), and a convention that copies the call's annotations onto every statement (rejected on 2026-10-06). Each is a special case of one missing structure.

## Decisions

### 1. An activity is one act by an actor

The user calls an ORM method. The ORM opens a transaction and sends statements. The user opens `db.transaction(fn)`. A SQL builder user sends a query. Each act is an activity. An activity may have a parent, to any depth.

The runtime is not an actor. It hosts the tree, attaches each new activity under its parent, and fires the hooks. It starts nothing on its own.

### 2. The runtime defines two kinds; clients add their own

- **`statement`**: one statement sent to the database. It is the leaf of the tree.
- **`transaction`**: started by `transaction()`, ended by `commit()` or `rollback()`.

The SQL ORM adds `orm-call`. The framework names no client vocabulary.

### 3. `query()` and `execute()` both send a statement

`query()` sends a statement for its rows; `execute()` sends one for its statistics, such as the number of affected rows. To the runtime the two have the same lifecycle: start, block or change parameters, intercept, run, end, complete. The only differences are what comes back, that `onRow` has rows to visit only for `query()`, and that a row stream ends lazily, when the caller stops reading. So there is one kind, and the activity's `returns: 'rows' | 'stats'` records which the caller asked for. The same plan can be sent either way: `update()` sends it for rows and `updateAndCount()` for statistics.

Rejected: a `query` kind (the word already means a statement in general and the `query()` method), an `execution` kind (the word already means running any plan), and two kinds, one per method (they share a lifecycle).

### 4. Every ORM terminal method starts an activity

Including a `create()` that sends one `INSERT`, and a call served from the cache without any statement. The activity is the user's intent: "you called this method, and we turned it into these statements for you."

Why not only multi-statement terminals: the user would have to know how many statements a terminal sends, and that changes with the target. Middleware would have to handle "sometimes the statement is the call". A tracer would show different trees for the same application code on Postgres and SQLite.

### 5. The tree is discovered as it executes

A parent is open while children start and end beneath it, and it ends last. Nobody declares the structure up front. `db.transaction(fn)` runs user code, and the ORM's statements depend on earlier results: a single-row `update()` sends its `UPDATE` only if the `SELECT` found a row. OpenTelemetry's spans work the same way.

### 6. An activity has a parent and, while open, its direct children

The runtime drops the child list when the activity completes. It already keeps such a list for transactions (`rememberQueriesUntilEnd` in [`sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts)). Today it keeps that list only when some middleware implements `afterTransaction`. Under the tree it keeps it always: one code path, at the cost of holding a few objects per open transaction.

Ending an activity while one of its children is open is a runtime error. It is a client bug, and ending the children automatically would hide it.

A statement sent on a transaction's connection while the transaction is open is a child of that transaction, because the database runs it in the transaction's session.

### 7. Middleware has lifecycle events and interceptors

Lifecycle events observe. Interceptors can change or stop a statement while the runtime executes it. Keeping the two apart follows EF Core, which separates interceptors ("allow modification or suppression of the operation") from diagnostic listeners, and Ecto, Hibernate, Rails and datasource-proxy, which all keep "watch it happen" apart from "change or stop it".

Rejected: one wrapping hook with a `next()` to call, as Django's `execute_wrapper`. ADR 014 rejected it because it is harder to keep compile-time work, run-time work and budgets apart, and it mixes observing with changing.

### 8. Three lifecycle events on every activity

- **`activityStarted`**: the act begins.
- **`activityEnded`**: the act ends, with `succeeded`, `failed`, or `stopped` when the caller stopped reading a row stream early. For a statement it also carries latency, `source: 'driver' | 'middleware'`, and the row count or statistics. An error thrown here fails the activity; the latency budget relies on that.
- **`activityCompleted`**: the effects are final, with `committed`, `rolled-back` or `unknown`. An error thrown here is logged and swallowed.

Ended and completed are separate because they are different moments inside a transaction, and different middleware need each:

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.update(...);   // ended here
  await callAnotherService();      // seconds pass
});                                 // completed here, after COMMIT
```

Budgets and tracing need the end: a budget must fail the statement while the caller still holds it, and a span ends when its work ends. The cache needs completion: invalidating before the commit lets a concurrent read put the old row back. Outside a transaction the two moments coincide, and completion fires right after the end. ActiveRecord has the same pair: `after_save` and `after_commit`.

Each lifecycle event is one hook whatever the kind. They return nothing, so a single hook can narrow its input by reading the activity, and the main consumers, the cache's write path and a tracer, do not care about the kind. Kinds are open, so per-kind hooks would need a catch-all anyway.

Named after Spring's and JTA's `afterCompletion(status)`. "Settled" was rejected: in JavaScript a promise settles when it resolves or rejects, which readers took to mean the end.

### 9. When an activity completes

With no enclosing transaction: right after it ends, `committed` when it succeeded and `unknown` when it failed or was stopped, since a statement that errors on the response path may already have applied. Inside a transaction: when the outermost enclosing transaction ends, with its outcome. Rails `after_commit` and Django `on_commit` follow the same rule.

| What happened | Outcome |
|---|---|
| `commit()` resolves and no statement in the transaction failed | `committed` |
| `commit()` resolves after a statement in the transaction failed | `unknown` |
| `rollback()` settles, no commit attempted | `rolled-back` |
| `commit()` rejects, whether or not a rollback follows | `unknown` |

`unknown` stays. A rejected `COMMIT` may have landed before the error came back; a resolved `COMMIT` after a failed statement is a silent `ROLLBACK` on Postgres and a commit elsewhere. The ORMs with two outcomes (Rails `after_commit`/`after_rollback`, Django `on_commit`, Hibernate's `successful` flag) fire nothing in these cases, and their documentation warns against relying on the hooks for external state. Spring and JTA keep the third status for exactly that use.

Order: children before parent. A transaction's statements and child activities complete in the order they started, then the transaction, then its parent if the parent has ended. A tracer then closes inner spans before outer ones.

### 10. Four interceptors

| Interceptor | Activities | When it runs | What it can do |
|---|---|---|---|
| `beforeCompile` | statements (SQL) | before the query tree becomes SQL | rewrite the query tree |
| `beforeEncode` | statements | after lowering, before codecs encode the parameters | block the statement; change parameter values |
| `intercept` | statements and client activities | instead of running the activity | supply the result |
| `onRow` | statements that return rows | for each row from the database | observe the row, or stop the stream |

`beforeEncode` replaces `beforeQuery` and `beforeExecute`. It must sit between lowering and encoding: before lowering there are no parameter values in place, and after encoding the Cipherstash middleware can no longer encrypt them. Changing parameter values is rare as middleware; Rails, Hibernate and EF Core put encryption in the type layer. It is middleware here because the Cipherstash SDK encrypts a statement's values in one batch.

`intercept` has one handler per result type, `onQuery`, `onExecute` and `onActivity`, so the compiler checks each handler's return type. One handler checked at run time was rejected for losing that check. There is no transaction handler: a transaction has no result to supply, and skipping it would run its actor's statements outside any transaction. A test harness that runs each transaction as a savepoint would need a different interceptor around `BEGIN` and `COMMIT`; nothing needs it now.

### 11. Starting an activity returns a queryable, shaped like a transaction handle

```ts
startActivity<TResult>(activity: { kind: string; contentHash: string; annotations?: Annotations }): Promise<ActivityHandle<TResult>>;

interface ActivityHandle<TResult> extends RuntimeQueryable {
  readonly intercepted: { readonly result: TResult } | undefined;
  end(result: { outcome: 'succeeded' | 'failed' | 'stopped'; result?: TResult }): Promise<void>;
}
```

Statements sent through the handle are the activity's children. `handle.transaction()` starts a transaction beneath it, so `withMutationScope` puts the ORM's own transaction under the call. A call made on `tx` inside `db.transaction(fn)` starts its activity on `tx` and lands under the user's transaction. The ORM receives only `{ query, execute }` there today, so its handle has no `transaction()` and nesting stays a compile-time error.

Research on 2026-10-08: every statement the SQL ORM sends goes through a queryable it holds: `ctx.runtime` for reads and count terminals, the `withMutationScope` scope for mutation graphs, a `target` for prepared statements. The reload after a nested update runs on `ctx.runtime` after the transaction ends; under this design it runs on the call handle.

The user-facing types omit `startActivity`, as `tx` has no `transaction` method. The ORM's structural `RuntimeQueryable` type requires it, so a minimal queryable cannot drop annotations silently.

### 12. The user's annotations live on the activity they annotated

An annotation on an ORM call lives on the call activity; the statements beneath it carry none. A SQL builder query the user annotates is the statement activity itself. A middleware acts only on the activity in hand, never its parent, so nothing is cached or invalidated twice.

### 13. Caching an ORM call caches its result

When the user asks to cache an ORM call, the result of the whole call is cached. That needs three things from the runtime:

1. **A key when the user named none.** Every activity has a content hash. The runtime computes a statement's from the storage hash, the statement text and its parameters, as `ctx.contentHash` does today. The ORM supplies a call's, by hashing the model, the terminal method and the collection's state. A tracer uses the same hash to name spans.
2. **A way to serve the call without running it.** `intercept.onActivity`. When it answers, `handle.intercepted` is set and the ORM returns that value without sending any statement.
3. **The result to store.** `end({ result })` hands the runtime the value the ORM returns to its caller, opaque to the runtime. For a streaming terminal such as `all()`, the result is complete only when the caller reads to the end; a stopped call stores nothing, as a stopped statement does today.

### 14. The cache skips activities inside a transaction or on a held connection

The cache rule is the same for every kind: if the activity carries a cache annotation, cache its result. Two exceptions protect correctness:

- **Inside a transaction.** A transaction must read its own uncommitted writes, and the cache cannot know what the transaction changed until it commits. Serving would hand the transaction rows from before its own writes; storing would cache rows that a rollback then erases. Spring's `TransactionAwareCacheDecorator` defers storing to the commit but still serves reads, and accepts the stale read; rejected. django-cacheops stops caching only once the transaction has written; the runtime cannot tell whether a raw statement writes, so rejected for now. Shopify's IdentityCache skips the cache whenever a transaction is open, which is the rule here.
- **On a held connection.** Supabase sets the user's database role on a held connection. The same statement then returns different rows for different users, and the key does not include the role, so serving would leak one user's rows to another.

`ctx.inTransaction()` answers the first by walking up `ctx.parent`, the way Rails `transaction_open?`, Django `in_atomic_block` and Ecto `in_transaction?` answer it with one check. `ctx.scope === 'connection'` answers the second; a connection is not an activity, so the tree cannot show it.

### 15. The activity is reached from the middleware context, not the plan

ADR 220 argued against putting per-execution facts on `PlanMeta`: the runtime would wrap the plan, the plan reference would no longer flow through unchanged, and content hashing would have to exclude the field. Each activity has its own `ctx`; every hook of that activity receives the same one.

### 16. No ambient context

A child learns its parent because its opener passed it the handle. ADR 160 and ADR 220 both rejected `AsyncLocalStorage` under "explicit over implicit".

### 17. A middleware keeps state on an activity with `ctx.state(key)`

`ctx.state(key)` returns the state object stored under `key` for the activity, created empty on first use. The key is a string or a symbol, unconstrained; two middleware that use the same key share the object, and a middleware that wants privacy uses a `Symbol()` or an unusual string. The state is dropped when the activity completes. The runtime stores it in a plain `Map`, since keys may be strings.

Middleware carry state between hooks today by keying a `WeakMap` on the plan (`pending` in the cache, `observedRowsByPlan` in budgets). That idiom is hard to discover, and it breaks across encoding: the hook before encoding receives the draft plan and later hooks the encoded plan, a different object. Requested by the team when the design was reviewed on 2026-10-08.

## What this collapses

| Today | Becomes |
|---|---|
| `beforeQuery`, `beforeExecute` | `beforeEncode` |
| `interceptQuery`, `interceptExecute` | `intercept.onQuery`, `intercept.onExecute` |
| `afterQuery`, `afterExecute` | `activityEnded` on a statement |
| ADR 260 `afterTransaction` | `activityCompleted` on a statement |
| ADR 160 `groupingKey` (never built) | the parent activity |
| ADR 220 `planExecutionId` | a statement activity's identity |
| deferred transaction begin and end hooks | `activityStarted` and `activityEnded` on a transaction |
| the annotation-copying convention (never built) | annotations on the call activity |
| plan-keyed `WeakMap` state in middleware | `ctx.state(key)` |

## Scenarios

| Scenario | Needs | Covered by |
|---|---|---|
| Cache invalidation after commit | the annotated activity's `activityCompleted` | 8, 9, 12 |
| Annotated ORM call sending several statements | annotations on the call activity | 4, 12 |
| Caching a whole ORM call | content hash, `intercept.onActivity`, result at `end()` | 13 |
| ORM calls inside `db.transaction(fn)` | call under transaction; completion waits for it; cache skips it | 9, 11, 14 |
| Supabase role-bound reads | cache skips the held connection | 14 |
| Tracing | started and ended per activity, parent, content hash | 8, 13, 17 |
| Audit, once per call | the call activity's `activityEnded` or `activityCompleted` | 4, 8 |
| Lints and the SQL-size budget block a statement | `beforeEncode` throws | 10 |
| Encrypting parameters | `beforeEncode` changes values | 10 |
| Row and latency budgets | `onRow` throws; `activityEnded` throws | 8, 10 |
| Nested transactions (a later goal) | transaction under transaction; completes at the outermost | 9 |
| A statement sent on the connection while its transaction is open | child of the transaction | 6 |
| An activity that never ends | holds its children | as today |

## Rejected

- **Copying the call's annotations onto every statement.** Lets every middleware read a call-level annotation as if it were about the statement, and multiplies the payload. Rejected 2026-10-06.
- **Attaching the call's annotations to one chosen statement.** The ORM would decide which statement represents the call. Rejected 2026-10-06.
- **A reserved annotation namespace carrying the call's annotations.** A stopgap for the missing activity.
- **The cache reading a statement's annotations, then its parent's.** Would cache the same work twice.
- **Parent pointers only, nothing walks down.** Came from an assistant draft, not the discussion. The runtime needs the child list.
- **The cache walks a transaction's children when the transaction ends.** Fails when the transaction is the call's child (a bare `update()`), and makes the cache know about transactions.
- **Keeping the per-statement hooks unchanged beside the activity hooks.** The release-candidate period is the time to change the interface; our own middleware are few and the external ones fewer.
- **One wrapping hook with `next()`.** See decision 7.
- **Two statement kinds, `query` and `execute`, or an `execution` kind with an operation field.** See decision 3.
- **`intercept` checked at run time; lifecycle events split by kind; an `intercept` handler for transactions.** See decisions 8 and 10.
- **Serving cached reads inside a transaction.** See decision 14.
- **Two completion outcomes, as in Rails.** See decision 9.
- **`activitySettled`.** See decision 8.
- **`startActivity` on the user-facing scope.** Exposes a client-only method to users on `tx`.
- **Every write is followed by a read-back on targets without `RETURNING`.** Claimed in an earlier discussion document. The ORM refuses those writes with `ORM.CAPABILITY_MISSING`; no read-back path exists.

## Names

Settled on 2026-10-08 and 2026-10-09, after checking each against this repo and the wider ecosystem:

| Name | Precedent |
|---|---|
| activity, `startActivity`, `ActivityHandle` | .NET `ActivitySource.StartActivity` returns an `Activity` |
| `statement` | ADR 003; JDBC's `Statement` runs both `executeQuery` and `executeUpdate` |
| `returns: 'rows' \| 'stats'` | the runtime's `execute()` returns `stats` |
| `activityStarted`, `activityEnded`, `activityCompleted` | Spring and JTA `afterCompletion` |
| `succeeded`, `failed`, `stopped` | `stopped` is the existing ending for a row stream the caller stopped reading |
| lifecycle events, interceptors | EF Core: interceptors versus diagnostic listeners |
| `beforeCompile`, `beforeEncode` | named after the step they precede; `encodeParams` is the existing step name |
| `intercept.onQuery`, `onExecute`, `onActivity` | the runtime methods; EF Core's `ReaderExecuting`, `NonQueryExecuting` |
| `contentHash` | the existing `ctx.contentHash` |
| `ctx.inTransaction()` | Ecto `in_transaction?`, Rails `transaction_open?` |
| `ctx.state(key)` | kept as a method; keyed access is what lets a middleware use a private symbol |

Rejected words: "operation" (overloaded), "scope" (`ctx.scope`), "call" (does not cover a transaction), "execution" (running any plan), "query" (a statement in general, and the `query()` method), "span" (ADR 160 keeps OpenTelemetry's words free), "settled" (a JavaScript promise).

## Still open

- **When it is built.** This is its own project. It touches the middleware interface, the SQL runtime's transaction bookkeeping, the Mongo runtime, the Supabase role session, the client facades and the ORM's terminal methods, rewrites every middleware, and amends ADR 160 and ADR 260.

## What it means for the cache project

`invalidateAnnotation({ keys, meta })` on write terminal methods is unchanged for the user. Under this design the cache reads it from the call activity in `activityCompleted`. Built on `afterTransaction` today, the annotation would reach only the statements it already reaches, missing writes with relation callbacks and creates on models with multi-table inheritance, and the cache's hook would be rewritten when the tree lands.

Recommendation: build the write annotation as a consumer of the tree, not on `afterTransaction`.

## References

- [ADR 003 — One query, one statement](../../docs/architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)
- [ADR 014 — Runtime hook API](../../docs/architecture%20docs/adrs/ADR%20014%20-%20Runtime%20Hook%20API.md)
- [ADR 160 — Plan grouping keys for multi-statement orchestration](../../docs/architecture%20docs/adrs/ADR%20160%20-%20Plan%20grouping%20keys%20for%20multi-statement%20orchestration.md) (to be amended)
- [ADR 215 — Runtime middleware lifecycle](../../docs/architecture%20docs/adrs/ADR%20215%20-%20Runtime%20middleware%20lifecycle%20beforeExecute%20before%20encodeParams.md)
- [ADR 220 — Plan execution identity for middleware correlation](../../docs/architecture%20docs/adrs/ADR%20220%20-%20Plan%20execution%20identity%20for%20middleware%20correlation.md)
- [ADR 260 — Every query has an afterTransaction stage](../../docs/architecture%20docs/adrs/ADR%20260%20-%20Every%20query%20has%20an%20afterTransaction%20stage%20that%20fires%20when%20its%20enclosing%20transaction%20ends.md) (to be amended)
- [ADR 266 — The cache middleware passes data to its store](../../docs/architecture%20docs/adrs/ADR%20266%20-%20The%20cache%20middleware%20passes%20data%20to%20its%20store%2C%20and%20the%20store%20decides%20how%20to%20cache.md)
- [Runtime & Middleware Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md)
- Spring `TransactionSynchronization.afterCompletion`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html
- Spring `TransactionAwareCacheDecorator`: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/cache/transaction/TransactionAwareCacheDecorator.html
- EF Core interceptors: https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors
- Shopify IdentityCache `should_use_cache?`: https://github.com/Shopify/identity_cache/blob/main/lib/identity_cache.rb
- django-cacheops transactions: https://github.com/Suor/django-cacheops
- Rails `ActiveRecord::Transaction` callbacks: https://rubydoc.info/docs/rails/ActiveRecord/Transaction
- PostgreSQL `txid_status()` and in-doubt commits: https://enterprisedb.com/blog/traceable-commit-postgresql-10
