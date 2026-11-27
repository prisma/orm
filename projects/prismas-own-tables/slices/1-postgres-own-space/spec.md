# Slice 1: PostgreSQL gets a `_prisma` contract space, applied first, and its schema is renamed

Part of [the plan](../../plan.md). Read [design.md](../../design.md) sections 1 to 6 and [amendments.md](../../amendments.md) first. The design is strong guidance, not a fixed specification: where the code shows it wrong, say so with evidence.

## What is true when this slice is done

1. **The PostgreSQL target package carries the space.** It has a contract for Prisma's own tables and a `migrations/` folder, in the contract-space package layout that pgvector uses (`packages/3-extensions/pgvector`), and its control descriptor carries them in a `contractSpace` field. The space's name is `_prisma`.
2. **A fresh database gets the schema `_prisma`** with the tables `marker`, `ledger` and `contract`, in the form `main` creates today, plus a `marker` row and a `ledger` row for the `_prisma` space itself.
3. **A database created by a release candidate is brought up to date with no manual step.** Its schema `prisma_contract` is renamed `_prisma`, its rows are kept, and the `_prisma` space's own rows are added. This happens the first time `db init`, `db update`, `db migrate` or `db sign` runs, before the command reads any row.
4. **A database from before the release candidates stops with a clear error.** When an existing table lacks expected columns, the command stops, names the table, and points at the upgrade instructions. Nothing is changed.
5. **Running a command again changes nothing.** When the `_prisma` row is at the newest contract in the installed package, the phase reads one row and stops.
6. **Commands that only read say what to run.** `db verify`, `migration status`, `migration log`, a dry run and the client's check on first use, pointed at a database that still has `prisma_contract` and no `_prisma`, say that Prisma's own tables were written by an earlier release and name `prisma db migrate`. They do not report an unsigned database.
7. **The user does not see the space.** No command lists it among the spaces. `db init`, `db update` and `db verify` do not treat its row as the row of an undeclared space. `migration log` leaves its rows out. A user can read the tables.
8. **The `CREATE … IF NOT EXISTS` route is gone on PostgreSQL.** The runner's `ensureControlTables` and `db sign`'s separate creation of the marker table no longer run for PostgreSQL. SQLite, MySQL, MariaDB and MongoDB behave exactly as before; they keep their route until their own slice.

## The first migration

Written by hand in the target package's `migration.ts`, since the planner cannot produce a conditional rename or column checks. Each step is skipped when its result already holds.

1. Rename `prisma_contract` to `_prisma` when the old schema exists. Stop if both exist.
2. Create the schema `_prisma` if it is missing.
3. Create `marker`, `ledger` and `contract` if they are missing, with the columns in `packages/3-targets/postgres/1-target/src/contract-free/control-bootstrap.ts` today.
4. For each table, check that it has the expected columns (name, type, nullability). A failure is the error in point 4 above.

PostgreSQL's tables have not changed since `rc.1`; confirm this from `git log` on that file before relying on it.

## Proof

- **The upgrade test.** An integration test against a real PostgreSQL database: create the schema and tables with the exact statements the last release candidate runs (copied into the test as a fixture, not imported from current code), sign it and apply a migration as that release would, then run the new `db migrate`. Assert the schema name, that every earlier row is still there, the `_prisma` space's rows, and that a second run changes nothing.
- A fresh-database test, the stop-with-an-error test for an older form, and the read-only message test.
- A test in the target package that the space on the descriptor is consistent: the contract's hash equals the head ref, each migration's hash verifies, and the path from empty reaches the head.
- Each test is seen to fail when the behaviour it covers is broken.

## Boundaries

- **Framework changes are limited to** the list in [amendments.md](../../amendments.md) section 1. Anything in `packages/1-framework` beyond it is raised before it is written.
- **No table is renamed and no column is dropped** in this slice. The split into signatures and configuration is slice 2.
- **No user-visible "marker" is renamed** in this slice. That is slice 3.
- **Lock names stay.**
- Two pull requests in flight touch the same files: [prisma/orm#31203](https://github.com/prisma/orm/pull/31203) (`db sign` and the control client) and [prisma/orm#31218](https://github.com/prisma/orm/pull/31218) (the PostgreSQL runner and control adapter). Merge `main` in when either lands; do not regenerate fixtures they also regenerate without agreeing an order with their sessions.

- Two more changes will alter the space's own files once they merge: [prisma/orm#31200](https://github.com/prisma/orm/pull/31200) requires `formatVersion: 1` in every stored contract, snapshot, `migration.json` and ref file, and #31203 changes every contract hash once. After each merges, merge `main` and emit the target's contract, head ref and migration files again. Whichever of these pull requests merges last carries the files in their final form; a `_prisma` hash must not change after `8.0.0`.
- **No release may be published between this slice and the one-time hash change (#31203).** A database gets its `_prisma` row from the first release that contains this slice. If #31203 then changed that contract's hash, a later release would find a row at a hash its migrations never pass through, and the user cannot sign this space again. Decided on 2026-11-27: both ship in the same release. Whoever prepares the next release checks that both have merged, and that the space's contract, head ref and migration files were emitted after the later of the two.

## Docs this slice writes

Written by the orchestrator, in this pull request: the decision record "each target has a contract space for Prisma's own tables" and the one on the `_prisma` prefix (context in design.md section 7); updates in place to the decision records on contract spaces and on marker storage, the Migration System subsystem doc, the upgrade instructions for this release, and the places in the skill and examples that name `prisma_contract`.
