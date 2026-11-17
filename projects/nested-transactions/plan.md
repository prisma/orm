# Nested transactions — Plan

**Spec:** `projects/nested-transactions/spec.md`
**Linear Project:** skipped by the operator.

## At a glance

The whole project is about 2,500–2,700 changed lines, counting production code, tests and docs. That is over the operator's 1,000–1,500 limit for a single delivery. It is split into six slices of about 500 lines or fewer each.

Slices 1–3 build the substrate: the drivers, the framework activity and the runtime. Slice 4 gives users `tx.transaction(cb)` on Postgres. Slices 5 and 6 extend that to the other facades and to ORM writes.

```mermaid
flowchart LR
  S1["1. driver-savepoints<br/>~350"] --> S3["3. runtime-savepoints<br/>~570"]
  S2["2. nested-transaction-activity<br/>~430"] --> S3
  S3 --> S4["4. postgres-nested-transactions<br/>~540"]
  S3 --> S6["6. orm-writes-in-savepoints<br/>~300"]
  S4 --> S5["5. other-facades<br/>~400"]
```

Line counts are estimates, measured against the existing code. For example:
- `PostgresTransactionImpl.commit`/`rollback` is about 25 lines.
- The SQL runtime's transaction tests are about 1,300 lines across `transaction-activity.*.test.ts` and `with-transaction.failures.test.ts`.
- The SQLite facade's `transaction.test.ts` is 268 lines.

## Composition

### Parallel group A (start together)

- **Slice `driver-savepoints`** (~350: ~120 production, ~230 tests): `projects/nested-transactions/slices/driver-savepoints/`
  - **Outcome:** every SQL driver can open, release and roll back savepoints, nested to any depth.
  - **Builds on:** none.
  - **Hands to:** a required `SqlTransaction.savepoint(name): Promise<SqlTransaction>` on the Postgres, MySQL and SQLite drivers. On a savepoint, `commit()` sends `RELEASE` and `rollback()` sends `ROLLBACK TO`.
  - **Focus:**
    - `driver-types.ts` and the three driver packages.
    - Driver-level tests: PGlite for Postgres, live MySQL, and SQLite. They cover a savepoint inside a savepoint, and Postgres recovering from the aborted state after `ROLLBACK TO`.
    - The Postgres statements take the client query lock and keep `SharedTransactionState.open` set.
    - Nothing above the driver uses the method yet.

- **Slice `nested-transaction-activity`** (~430: ~70 production, ~300 tests, ~60 docs): `projects/nested-transactions/slices/nested-transaction-activity/`
  - **Outcome:** the framework runs a transaction activity beneath another transaction activity, with the finalization rules of spec decision 6.
  - **Builds on:** none.
  - **Hands to:** `startTransactionActivity` accepting a transaction parent, plus a release settlement:
    - **Released:** a savepoint hands its children and its statement failures to the parent.
    - **Rolled back:** a savepoint finalizes its children right away as `rolled-back` and passes no failures up.
  - **Focus:**
    - `framework-components` `transaction-activity.ts` and `test/transaction-activity.test.ts`: finalize order and outcomes for released, rolled-back and doubly nested savepoints.
    - The finalization section of the Runtime & Middleware subsystem doc, and the ADR 271 amendment.
    - No runtime calls it yet.

### Stack (after group A)

3. **Slice `runtime-savepoints`** (~570: ~200 production, ~350 tests, ~20 docs): `projects/nested-transactions/slices/runtime-savepoints/`
   - **Outcome:** the SQL runtime opens savepoints on an open transaction, enforces the fail-fast guard, and settles them with the error behaviour of spec decisions 3 and 9.
   - **Builds on:** slice 1's driver `savepoint()` and slice 2's nested transaction activity.
   - **Hands to:**
     - `RuntimeTransaction.savepoint()`.
     - `savepoint()` on an activity handle opened on a transaction.
     - The savepoint-name counter per transaction, and tracking of the innermost open level per connection.
     - `RUNTIME.TRANSACTION_SUSPENDED`, and savepoint wording for `RUNTIME.TRANSACTION_ALREADY_OPEN`.
     - Every level invalidated after a failed `ROLLBACK TO`.
   - **Focus:**
     - `packages/2-sql-family/5-runtime`: `sql-runtime.ts`, `activity-handle.ts`, the transaction state.
     - Runtime tests with stub drivers, as the existing `transaction-activity.*` tests do.
     - The error reference entries.
     - No facade or ORM change.

