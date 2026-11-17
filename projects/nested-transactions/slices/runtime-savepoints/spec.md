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

**One wrapper for the transaction and every savepoint** (project spec decision 4). The driver gives a transaction and a savepoint the same shape, `SqlTransaction`, so the runtime wraps both with the same code. One function builds the `RuntimeTransaction` for a transaction or savepoint from its driver `SqlTransaction`, and its `commit()`, `rollback()`, `savepoint()` and statement members serve the outer transaction and every savepoint. Only the real differences between the outer transaction and a savepoint branch inside it:

- the settlement of a successful `commit()`: `{ by: 'commit' }` on the outer transaction, `{ by: 'release' }` on a savepoint;
- a failed `commit()`: the outer transaction ends its activity `failed`, a savepoint stays open (rule 8);
- a failed `rollback()`: a savepoint invalidates the stack (rule 7);
- what only the outer transaction has: the deadline and timeout, the connection's open-transaction bookkeeping, and the settlement `withTransaction` reads.

1. **`RuntimeTransaction.savepoint(): Promise<RuntimeTransaction>`** (project spec decision 8). Required, no options. The returned savepoint is a `RuntimeTransaction` itself, so `savepoint()` on it stacks another savepoint.
   - It calls the driver's `SqlTransaction.savepoint(name)` (slice 1) on the driver transaction it is called on.
   - On the returned savepoint, `commit()` calls the driver savepoint's `commit()` (`RELEASE SAVEPOINT`) and `rollback()` calls its `rollback()` (`ROLLBACK TO SAVEPOINT`).
   - Statements on the savepoint run on the driver savepoint and are parented to the savepoint's activity, as statements on a transaction are parented to the transaction's activity today.
   - `signal` is the outer transaction's signal.
2. **The savepoint activity** (project spec decision 6, slice 2). `startTransactionActivity` runs with the parent's activity as parent, before `SAVEPOINT` is sent. Settlements:
   - `commit()` succeeds: `{ by: 'release', outcome: 'succeeded' }`.
   - `commit()` fails: the activity is not ended. The savepoint is still open on the database, so it stays open in the runtime too (rule 8).
   - `rollback()` succeeds or fails: `{ by: 'rollback', outcome, commitAttempted }`, where `commitAttempted` is true when `commit()` was called first. A savepoint rolled back after a failed `RELEASE` is therefore finalized `rolled-back` (slice 2, rule 3).
   - `SAVEPOINT` fails: `{ by: 'rollback', outcome: 'failed', commitAttempted: false }`, and `savepoint()` rejects with the driver error. The parent stays usable.
   - An `activityStarted` hook throws: no `SAVEPOINT` is sent, `savepoint()` rejects, and the parent stays usable (decision 9).
3. **`savepoint()` on an activity handle** opened on a transaction or on a savepoint. The new savepoint's activity is a child of the handle's activity. Handles opened on the runtime or on a connection have no `savepoint`. `ActivityHandle` gains an optional `savepoint?: () => Promise<RuntimeTransaction>`, documented like the existing optional `transaction`.
4. **Names.** `sp_<n>`, from a counter per transaction that starts at 1 at `BEGIN` and only goes up. `COMMIT` and `ROLLBACK` remove every savepoint of the transaction, so the next transaction on the connection starts at `sp_1` again. Only one savepoint is open on a transaction or savepoint at a time, so names never collide within a transaction.
**One stack per transaction.** Only one savepoint is open on a transaction or savepoint at a time, so the open ones always form one chain: the outer transaction, then `sp_1`, then `sp_2`. The runtime keeps that chain as one stack per transaction, created at `BEGIN`. Each transaction and savepoint holds a reference to the stack and its own entry, and checks by identity whether its entry is the top before doing anything:

- closed if the stack is invalidated or its entry is no longer on the stack;
- allowed if its entry is the top;
- suspended otherwise, and the error names the top of the stack, the innermost open savepoint.

**Implementation shape.** The stack is a small class of its own, unit-tested on its own, with only these members:

```ts
class TransactionStack {
  push(entry: StackEntry): void
  pop(): StackEntry
  get top(): StackEntry | undefined
  includes(entry: StackEntry): boolean
  nextSavepointName(): string   // the counter of rule 4
  invalidate(): void            // rule 7
  get invalidated(): boolean
}
```

