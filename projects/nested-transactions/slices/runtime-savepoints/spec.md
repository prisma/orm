# Slice: runtime-savepoints

**Project:** `projects/nested-transactions/` (slice 3 of 6). **Linear:** skipped by the operator.

## Outcome

The SQL runtime opens savepoints on an open transaction, enforces the fail-fast guard of project spec decision 3, and settles savepoints with the error behaviour of decision 9. Nothing above the runtime calls it yet: the facades (slices 4 and 5) and the ORM (slice 6) are the first callers.

## At a glance

```ts
const tx = await connection.transaction()      // BEGIN
const sp = await tx.savepoint()                // SAVEPOINT sp_1, a 'transaction' activity beneath tx's
await sp.execute(plan)                         // runs on the driver savepoint
await tx.execute(plan)                         // rejects RUNTIME.TRANSACTION_SUSPENDED (sp_1 is open)
await tx.savepoint()                           // rejects RUNTIME.TRANSACTION_ALREADY_OPEN (names sp_1)
await sp.rollback()                            // ROLLBACK TO SAVEPOINT sp_1, activity rolled-back at once
await tx.execute(plan)                         // allowed again
await tx.commit()                              // COMMIT
```

## Chosen design

All production changes are in `packages/2-sql-family/5-runtime/src` (`sql-runtime.ts`, `activity-handle.ts`, `transaction-state.ts`, and a new file if the savepoint code reads better on its own).

**One wrapper for every level** (project spec decision 4). The driver gives a transaction and a savepoint the same shape, `SqlTransaction`, so the runtime wraps both with the same code. One function builds the `RuntimeTransaction` for a level from its driver `SqlTransaction`, and its `commit()`, `rollback()`, `savepoint()` and statement members serve the outer transaction and every savepoint. Only the real differences between the outer transaction and a savepoint branch inside it:

- the settlement of a successful `commit()`: `{ by: 'commit' }` on the outer transaction, `{ by: 'release' }` on a savepoint;
- a failed `commit()`: the outer transaction ends its activity `failed`, a savepoint stays open (rule 8);
- a failed `rollback()`: a savepoint invalidates every enclosing level (rule 7);
- what only the outer transaction has: the deadline and timeout, the connection's open-transaction bookkeeping, and the settlement `withTransaction` reads.

1. **`RuntimeTransaction.savepoint(): Promise<RuntimeTransaction>`** (project spec decision 8). Required, no options. The returned level is a `RuntimeTransaction` itself, so `savepoint()` on it stacks another savepoint.
   - It calls the driver's `SqlTransaction.savepoint(name)` (slice 1) on the level's driver transaction.
   - On the returned level, `commit()` calls the driver savepoint's `commit()` (`RELEASE SAVEPOINT`) and `rollback()` calls its `rollback()` (`ROLLBACK TO SAVEPOINT`).
   - Statements on the level run on the driver savepoint and are parented to the savepoint's activity, as statements on a transaction are parented to the transaction's activity today.
   - `signal` is the outer transaction's signal.
2. **The savepoint activity** (project spec decision 6, slice 2). `startTransactionActivity` runs with the parent level's activity as parent, before `SAVEPOINT` is sent. Settlements:
   - `commit()` succeeds: `{ by: 'release', outcome: 'succeeded' }`.
   - `commit()` fails: the activity is not ended. The savepoint is still open on the database, so it stays open in the runtime too (rule 8).
   - `rollback()` succeeds or fails: `{ by: 'rollback', outcome, commitAttempted }`, where `commitAttempted` is true when `commit()` was called first. A savepoint rolled back after a failed `RELEASE` is therefore finalized `rolled-back` (slice 2, rule 3).
   - `SAVEPOINT` fails: `{ by: 'rollback', outcome: 'failed', commitAttempted: false }`, and `savepoint()` rejects with the driver error. The parent level stays usable.
   - An `activityStarted` hook throws: no `SAVEPOINT` is sent, `savepoint()` rejects, and the parent level stays usable (decision 9).
3. **`savepoint()` on an activity handle** opened on a transaction or on a savepoint. The new savepoint's activity is a child of the handle's activity. Handles opened on the runtime or on a connection have no `savepoint`. `ActivityHandle` gains an optional `savepoint?: () => Promise<RuntimeTransaction>`, documented like the existing optional `transaction`.
4. **Names.** `sp_<n>`, from a counter per connection that starts at 1 and only goes up. Only one savepoint is open per level, so names never collide.
**One stack per connection.** Only one savepoint is open per level, so the open levels on a connection always form one chain: the outer transaction, then `sp_1`, then `sp_2`. The runtime keeps that chain as one stack per transaction, created at `BEGIN`, with an invalidated flag, instead of a record per level linked to its enclosing level and its open child. A connection has at most one open transaction, so this is the connection's stack while the transaction is open. Each transaction and savepoint holds a reference to the stack and its own entry (its name and, once started, its activity), and checks by identity whether it is the top before doing anything. Rules 5–7 read the stack:

