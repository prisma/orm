# Slice: driver-savepoints

Parent project: `projects/nested-transactions/`. Outcome: every SQL driver can open, release and roll back savepoints, nested to any depth (project plan, slice 1).

## At a glance

`SqlTransaction` gains a required `savepoint(name): Promise<SqlTransaction>`, implemented by the Postgres, MySQL and SQLite drivers. On the returned savepoint, `commit()` sends `RELEASE SAVEPOINT name` and `rollback()` sends `ROLLBACK TO SAVEPOINT name`. Nothing above the driver calls it yet; slice 3 (`runtime-savepoints`) builds on it.

## Chosen design

From project spec decisions 4 and 5:

```ts
// packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts
export interface SqlTransaction extends SqlQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<SqlTransaction>;
}
```

Behaviour of every driver:

| Call | On a transaction | On a savepoint `name` |
|---|---|---|
| `savepoint(n)` | sends `SAVEPOINT n`, returns a savepoint `n` | sends `SAVEPOINT n`, returns a savepoint `n` stacked on this one |
| `commit()` | `COMMIT` (unchanged) | `RELEASE SAVEPOINT name` |
| `rollback()` | `ROLLBACK` (unchanged) | `ROLLBACK TO SAVEPOINT name` |
| `query` / `execute` | unchanged | run on the same connection, as the transaction does |

The savepoint name is checked before anything is sent. A name that is not a plain identifier (`/^[A-Za-z_][A-Za-z0-9_]*$/`) is rejected with an error and no statement reaches the database. The runtime (slice 3) generates names from a counter, so this check never fails for runtime-generated names; it exists so that no string reaches the SQL text unchecked. Put the check in one function next to the interface in `@internal/sql-relational-core` (all three drivers already depend on that package at runtime), and throw an error of the same kind the drivers use for other invalid arguments (compare `validatePostgresIsolationLevel`).

Per driver:

- **Postgres** (`packages/3-targets/postgres/3-driver/src/postgres-driver.ts`): each of the three statements takes the client query lock (`acquireClientQueryLock`), checks the client with `assertClientUsable` and maps errors with `rethrowClientError`, exactly as `BEGIN`, `COMMIT` and `ROLLBACK` do. Settling a savepoint never touches `SharedTransactionState`: `open` stays `true` and `unfinishedOnServer` is unchanged, so the cursor portal-protection wrap and connection release behave as they do inside a plain transaction. Only the outer transaction's `commit()`/`rollback()` clears that state.
- **MySQL** (`packages/3-targets/mysql/1-mysql/3-driver/src/core/runtime/mysql-driver.ts`): the statements run through `underLock`, as `commit()` and `rollback()` do.
- **SQLite** (`packages/3-targets/sqlite/3-driver/src/sqlite-driver.ts`): `db.exec`, with errors mapped by `normalizeSqliteError`, as `commit()` and `rollback()` do.

Every other implementer of `SqlTransaction` in the repo (test stubs, for example `packages/2-sql-family/5-runtime/test/closed-runtime-stub.ts`) gains the method so the workspace typechecks. Stubs only; no runtime production code changes.

## Coherence rationale

The interface method and its three implementations are one change: making the method required breaks every implementer at once, so they land together, with tests that pin the same behaviour on each database.

## Scope

**In:**

- `SqlTransaction.savepoint` and the name check in `relational-core`.
- `savepoint()` on the Postgres, MySQL and SQLite driver transactions, and on their savepoints.
- Driver tests on PGlite (Postgres), live MySQL (`*.live.test.ts`, like `transaction-isolation.live.test.ts`) and SQLite. On each: a released savepoint keeps its work, a rolled-back savepoint loses its work while the outer transaction's work commits, a savepoint inside a savepoint, and a rejected name sends nothing. On Postgres also: a failing statement inside a savepoint puts the transaction in the aborted state, `rollback()` on the savepoint recovers it, and the outer transaction then runs a statement and commits; and the outer transaction's state (`open`) is still set after a savepoint settles.
- Test stubs that must implement the new method.

**Out:**

- Anything in `packages/2-sql-family/5-runtime` production code, the ORM, facades and docs (slices 3–6).
- `packages/1-framework/**` (slice 2 runs in parallel there).
- Removing or changing the Postgres per-client query lock (project non-goal).
- Guarding use of a settled savepoint, name generation, concurrency rules: the runtime owns those (slice 3).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Savepoint name interpolated into SQL text | Rejected unless a plain identifier, before sending | `drive/calibration/failure-modes.md` F34: a string interpolated into SQL with only the type system as a check. |
| Postgres aborted transaction (`25P02`) after a failed statement | `ROLLBACK TO SAVEPOINT` recovers it | The project DoD requires this recovery; the driver test proves the primitive works. |
| Postgres `SharedTransactionState` | Unchanged by savepoints | A savepoint that cleared `open` would let the cursor wrap send its own `BEGIN…COMMIT` inside the user's transaction. |

## Slice-specific done conditions

- [ ] The workspace typechecks with `savepoint` required; no `SqlTransaction` implementer declares it optional.

## Open Questions

None.

## Plan

One dispatch.

### D1 — driver savepoints

- **Outcome:** the interface method, the name check, the three driver implementations and their tests, as described above.
- **Builds on:** `origin/main`.
- **Hands to:** slice 3, `runtime-savepoints`.
- **Focus:** the files named in Chosen design and their test directories.
- **Validation gate:**
  - `pnpm build` (the interface is consumed by other packages), then `pnpm typecheck`.
  - `pnpm --filter <pkg> lint` and `pnpm --filter <pkg> test` for `@internal/sql-relational-core`, `@internal/driver-postgres`, `@internal/driver-mysql`, `@internal/driver-sqlite`, and every package whose test stubs changed.
  - The MySQL live tests touched, run against the live database (see `transaction-isolation.live.test.ts` for how it connects); if no live MySQL is reachable locally, say so in the report rather than skipping silently.
  - `pnpm lint:deps`.

## References

- Parent project: `projects/nested-transactions/spec.md` (decisions 4, 5; Adapter impact), `projects/nested-transactions/plan.md` (slice 1).
- Linear: skipped by the operator.
- `drive/calibration/failure-modes.md` F34.
