# Slice 2b — MySQL migrations, db verify, db sign; migration atomicity stated by the target

**Linear:** [TML-3704](https://linear.app/prisma-company/issue/TML-3704) · **Branch:** `tml-3704-mysql-migrations-verify-sign` (stacked on 2a) · **Project:** [`../../spec.md`](../../spec.md), decision 6 · **Research:** `wip/slice2-research.md` sections 2–4 (local)

## At a glance

Against an empty MySQL 8.4 database, with the project's example contract:

```text
$ prisma migration plan --name init
$ prisma db migrate
$ prisma db verify
✔ Database matches the contract
$ prisma db sign
```

`migration plan` writes `CREATE TABLE` for `User` and `Post` with their primary keys, the unique index on `email`, the `enum('USER','ADMIN')` column and the foreign key. Adding a nullable field and planning again writes `ALTER TABLE … ADD COLUMN`; removing it, with `--delete`, writes `DROP COLUMN`.

A failed apply on MySQL reports, in the runner's own failure, which space failed and that the operations already run stay applied. Running `db migrate` again skips what was applied and finishes the rest.

## Chosen design

- **Planner and operations, narrow.** Create table (columns, primary key, defaults including `auto_increment`), create and drop index and unique index, add and drop foreign key, add and drop column, drop table, with backtick-quoted DDL rendered by the target. Every other change (type change, nullability change, default change, renames) is refused with a planner conflict that says it is not yet supported on MySQL. Model the strategies on Postgres's ALTER strategies, not SQLite's recreate-table ones. `migration.ts` rendering follows SQLite's class-flow authoring.
- **Runner applies one space at a time.** Following the Mongo target (`packages/3-targets/mongo/1-target/src/core/migrations/control-target.ts`): for each space in order, apply its operations with pre- and postchecks, verify that space's schema, then write its marker and ledger entry. On failure, stop and return a failure with `failingSpace` and `databaseUnchanged` set from what was actually applied. Re-running skips spaces whose marker is at the head and operations whose postchecks already hold.
- **What a failed apply leaves is stated per run by the runner.** The runner's failure carries `failingSpace` and `databaseUnchanged`, and its message says what stayed. On targets whose DDL is transactional (Postgres, SQLite) the runner rolls back and reports `databaseUnchanged: true`; on Mongo and MySQL the operations that ran stay applied. The CLI shows the runner's failure as it is. Every place that promised "a failure rolls back every space" now says this instead: the SQL runner type doc, `control-instances.ts`, the CLI operations, ADR 212, the Migration System and MongoDB Family docs. No target name appears in framework or family code. (Revised 2026-10-22 after review: a static `applyAtomicity` field on the migrations capability was built and removed, because its only reader repeated what the failure already says.)
- **Marker writes without `RETURNING`.** `updateMarker`'s compare-and-swap re-selects the marker inside the transaction it holds. `initMarker` uses `INSERT … ON DUPLICATE KEY UPDATE` written in the target's own control SQL (the shared upsert AST is slice 4).
- **The marker lock is released.** `lockMarker` takes `GET_LOCK` with a timeout and the adapter releases it with `RELEASE_LOCK` when the work it guards ends, success or failure. A failed release never hides the error that ended the work. The shared `lockMarker` doc stops promising "until the transaction ends" and says the adapter decides how long the lock lives and releases it (coupling row 6).
- **`db sign` order is the adapter's.** Postgres and SQLite keep one transaction for lock, bootstrap and writes. An adapter may provide `holdMarkerLock`; MySQL does, so it takes `GET_LOCK`, creates the marker table, then writes markers in a transaction, all under the lock (coupling row 5).
- **Plan target details.** `SqlPlanTargetDetails.schema` becomes optional; SQLite stops faking `'main'` and MySQL passes nothing (coupling row 13).
- **Marker table names in messages.** Each control adapter names its marker location once, and the CLI and verifier messages read it from there (coupling row 22).
- **`db verify` and `db sign`** use the descriptor's `diffSchema` and the introspection from 2a.

## Coherence rationale

One reviewer reads this as "MySQL can migrate, verify and sign", plus one shared change with a clear property: a failed apply's promise belongs to the target. The planner is kept narrow so the slice stays reviewable; wider ALTER support is follow-up work.

## Scope

**In:** planner, operations, DDL rendering, `migration.ts` rendering, runner, marker writes and lock, `db verify` and `db sign` on MySQL; the atomicity field and every text that depends on it; coupling rows 4, 5, 6, 13, 22.

**Out:** type, nullability and default changes, renames, `--convert` and `--backfill` on MySQL; query lowering (slice 3); writes (slice 4); MariaDB (slice 5); data transforms on MySQL beyond what the runner needs to refuse cleanly.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| A DDL statement commits on MySQL | The runner never wraps DDL in a transaction it promises to roll back; markers are written after the space verifies |
| `GET_LOCK` is per session, not per transaction | Release explicitly in a `finally`; use one connection for the lock and the work |
| Two runners at once | The second waits on `GET_LOCK`, then fails with `MIGRATION.MARKER_ORIGIN_MISMATCH` and `databaseUnchanged: true`; the marker ends at the destination |
| A failed space after others succeeded | `failingSpace` names it; earlier markers stay advanced; re-run converges |
| Postgres and SQLite behaviour | Unchanged; only the wording source changes. Their tests stay green without edits other than reading the new field |
| Mongo already keeps applied operations | Its docs stop describing it as the exception |
| Destructive git operations | Forbidden without orchestrator approval |

## Done when

Against MySQL 8.4 in a live test, the example contract plans, migrates, verifies and signs; an added and removed column plan and apply; a forced failure in the second of two spaces leaves the first space's marker advanced and a re-run converges; Postgres, SQLite and Mongo state their atomicity and their runner and CLI tests pass; and build, typecheck, lint, `lint:deps`, `check:error-reference` and the changed packages' tests pass.