- a level may send work only while it is the top of the stack;
- a level lower in the stack is suspended;
- a level no longer on the stack is closed;
- `savepoint()` on a level that is not the top rejects with `TRANSACTION_ALREADY_OPEN`;
- settling a level removes it and every entry above it;
- a failed `ROLLBACK TO` sets the invalidated flag, which closes every level at once.

5. **The guard** (decision 3). Each level tracks its open child savepoint, at most one.
   - `savepoint()` on a level that has an open child rejects with `RUNTIME.TRANSACTION_ALREADY_OPEN`. The message names the open savepoint (`sp_<n>`). No `SAVEPOINT` is sent and no activity is started.
   - A statement or `commit()` on a level that has an open child rejects with the new `RUNTIME.TRANSACTION_SUSPENDED`. Its details carry the open savepoint's activity ID. Nothing is sent to the driver. The level is usable again once the child has settled.
   - A statement sent on the connection while its transaction is open counts as a statement on the outer level, so it is refused the same way. Otherwise it would run inside the savepoint on the database while being parented to the outer activity.
   - Once a level is closed (settled, invalidated or timed out), work on it reports that, not `RUNTIME.TRANSACTION_SUSPENDED`.
   - `rollback()` on a level that has an open child is allowed. The driver rollback of the level also undoes the open descendants. Each open descendant is closed first, innermost first: its activity ends `{ by: 'rollback', outcome, commitAttempted: false }`, with the outcome of the level's rollback, and later work on it rejects with `RUNTIME.TRANSACTION_CLOSED`. This is the path `withTransaction` takes when a callback throws, or a timeout fires, while a savepoint is open.
6. **Closed levels.** A savepoint refuses work with `RUNTIME.TRANSACTION_CLOSED` once it has settled, or once any enclosing level has settled, been invalidated, or been closed by the outer transaction's timeout. This covers the note slice 2 left for this slice: the framework accepts work beneath a savepoint after the outer `commit()` or `rollback()` has been called, so the runtime must refuse it.
7. **A failed `ROLLBACK TO` invalidates every level** up to and including the outer transaction (decision 9).
   - The savepoint's `rollback()` rejects with the driver error.
   - Every enclosing level then refuses statements, `savepoint()` and `commit()` with `RUNTIME.TRANSACTION_CLOSED`, without sending anything.
   - The outer transaction's `rollback()` rejects with `RUNTIME.TRANSACTION_CLOSED`, without sending `ROLLBACK`, and its activity ends `{ by: 'rollback', outcome: 'failed', commitAttempted }`. The settle code that exists today then destroys the connection: `withTransaction` after a failed rollback, and the owned transaction (`owned-transaction.ts`) after a failed rollback.
8. **A failed `RELEASE`.** The savepoint's `commit()` rejects with the driver error, and the savepoint is still open: its activity keeps running and the parent stays suspended. `rollback()` on it then sends `ROLLBACK TO`. If that succeeds, the savepoint is finalized `rolled-back` and the parent level is usable again. The decision 9 sequence for a nested callback (rollback after a failed release, then throw `RUNTIME.TRANSACTION_COMMIT_FAILED`) is `withSavepoint`'s job in slice 4; this slice provides the level operations it needs.
9. **Top-level behaviour is unchanged.** `withTransaction`, its options, timeout, abort handling and error codes stay as they are. Its guarded handle drops `savepoint` as it drops `transaction`; slices 4 and 6 decide how a guarded context exposes it.

### Errors

- `RUNTIME.TRANSACTION_SUSPENDED`: new factory next to `transactionClosedError` and `transactionAlreadyOpenError`. Message names the open savepoint. Details: `{ savepointId }`, the open savepoint's activity ID. While the savepoint's `activityStarted` hooks are still running it has no activity ID yet, and `savepointId` is `undefined`; the message still names it.
- `RUNTIME.TRANSACTION_ALREADY_OPEN`: the existing code and factory; the savepoint case gets its own message that names the open savepoint.

## Coherence rationale

The savepoint level, its activity, the guard and the invalidation rules are one state machine on one transaction. Splitting them would ship a `savepoint()` that lets a sibling's `ROLLBACK TO` undo another sibling's work. The error-reference entries describe the codes this slice adds, and the subsystem doc and ADR statements that "transactions do not nest" stop being true in this slice.

## Scope

**In:**

- `packages/2-sql-family/5-runtime/src`: everything in § Chosen design.
- `packages/2-sql-family/5-runtime/test`: a new test file (or files) for savepoints, and `savepoint` support in `test/transaction-activity-fixtures.ts`'s stub driver (records `SAVEPOINT`, `RELEASE`, `ROLLBACK TO` events; configurable failures for each).
- Other implementers of `RuntimeTransaction` or `ActivityHandle` in the workspace, if any, gain the member so the workspace typechecks. Test stubs only.
- `docs/reference/error-reference.md`: a `RUNTIME.TRANSACTION_SUSPENDED` entry; savepoint wording for `RUNTIME.TRANSACTION_ALREADY_OPEN` (it now says transactions do not nest).
- `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` and ADR 271: the statements that a handle opened under a transaction has no `transaction`, so transactions do not nest. They now say that such a handle has `savepoint()` instead. Slice 2's spec left these to this slice.