4. **Slice `postgres-nested-transactions`** (~540: ~180 production, ~330 tests, ~30 docs): `projects/nested-transactions/slices/postgres-nested-transactions/`
   - **Outcome:** Postgres users can call `tx.transaction(cb)`, with every behaviour in the spec.
   - **Builds on:** slice 3's `RuntimeTransaction.savepoint()` and guard.
   - **Hands to:** `withSavepoint(txCtx, fn, buildMembers)` exported from the SQL runtime, with the Postgres facade using it.
   - **Focus:**
     - `withSavepoint`, sharing the guarded queryable and settle code with `withTransaction`.
     - `postgres-members.ts` and `PostgresTransactionContext`.
     - `withSavepoint` unit tests.
     - PGlite integration tests: the spec's At a glance example, aborted-state recovery, and every guard and error path from the project DoD.
     - The subsystem doc's `withTransaction` section.

### Parallel group B (after slice 4 and after slice 3, respectively)

- **Slice `other-facades`** (~400: ~100 production, ~300 tests): `projects/nested-transactions/slices/other-facades/`
  - **Outcome:** `tx.transaction(cb)` works on the MySQL, SQLite and Supabase facades the same way it does on Postgres.
  - **Builds on:** slice 4's `withSavepoint`.
  - **Hands to:** every SQL facade exposing `tx.transaction(cb)`.
  - **Focus:**
    - Wiring and transaction context types in `mysql.ts`, `sqlite.ts` and `supabase.ts`.
    - The At a glance example as a test on live MySQL, on SQLite, and on Supabase over PGlite.
    - The review of the `withSavepoint` shape required by spec decision 10. Any change to the helper lands here.

- **Slice `orm-writes-in-savepoints`** (~300: ~30 production, ~250 tests, ~15 docs): `projects/nested-transactions/slices/orm-writes-in-savepoints/`
  - **Outcome:** a multi-statement ORM write inside a transaction runs in its own savepoint.
  - **Builds on:** slice 3's `savepoint()` on `RuntimeTransaction` and on the activity handle. It does not need slice 4: its tests open the transaction through the runtime.
  - **Hands to:** project close.
  - **Focus:**
    - `sql-orm-client`: `savepoint?()` on the structural `RuntimeQueryable`, and `run-graph`'s choice between `transaction(options)`, `savepoint()` and running flattened.
    - ORM integration tests on Postgres, MySQL and SQLite.
    - The subsystem doc's paragraph on ORM writes.

## Dependencies (external)

- [ ] The live MySQL database used by the `*.live.test.ts` files: available in CI, already used by `transaction-isolation.live.test.ts`.
- [ ] The query-lock question, under discussion in a separate session. It doesn't block: slice 1 uses the lock as `BEGIN`, `COMMIT` and `ROLLBACK` do. If that discussion removes the lock, the savepoint statements lose it in the same change.

## Sequencing rationale

- **Split to fit the size limit.** The operator capped deliveries at about 500 changed lines per slice once the project went past 1,500 lines. The substrate therefore ships in three slices (1–3) that users don't see until slice 4. That is an accepted exception to "Valuable": each one lands a tested layer with a named outcome, and the spec's transitional-shape constraints allow layers to land before anything uses them.
- **Six slices, more than the usual four.** This follows from the size limit, not from two projects bundled into one. There is one purpose, and every slice serves it.
- **Slices 1 and 2 run in parallel.** Drivers and the framework activity share no code.
- **Slice 6 starts as soon as slice 3 merges, in parallel with slice 4.** It needs only the runtime's `savepoint()`, not `withSavepoint` or a facade.
- **Slice 5 waits for slice 4.** It reuses `withSavepoint`, and it is where the helper's shape is reviewed.
