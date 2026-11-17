# Slice: handle-transaction-callback

**Project:** `projects/nested-transactions/` (slice 3b, between slices 3 and 4). **Linear:** skipped by the operator.

## Outcome

A transaction started from an activity handle goes through `withTransaction`, and the owned transaction is removed. The rules for giving a connection back after a transaction exist only in `withTransaction`.

## At a glance

```ts
// before: the handle returns a transaction on a connection the transaction owns
const tx = await handle.transaction(options)
try { const r = await work(tx); await tx.commit(); return r } catch (e) { await tx.rollback(); throw e }

// after: a callback, settled by withTransaction
const r = await handle.transaction((tx) => work(tx), options)   // the transaction activity stays beneath handle's activity
```

## Chosen design

1. **`ActivityHandle.transaction` becomes a callback form**: `transaction?: <R>(fn: (tx: TransactionContext) => PromiseLike<R>, options?: RuntimeTransactionOptions) => Promise<R>`. It is built on `withTransaction`, so `fn` gets the same guarded context `db.transaction(cb)` gets. Which handles have the member does not change: a handle on the runtime or on a connection with no open transaction has it; a handle under a transaction, and a `withTransaction` context's handle, do not (slice 6 changes that).
2. **`withTransaction` takes a parent activity**, so the transaction activity starts beneath the handle's activity, as it does today. How the parent reaches `beginTransactionOn` is the implementer's choice, with the smallest change; the facades' `db.transaction(cb)` does not gain a parameter.
3. **Where the connection comes from**, per handle scope. In every case, giving the connection back is `withTransaction`'s `release()` / `destroy()`:
   - **On the runtime:** a new connection opened beneath the handle's activity, as `beginOwnedTransactionBeneath` does today.
   - **On a connection the caller holds:** that connection, with `release()` doing nothing, so `withTransaction` leaves it held after a commit or a rollback. `destroy()` is passed through, so after a failed `BEGIN`, a failed `ROLLBACK` or a timeout the connection is destroyed and never returns to the pool. A later `release()` by the code that took the connection then rejects, as releasing any destroyed connection does. The guard that rejects a second transaction on the connection (`RUNTIME.TRANSACTION_ALREADY_OPEN`) stays. The operator chose this as the smallest change; these handles are not public API.
   - **Supabase `forRole`:** the role session from `openRoleConnection(binding, { activityParent })`. Its `release()` already resets the role and releases the connection.
4. **The owned transaction is removed:** `owned-transaction.ts`, `beginOwnedTransactionBeneath`, `ownTransaction` (and its mention in the runtime README), and the `self` reference in `runtime-transaction.ts` that the `Object.create` wrapper needed.
5. **`rollback()` after a commit rejects `RUNTIME.TRANSACTION_CLOSED`**, on `OuterTransaction` and `Savepoint`, whether the commit resolved or rejected with a hook error after the database committed. It sends nothing. `withTransaction` never calls `rollback()` after a commit, and `runInTransaction` is gone. Main's three tests for this case (two in `with-transaction.failures.test.ts`, one in `transaction-activity.inside.test.ts`) are changed to expect the rejection.
6. **The ORM's implicit transaction uses the callback.** `run-graph.ts` calls `handle.transaction((tx) => runNodesInOrder(..., tx), implicitTransactionOptions)`; `runInTransaction` and the `settlementOf` import are removed. The ORM's runtime types in `sql-orm-client/src/types.ts` follow. **Confirmed by the operator:** the ORM's settle failures change to `withTransaction`'s codes, as `db.transaction(cb)` reports them, with the original error as `cause`:
   - a failed `COMMIT`: `RUNTIME.TRANSACTION_COMMIT_FAILED` (today the driver error);
   - a failed `ROLLBACK` after a statement error: `RUNTIME.TRANSACTION_ROLLBACK_FAILED` (today the rollback error);
   - a failed `COMMIT` then a failed `ROLLBACK`: `RUNTIME.TRANSACTION_COMMIT_FAILED` (today the rollback error).

## Coherence rationale

Every caller of the returning `transaction()` has to switch to the callback before the owned transaction can be removed, and `rollback()` after a commit can only reject once no caller relies on it. So the handle, its three callers (ORM, Supabase, held connections), the removal and the `rollback()` change land together.

## Scope

**In:**