**Out:**

- `withSavepoint`, any facade, `tx.transaction(cb)`, the ORM, and `withTransaction`'s settle code (slices 4, 5 and 6).
- `packages/1-framework/**`. If the design needs a framework change, stop and surface it.
- Drivers (slice 1).

## Slice done conditions

Beyond CI, review and the project DoD. Each is a runtime test with the stub driver, as the existing `transaction-activity.*` tests are:

- [ ] Released savepoint: `SAVEPOINT sp_1`, statement, `RELEASE SAVEPOINT sp_1`; middleware sees a `'transaction'` activity beneath the outer one, finalized with the outer outcome. Rolled-back savepoint: finalized `rolled-back` before `rollback()` resolves, and the outer commit is `committed`.
- [ ] A savepoint inside a savepoint gets the next name, and the counter is per connection.
- [ ] `savepoint()` with an open sibling rejects `TRANSACTION_ALREADY_OPEN` naming it, with nothing sent.
- [ ] A statement and `commit()` on a level with an open child reject `TRANSACTION_SUSPENDED` with the child's activity ID; the level works again after the child settles.
- [ ] `rollback()` on a level with an open child closes the child; later work on it rejects `TRANSACTION_CLOSED`.
- [ ] Work on a savepoint after the outer transaction settled rejects `TRANSACTION_CLOSED`.
- [ ] A failed `ROLLBACK TO` invalidates every level; on an owned transaction (`runtime.transaction()`), the connection is destroyed when the outer rolls back.
- [ ] A failed `RELEASE` followed by a successful `rollback()` finalizes the savepoint and its statements `rolled-back`, and leaves the parent usable and its commit `committed`.
- [ ] A refused start (`activityStarted` throws) and a failed `SAVEPOINT` both reject `savepoint()` and leave the parent usable.
- [ ] `savepoint()` on an activity handle under a transaction and under a savepoint; absent on runtime and connection handles.
- [ ] Existing `sql-runtime` tests pass unchanged.

## Edge cases investigated

- **`RuntimeConnection.transaction()` with an open transaction** has no guard today (only the connection-route handle has one). Unchanged in this slice.
- **The outer transaction's timeout** closes the outer level; rule 6 extends that to its savepoints. An outer `rollback()` from the timeout path closes open savepoints by rule 5.

## Plan (one dispatch)

**D1: runtime savepoints, with docs.**

- **Outcome:** everything in § Chosen design and § Slice done conditions.
- **Builds on:** `main` with slice 1 (driver `savepoint()`) and slice 2 (savepoint activity).
- **Hands to:** slice 4 (`withSavepoint`, Postgres facade) and slice 6 (ORM).
- **Focus:** tests first, then the implementation, then the docs. Suggested commits:
  1. Stub-driver support and tests, with the implementation.
  2. Docs.
  3. Slice artifacts: the orchestrator commits these.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter @internal/sql-runtime test` and `pnpm --filter @internal/sql-runtime lint`.
  - `pnpm --filter` test for every other package whose stubs changed.
  - `pnpm lint:deps`.
- **Size:** planned at about 570 changed lines (about 200 production, 350 tests, 20 docs). Round 1 came in at about 715 (310 production, 390 tests, 15 docs); round 2 tightens the tests without dropping any done condition.

## Amendments

- **D1 R1 → R2: a failed `RELEASE` does not end the savepoint activity.** The first version of rule 2 ended it `{ by: 'release', outcome: 'failed' }`. That contradicts slice 2's rule 3: after a failed `RELEASE` and a successful `ROLLBACK TO`, the work was undone, so the savepoint must finalize `rolled-back`. Corrected by the orchestrator against slice 2's spec; the implementation followed the earlier text.
- **D1 review R1: the connection is guarded too.** Rule 5 now covers statements sent on the connection while its transaction is open (reviewer F1), closed levels report their closed state ahead of `TRANSACTION_SUSPENDED` (F3), and § Errors states when `savepointId` is `undefined`. The orchestrator had first told the implementer to leave connection statements for slice 4; that was wrong, because the statement is finalized with the wrong outcome.
- **After the PR opened: one wrapper for every level.** The first implementation had a separate savepoint wrapper with its own settle code, and a `TransactionLevel` class that kept a second copy of state the transaction wrapper already held. That did not use the single `SqlTransaction` shape decision 4 chose so the settle logic is written once. The operator asked for one wrapper; § Chosen design now requires it.
- **After the PR opened: one stack per connection.** The per-level records with links to the enclosing level and the open child were replaced by one stack of open levels per connection, which the project plan described as "tracking of the innermost open level per connection". Requested by the operator.

## References

- Project spec: decisions 3, 6, 8, 9; cross-cutting requirements.
- Slice 1: `slices/driver-savepoints/spec.md`. Slice 2: `slices/nested-transaction-activity/spec.md` (§ Notes for slice 3).