A stack entry carries the savepoint name (`undefined` for the outer transaction), the activity once started, the pending commit finalization, and one `state` field that replaces separate flags:

```ts
type TransactionState =
  | 'open'
  | 'committing'      // COMMIT or RELEASE sent, no answer yet
  | 'release-failed'  // RELEASE failed; the savepoint is still open (rule 8)
  | 'rolling-back'
  | 'committed'
  | 'rolled-back';
```

`commitAttempted` in an activity's settlement is read from the state at the time `rollback()` starts. What only the outer transaction has (the deadline, the open-transaction bookkeeping, the settlement `withTransaction` reads) is built where the transaction begins, outside the wrapper, so the wrapper branches only on the differences listed above. `rollback()` after a successful commit keeps main's behaviour: it sends nothing, waits for the commit's finalization and resolves.

5. **The guard** (decision 3). A transaction or savepoint has at most one open savepoint directly above it on the stack.
   - `savepoint()` on a transaction or savepoint that is not the top rejects with `RUNTIME.TRANSACTION_ALREADY_OPEN`. The message names the top of the stack (`sp_<n>`). No `SAVEPOINT` is sent and no activity is started.
   - A statement or `commit()` on a transaction or savepoint that is not the top rejects with the new `RUNTIME.TRANSACTION_SUSPENDED`. Its details carry the activity ID of the top of the stack. Nothing is sent to the driver. It is usable again once the savepoints above it have settled.
   - A statement sent on the connection while its transaction is open counts as a statement on the outer transaction, so it is refused the same way. Otherwise it would run inside the savepoint on the database while being parented to the outer activity.
   - Once a transaction or savepoint is closed (settled, invalidated or timed out), work on it reports that, not `RUNTIME.TRANSACTION_SUSPENDED`.
   - `rollback()` on a transaction or savepoint that has an open savepoint above it rejects with `RUNTIME.TRANSACTION_SUSPENDED`, like a statement, and nothing is sent. Every savepoint settles before the transaction or savepoint below it settles.
   - Two exceptions, where the outer transaction is closed without its caller's choice: after its timeout has fired, its `rollback()` is allowed, and so is ending it because its connection is released or destroyed while it is open. Then each open savepoint is popped and closed first, innermost first: its activity ends `{ by: 'rollback', outcome, commitAttempted: false }`, with the outcome of the outer rollback, and later work on it rejects with `RUNTIME.TRANSACTION_CLOSED`. This keeps `withTransaction`'s timeout path unchanged: it rolls back while the callback, and a savepoint the callback opened, may still be running.
6. **Closed savepoints.** A savepoint refuses work with `RUNTIME.TRANSACTION_CLOSED` once it has settled, or once the transaction or a savepoint below it has settled, been invalidated, or been closed by the outer transaction's timeout. This covers the note slice 2 left for this slice: the framework accepts work beneath a savepoint after the outer `commit()` or `rollback()` has been called, so the runtime must refuse it.
7. **A failed `ROLLBACK TO` invalidates the stack**, so every savepoint below it and the outer transaction are closed (decision 9).
   - The savepoint's `rollback()` rejects with the driver error.
   - Every savepoint below it and the outer transaction then refuse statements, `savepoint()` and `commit()` with `RUNTIME.TRANSACTION_CLOSED`, without sending anything.
   - The outer transaction's `rollback()` rejects with `RUNTIME.TRANSACTION_CLOSED`, without sending `ROLLBACK`, and its activity ends `{ by: 'rollback', outcome: 'failed', commitAttempted }`. The settle code that exists today then destroys the connection: `withTransaction` after a failed rollback, and the owned transaction (`owned-transaction.ts`) after a failed rollback.
