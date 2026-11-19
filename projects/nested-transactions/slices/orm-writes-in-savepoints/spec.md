# Slice: orm-writes-in-savepoints

**Project:** `projects/nested-transactions/` (slice 6, the last). **Linear:** skipped by the operator.

## Outcome

A multi-statement ORM write inside a transaction runs in its own savepoint. When it fails, none of its rows stay, and the transaction it ran in can go on, on every SQL database. This is project spec decision 7, and it carries the project DoD item on ORM writes.

## At a glance

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.create(a)                                  // A

  await tx.orm.Post
    .create({ ...post, author: (author) => author.create(b) }) // SAVEPOINT sp_1, INSERT user B, INSERT post fails,
    .catch(() => {})                                           // ROLLBACK TO SAVEPOINT sp_1, the database error is rethrown

  await tx.orm.User.create(c)                                  // C
})                                                             // COMMIT: A and C are stored, B is not
```

Before this slice the write's statements run directly in the user's transaction (`run-graph.ts:84`: the `orm-call` handle has no `transaction` member there). On MySQL and SQLite, user B stays and is committed. On Postgres the failed statement aborts the transaction, so C fails and nothing is committed.

In the runtime, on a handle opened inside a transaction:

```ts
const call = await startActivityOn(tx, ormCall)   // an 'orm-call' activity beneath the transaction activity
call.inTransaction()                              // true
await call.transaction(async (sp) => {            // SAVEPOINT sp_1, a 'transaction' activity beneath the call's activity
  await sp.execute(insertUser)
  await sp.execute(insertPost)
})                                                // RELEASE SAVEPOINT sp_1
await call.transaction(fn, { isolationLevel })    // rejects RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED, nothing is sent
```

## Chosen design

Project spec decisions 7 and 8, as amended during slice 3. The savepoint code is what slices 3 and 4 built: `TransactionBase.transaction()` opens the savepoint, and `runInSavepoint` with `runAndSettleTransaction` runs the callback and settles it. This slice adds a second caller of that code, the activity handle, and the only thing the handle does differently is the parent activity of the savepoint. No second settle sequence, guard or name counter is written.

### SQL runtime (`packages/2-sql-family/5-runtime/src`)

1. **Every activity handle has `transaction(fn, options)`.** `ActivityHandle.transaction` becomes a required member. What it does depends on where the handle was opened:

   | Handle opened on | `transaction(fn, options)` |
   |---|---|
   | the runtime | begins a transaction through `withTransaction` (unchanged) |
   | a held connection with no open transaction | begins a transaction on that connection (unchanged) |
   | a transaction or a savepoint, a `withTransaction` context or a nested context, or a handle nested in one of those | opens a savepoint on that transaction or savepoint |
   | a held connection whose transaction was open when the handle started | opens a savepoint on that transaction |

   The last row follows from decision 7 ("wherever a transaction is open on the connection, whichever API opened it"): an activity started on such a connection is already a child of the open transaction's activity (slice 3, rule 5).
2. **The savepoint starts beneath the handle's activity.** `TransactionBase.transaction()` starts the savepoint's activity beneath the transaction's own activity. Its body becomes one operation that takes the parent activity; `transaction()` calls it with the transaction's activity, and the handle's route calls it with the handle's activity. `OpenTransaction`, the record the runtime keeps for each driver transaction and for each connection with an open transaction, exposes that operation, so the transaction route and the connection route reach it the same way. The checks (`TRANSACTION_CLOSED`, `TRANSACTION_SUSPENDED`), the name counter, the stack push before the first `await`, and the paths for a refused start and a failed `SAVEPOINT` stay written once. `RuntimeTransaction.transaction()` keeps no parameters (decision 2), and `RuntimeTransaction` gains no member.
3. **`fn` and settling.** `fn` receives the guarded `TransactionContext` of the savepoint, the one `tx.transaction(cb)` passes to its callback. The savepoint is settled by `runInSavepoint`, so every row of slice 4's table (item 4 of its spec) holds for the handle's `transaction(fn)`: `fn` throws → `ROLLBACK TO`, same error; `RELEASE` fails → `ROLLBACK TO`, `RUNTIME.TRANSACTION_COMMIT_FAILED`; and so on.
4. **Options are rejected inside a transaction** (decision 8). When `options` is anything other than `undefined`, a handle that would open a savepoint rejects with the new `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`. No activity is started and nothing is sent. An ended handle still rejects `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` first, as today.
5. **`ActivityRoute.transaction` is always a function.** The `| undefined` in its type goes away, and with it the branch in `activityHandle` that returns a handle without the member.
6. **The guarded handle forwards `transaction`.** A handle started through a `withTransaction` context (`guardedHandle` in `guardedTransactionContext`) drops the member today. It now has it: it rejects `RUNTIME.TRANSACTION_CLOSED` when its context is closed, otherwise it calls the handle's `transaction`.
7. **`ActivityHandle` gains `inTransaction(): boolean`**, the handle's own `ctx.inTransaction()`: whether a transaction activity is among the activity's ancestors. Decision 7 has the ORM tell the two cases apart "from its activity (`ctx.inTransaction()`)", and a handle exposes `activity` (id, kind, annotations) but not the context, so the handle needs this member. The guarded handle forwards it.

### Error

- `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`: a factory next to `transactionClosedError` in `runtime-transaction.ts`. The message says that a transaction started inside a transaction is a savepoint, which has the isolation level and timeout of the transaction it is in. Details: the options that were passed. An entry in `docs/reference/error-reference.md`.

### ORM (`packages/3-extensions/sql-orm-client/src`)

8. **`run-graph` calls the handle's `transaction(fn)` inside a transaction too.** The condition in `runAllNodes` stays (more than one statement, the graph writes, the queryable has `transaction`). Outside a transaction it passes `ctx.implicitTransactionOptions`, as today. Inside one (`runtime.inTransaction()` is true) it passes no options. `CollectionQueryable` in `types.ts` gains an optional `inTransaction?(): boolean`, next to its optional `transaction`; a queryable without it is treated as outside a transaction, as today.
9. **Nothing else in the ORM changes.** The graph's statements already run on the `tx` the callback receives, including the reads that load includes for the rows a write returns. Reads of several statements still open nothing.

### What users see

- A multi-statement ORM write on `tx.orm` (or on `inner.orm` in a nested transaction) sends `SAVEPOINT`, its statements, and `RELEASE SAVEPOINT`. When a statement fails it sends `ROLLBACK TO SAVEPOINT` and rejects with the statement's error.
- On MySQL, MariaDB and SQLite, the rows the failed write had already written are gone. On Postgres the transaction is no longer aborted after the failure, so the callback can catch the error and continue, and the commit stores the work around the write.
- While such a write runs, other work sent on the same `tx` rejects with `RUNTIME.TRANSACTION_SUSPENDED` (project spec decision 3). Before this slice, `Promise.all` of an ORM write and another query on one `tx` worked; each call on `tx` now has to be awaited before the next one starts when one of them is a multi-statement write.
- Middleware sees the write's savepoint as a `'transaction'` activity beneath the `orm-call` activity (decision 6).

## Coherence rationale

The handle member has one caller, the ORM, and the ORM change cannot work without it. On MySQL the facade sets `implicitTransactionOptions`, so the handle's rejection of options and the ORM's omission of them have to land together. The database tests are the project DoD item this slice exists for.

## Scope

**In:**

- `packages/2-sql-family/5-runtime/src`: `activity-handle.ts`, `runtime-transaction.ts`, `sql-runtime.ts`; the package README where it describes the handle's `transaction`.
- `packages/2-sql-family/5-runtime/test`: `client-activity.transaction.test.ts` (its two "is absent" tests are replaced), and other test files only where the new required members make them fail to typecheck.
- `packages/3-extensions/sql-orm-client`: `src/statement-graph/run-graph.ts`, `src/types.ts`, `test/statement-graph/graph-transaction.test.ts`, `README.md` (line 87 says the call "opens none of its own" inside `db.transaction(fn)`).
- Database tests, added to the files that hold each database's nested-transaction tests: `packages/3-targets/sqlite/9-facade/test/nested-transactions.test.ts`, `packages/3-targets/mysql/3-live-tests/test/suites/nested-transactions.ts` (run for MySQL and MariaDB), `packages/3-targets/postgres/9-facade/test/nested-transactions.integration.test.ts`. If one of these fixtures cannot express a failing multi-statement write, the test goes in `test/integration/test/sql-orm-client/` instead.
- Test helpers that rebuild a handle member by member (`withPlanRecording` in `test/integration/test/sql-orm-client/runtime-helpers.ts`, the ORM test fixtures) forward `inTransaction` where a test needs it.
- Docs, limited to statements this slice makes untrue plus the new error:
  - `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`: the `transaction(fn, options)` bullet (line 364: "has no `transaction` property at run time, so transactions do not nest") and the paragraph on ORM writes (line 721: "Inside `db.transaction(fn)` the handle has no `transaction` member").
  - ADR 271, line 141: "A handle opened under a transaction has no `transaction`, so transactions do not nest."
  - `docs/reference/error-reference.md`: the new entry.
  - `skills/prisma-8/references/runtime.md` § Workflow — Transactions: two or three sentences on what users see (above).
- Upgrade instructions under `upgrade-instructions/pending/`, written with the `record-upgrade-instructions` skill: the required `transaction` and `inTransaction` members on `ActivityHandle`, `ActivityRoute.transaction` always defined, and the behaviour change for concurrent work on `tx` during a multi-statement ORM write.

**Out:**

- `packages/1-framework/**`. A savepoint activity beneath a client activity inside a transaction is expected to work as the framework is (`transaction-activity.ts` decides from `ctx.inTransaction()`). If it does not, stop and report.
- The facades' source, the drivers, and `tx.transaction(cb)` (slices 1, 4, 5).
- The savepoint rules of slice 3 and the settle sequence of slice 4. This slice calls them and changes only the parent activity.
- The rest of ADR 271 and the subsystem doc (project close), and the project close-out itself.
- A savepoint for an ORM read of several statements, or for a single-statement write.

## Adapter impact

None. No source file of a target or of the Supabase extension changes; the Postgres, SQLite and MySQL packages gain tests.

## Contract impact

None.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A database test passes without the change when the write is rejected before it reaches the database. If the ORM passed its implicit options inside a transaction on MySQL, the write would reject `SAVEPOINT_OPTIONS_UNSUPPORTED`, the test's `.catch` would swallow it, and A and C would be stored without B. | Each database test asserts that the error the failed write rejected with is the database's own error, and its last write (C) is itself a multi-statement write that succeeds. | Slice 5 hit the same shape: a test that only checked the committed rows passed without the change. |
| A test helper that rebuilds a handle without `inTransaction` makes the ORM pass options inside a transaction. | The helper forwards the member. | `withPlanRecording` copies `transaction`, `commit` and the prepared-statement members by name. |
| Concurrent work on `tx` while a multi-statement ORM write runs rejects `RUNTIME.TRANSACTION_SUSPENDED`. | Documented in the skill reference and the upgrade instructions. Not tested again: slice 3's runtime tests and slice 4's PGlite test cover the suspension, and a database test of the race depends on timing. | Follows from decisions 3 and 7. If an existing test fails for this reason, stop and report; do not change the test. |
| A statement the ORM sends through the call's handle, instead of the `tx` its callback receives, while the call's savepoint is open would reject `RUNTIME.TRANSACTION_SUSPENDED`. | None is expected: outside a transaction such a statement would already run on another connection. If one turns up, stop and report. | |
| MySQL commits the transaction on DDL, which removes its savepoints. | The live suite creates nothing inside a transaction; it uses the seeded example database, as slice 5's tests do. | |

## Slice-specific done conditions

Each path is tested once, at the level named.

**Runtime tests with the stub driver** (`client-activity.transaction.test.ts`):

- [ ] A handle opened on a transaction: `transaction(fn)` sends `SAVEPOINT sp_1`, the statement, `RELEASE SAVEPOINT sp_1`, and resolves with `fn`'s result; the savepoint's activity is beneath the handle's activity. A handle nested in it does the same beneath its own activity.
- [ ] `fn` throws: `ROLLBACK TO SAVEPOINT sp_1`, the same error is rethrown, and the transaction then runs a statement and commits.
- [ ] `transaction(fn, options)` on such a handle rejects `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`; no savepoint activity is started, nothing is sent, and `fn` is not called.
- [ ] A handle opened on a connection whose transaction is open opens a savepoint on that transaction.
- [ ] A handle started through a `withTransaction` context opens a savepoint; once the context is closed, its `transaction` rejects `RUNTIME.TRANSACTION_CLOSED` with nothing sent.
- [ ] `inTransaction()` is `false` on a handle opened on the runtime and on a held connection with no transaction, and `true` on the handles of the four conditions above.

**ORM unit test** (`graph-transaction.test.ts`):

- [ ] With `implicitTransactionOptions` set, the runner passes them to `transaction` when the queryable is outside a transaction and passes no options when `inTransaction()` is true.

**Database tests** (SQLite on `node:sqlite`, MySQL and MariaDB live, Postgres on PGlite), one test each, through the facade's `db.transaction`:

- [ ] The At a glance example: a multi-statement ORM write whose second statement fails, with its error caught, inside a transaction that writes before it and after it. The caught error is the database's error. A and C are stored, with C written by a multi-statement write, and no row of the failed write is stored. Each test fails without the production change.

**Greps:**

- [ ] `rg "has no .transaction. (member|property)|opens none of its own" docs packages/2-sql-family/5-runtime packages/3-extensions/sql-orm-client -g '*.md'` returns nothing.
- [ ] `pnpm check:error-reference` passes with the new code.

## Size

About 380 changed lines, measured against the code:

- Production, about 70: `runtime-transaction.ts` about 25, `sql-runtime.ts` about 35, `activity-handle.ts` about 5, the ORM about 5.
- Tests, about 260: runtime about 100 (27 of them the two removed tests), ORM unit about 30, database tests about 130.
- Docs, about 20. Upgrade instructions, about 30.

The project plan estimated 300. The operator's cap is about 500.

## Plan (one dispatch)

**D1: `transaction(fn)` on activity handles inside a transaction, and ORM writes that use it.**

- **Outcome:** everything in § Chosen design and § Slice-specific done conditions.
- **Builds on:** slice 3 (`TransactionBase.transaction()`, the stack and the guard), slice 3b (the handle's callback `transaction(fn, options)`), slice 4 (`runInSavepoint`, `runAndSettleTransaction`, the guarded context), slice 5 (the facades' nested-transaction test files).
- **Hands to:** project close.
- **Focus:** tests first. Suggested commits: (1) runtime: the handle's `transaction` inside a transaction, `inTransaction`, the error, the stub-driver tests and the error reference; (2) ORM: `run-graph`, the type, the unit test; (3) the database tests; (4) docs and upgrade instructions. Commits may merge where a split leaves the workspace failing typecheck. Every commit is signed off (`git commit -s`).
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter <pkg> test` for `@internal/sql-runtime`, `@internal/sql-orm-client`, `@internal/postgres`, `@internal/sqlite`, `@internal/mysql-live-tests` (with `MYSQL_URL` and `MARIADB_URL` set), and `@internal/extension-supabase` (its handles go through the changed code).
  - The integration files that run ORM writes inside a transaction or through a handle wrapper: `test/integration/test/sql-orm-client/` and the interactive-transaction ports under `test/integration/test/ports/`, run as `.agents/rules/running-tests.mdc` says.
  - `pnpm --filter <pkg> lint` for every touched package, `pnpm lint:deps`, `pnpm check:error-reference`, `pnpm lint:skills`, `pnpm fixtures:check`.
  - `pnpm check:upgrade-coverage --mode pr --prev f08ba069a56e0 --head HEAD` (the branch is stacked on slice 5 until it merges).

## Open Questions

None. Three choices this spec makes where the project spec leaves room, for the operator to confirm in review:

1. `inTransaction()` as a method on `ActivityHandle` (item 7).
2. Any `options` argument other than `undefined` is rejected inside a transaction, including an empty object (item 4).
3. A handle on a held connection whose transaction is open opens a savepoint too (item 1, last row), which makes `transaction` a required member of every handle.

## References

- Project spec: decisions 2, 3, 6, 7, 8; cross-cutting requirements; project DoD. Project plan: slice 6.
- Slice 3: `slices/runtime-savepoints/spec.md` (rules 3, 5), PR #31053. Slice 3b: `slices/handle-transaction-callback/spec.md` (item 1), PR #31073. Slice 4: `slices/postgres-nested-transactions/spec.md` (items 3, 4), PR #31106. Slice 5: `slices/other-facades/spec.md`, PR #31120.
- Code: `packages/2-sql-family/5-runtime/src/sql-runtime.ts` (`activityHandle`, `connectionRoute`, `#transactionRuntime.route`, `runInSavepoint`, `guardedTransactionContext`), `packages/2-sql-family/5-runtime/src/runtime-transaction.ts` (`TransactionBase.transaction`, `OpenTransaction`), `packages/3-extensions/sql-orm-client/src/statement-graph/run-graph.ts` (`runAllNodes`).