- `packages/2-sql-family/5-runtime/src`: `sql-runtime.ts`, `activity-handle.ts`, `runtime-transaction.ts`, `owned-transaction.ts` (deleted), `README.md`.
- `packages/3-extensions/sql-orm-client/src`: `run-graph.ts`, `types.ts`.
- `packages/3-extensions/supabase/src/runtime/supabase-runtime.ts`.
- Tests and stubs that call or implement the handle's `transaction()` (runtime, Supabase, sql-orm-client, `test/integration/.../runtime-helpers.ts`), the three `rollback()`-after-commit tests, and slice 3's test that a failed `ROLLBACK TO` destroys an owned connection.
- Owned-connection tests in `client-activity.transaction.test.ts`: delete a test where `withTransaction`'s existing tests already cover the same rule; keep or rewrite the ones that check handle-specific behaviour (parent activity, the scopes that have the member, the held-connection case, the second-transaction guard).
- Docs: the subsystem doc's `transaction()` bullets (`4. Runtime & Middleware Framework.md` :320, :364, :370, :721) and ADR 271 (:32-40, :136, :141), describing the callback form. ADR 271's "transactions do not nest" sentence stays for slice 6.

**Out:**

- `packages/1-framework/**`.
- `withSavepoint`, any facade `tx.transaction(cb)` (slices 4, 5), `transaction()` on handles under a transaction, and savepoints for ORM writes (slice 6).
- `withTransaction`'s existing settle rules, options, timeout, abort handling and error codes; only the parent activity is added.

## Slice done conditions

Beyond CI, review and the project DoD:

- [ ] `owned-transaction.ts`, `beginOwnedTransactionBeneath`, `ownTransaction` and the `self` reference no longer exist; `grep` finds no references outside `projects/`.
- [ ] A handle's `transaction(fn)` on the runtime starts its transaction activity beneath the handle's activity, commits and releases the connection; when `fn` throws it rolls back, releases, and rethrows.
- [ ] On a held connection, `transaction(fn)` leaves the connection held after commit and after rollback, destroys it after a failed `ROLLBACK`, and a second one while the first is open rejects `TRANSACTION_ALREADY_OPEN`.
- [ ] Supabase `forRole` transactions run through the callback, and the role session is released (role reset) after they settle.
- [ ] `rollback()` after a resolved commit and after a commit that rejected with a hook error rejects `TRANSACTION_CLOSED` and sends nothing.
- [ ] A run-graph test shows a failed `COMMIT` in the ORM's implicit transaction rejecting `RUNTIME.TRANSACTION_COMMIT_FAILED` with the driver error as `cause`.
- [ ] Existing ORM and Supabase integration tests pass.

## Size

About 700 changed lines, over the 500-line cap; the operator accepted it as one slice. About 190 production lines (about 110 of them removed), about 500 test lines, about 25 docs.

## Plan (one dispatch)

**D1: handle `transaction()` as a callback on `withTransaction`.**

- **Outcome:** everything in § Chosen design and § Slice done conditions.
- **Builds on:** slice 3 (`OuterTransaction`, `Savepoint`, `transaction()` on a `RuntimeTransaction`).
- **Hands to:** slice 4 (`withTransaction` with a parent) and slice 6 (the handle's callback `transaction()`).
- **Focus:** tests first. Suggested commits: (1) runtime: `withTransaction` parent, callback handle, owned transaction removed, `rollback()` after commit, with tests; (2) ORM and Supabase callers with tests; (3) docs. Commits may merge where a split leaves the workspace failing typecheck.
- **Validation gate:**
  - `pnpm build`, then `pnpm typecheck`.
  - `pnpm --filter @internal/sql-runtime test`, `pnpm --filter @internal/sql-orm-client test`, and the Supabase extension's package tests.
  - `pnpm --filter` lint for the three packages, and `pnpm lint:deps`.
  - `pnpm test:integration` (the ORM and Supabase integration tests use the handle's `transaction()`).

## Amendments

- **D1 review R1: a held connection destroyed by the handle's transaction stays destroyed.** After a failed `BEGIN`, a failed `ROLLBACK` or a timeout, the transaction destroys the held connection, so it never returns to the pool; a later `release()` on it rejects. The operator chose this over leaving the connection alone (a connection in an unknown state would return to the pool) and over making `release()` after `destroy()` resolve.
- **D1 R1: the parent reaches `beginTransactionOn` through the connection.** A route's `transaction` returns a `ConnectionProvider` whose connection begins transactions beneath the handle's activity; `withTransaction`'s signature does not change.

## References

- Project spec: decisions 8, 9; cross-cutting requirements. Project plan: slice 3b.
- Slice 3: `slices/runtime-savepoints/spec.md`, PR #31053 (notes on `Object.create`, the owned transaction, `rollback()` after a commit).