8. **A failed `RELEASE`.** The savepoint's `commit()` rejects with the driver error, and the savepoint is still open: its activity keeps running and the parent stays suspended. `rollback()` on it then sends `ROLLBACK TO`. If that succeeds, the savepoint is finalized `rolled-back` and the parent is usable again. The decision 9 sequence for a nested callback (rollback after a failed release, then throw `RUNTIME.TRANSACTION_COMMIT_FAILED`) is `withSavepoint`'s job in slice 4; this slice provides the operations it needs.
9. **Top-level behaviour is unchanged.** `withTransaction`, its options, timeout, abort handling and error codes stay as they are. Its guarded handle drops `savepoint` as it drops `transaction`; slices 4 and 6 decide how a guarded context exposes it.

### Errors

- `RUNTIME.TRANSACTION_SUSPENDED`: new factory next to `transactionClosedError` and `transactionAlreadyOpenError`. Message names the open savepoint. Details: `{ savepointId }`, the open savepoint's activity ID. While the savepoint's `activityStarted` hooks are still running it has no activity ID yet, and `savepointId` is `undefined`; the message still names it.
- `RUNTIME.TRANSACTION_ALREADY_OPEN`: the existing code and factory; the savepoint case gets its own message that names the open savepoint.

## Coherence rationale

The savepoint, its activity, the guard and the invalidation rules are one state machine on one transaction. Splitting them would ship a `savepoint()` that lets a sibling's `ROLLBACK TO` undo another sibling's work. The error-reference entries describe the codes this slice adds, and the subsystem doc and ADR statements that "transactions do not nest" stop being true in this slice.

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
- [ ] A savepoint inside a savepoint gets the next name, and the next transaction on the connection starts at `sp_1` again.
- [ ] `savepoint()` with an open sibling rejects `TRANSACTION_ALREADY_OPEN` naming it, with nothing sent.
- [ ] A statement and `commit()` below the top of the stack reject `TRANSACTION_SUSPENDED` with the activity ID of the top; they work again once the savepoints above have settled.
- [ ] `rollback()` with an open savepoint above it rejects `TRANSACTION_SUSPENDED` with nothing sent. After the outer timeout, the outer `rollback()` closes the open savepoints innermost first, and later work on them rejects `TRANSACTION_CLOSED`.
- [ ] `TransactionStack` has its own unit tests for push, pop, top, the counter and invalidation.
- [ ] Work on a savepoint after the outer transaction settled rejects `TRANSACTION_CLOSED`.
- [ ] A failed `ROLLBACK TO` closes the outer transaction and every savepoint; on an owned transaction (`runtime.transaction()`), the connection is destroyed when the outer rolls back.
- [ ] A failed `RELEASE` followed by a successful `rollback()` finalizes the savepoint and its statements `rolled-back`, and leaves the parent usable and its commit `committed`.
- [ ] A refused start (`activityStarted` throws) and a failed `SAVEPOINT` both reject `savepoint()` and leave the parent usable.
- [ ] `savepoint()` on an activity handle under a transaction and under a savepoint; absent on runtime and connection handles.
- [ ] Existing `sql-runtime` tests pass unchanged.

## Edge cases investigated

- **`RuntimeConnection.transaction()` with an open transaction** has no guard today (only the connection-route handle has one). Unchanged in this slice.
- **The outer transaction's timeout** closes the outer transaction; rule 6 extends that to its savepoints. An outer `rollback()` from the timeout path closes open savepoints by the exception in rule 5.

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
- **After the PR opened: a parent settles only after its savepoints.** `rollback()` on a transaction or savepoint with an open savepoint above it now rejects `TRANSACTION_SUSPENDED`, instead of closing the open savepoints. The outer transaction keeps that behaviour only after its timeout and when its connection is released or destroyed. Errors that name an open savepoint name the top of the stack. The stack becomes a class with push, pop and top, and one state field replaces the wrapper's flags. Requested by the operator; making `rollback()` reject after a commit is left to a follow-up PR, because the ORM's `runInTransaction` relies on main's behaviour.
- **After the PR opened: a savepoint-name counter per transaction.** The counter per connection was replaced by one kept with the transaction's stack. Savepoints end with their transaction, so names do not need to be unique across transactions. The project spec and plan are amended to match. Requested by the operator.

## References

- Project spec: decisions 3, 6, 8, 9; cross-cutting requirements.
- Slice 1: `slices/driver-savepoints/spec.md`. Slice 2: `slices/nested-transaction-activity/spec.md` (§ Notes for slice 3).
