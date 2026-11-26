# Amendments to the design, found by checking it against the code

[design.md](design.md) was written before anything was built. Its purpose is unchanged: no upgrade fails because of Prisma's own tables, and every name Prisma owns in a user's database is one we can keep for all of Prisma 8. This file records where the mechanism had to change, with the evidence. Where this file and the design differ, this file is right.

Evidence is from reading `main` at `f0241ad4c5` on 2026-11-26. Paths under `cli/` are in `packages/1-framework/3-tooling/cli/src/`.

## 1. The space is applied in a first phase, not as one more entry in the list

**Status: proposed to the operator on 2026-11-26, because it changes which framework code changes. Not yet agreed.**

**What the design says.** Section 2: the code that builds the list of spaces adds the target's space, and everything after the list needs no change. Section 3: the space runs first, in the same transaction as the others.

**Why that does not work.** Every command reads the marker rows before the runner starts, and plans from what it read:

- `db init` and `db update` read all rows at `cli/control-api/operations/db-run.ts:256`, then read the policies from the application's row and plan each space's path.
- `db migrate` reads them in the command itself, `cli/orm/migrate.ts:593`, and again at `cli/control-api/operations/migrate.ts:198`.
- `db sign` reads them at `cli/control-api/operations/db-sign.ts:148`.

On a database created by a release candidate the rows are in `prisma_contract.marker`. The new release looks in the `_prisma` schema, finds no table, concludes that nothing is signed, and plans every space from an empty database. The rename happens later, inside the runner, when the plans are already wrong. The same holds on every target once the marker table is split.

Two further facts rule out putting the space in the list:

- A space in the list is shown by every command that lists spaces, and `db sign` writes a ref file for it under `migrations/<space>/`, which throws for a name that is not a valid folder name (`cli/orm/db/sign.ts:392,418`).
- Reading, planning and applying in one transaction would need the caller to own the runner's transaction, which the runner interface does not offer, and `db update` asks the user questions between planning and applying (`db-run.ts:484-509`), so that transaction would hold the rename's lock while a person types.

**What is built.** The commands that change a database (`db init`, `db update`, `db migrate`, `db sign`) start with a phase that brings the `_prisma` space up to date:

1. Read the `_prisma` space's own row. A missing table reads as "no row", as today.
2. If the row is at the newest contract in the installed target package, stop.
3. Otherwise find the path through the migrations carried on the target descriptor and apply it with the ordinary runner, in its own transaction where the target has one. The runner writes the space's row and ledger rows as for any space.

Only then does the command read the other rows, the policies, and plan as it does today.

The space is never part of the list built from the user's `migrations/` folder. So the list-builder, the apply order, the check on space names and nearly all displays are unchanged. The framework changes are: the `contractSpace` field on the target descriptor and the reserved name (both in the design); the function that applies the space (`applyInstalledContractSpace` in the migration tools) and its calls from the commands; four path-finding and hashing functions widened to take migration packages held in memory (`reconstructGraph`, `resolveRecordedPath`, `verifyMigrationHash`, `requireHeadRef`), with one new exported type for the widened input; one new error code, `MIGRATION.INSTALLED_SPACE_UNREACHABLE`; and the two checks for rows of undeclared spaces.

**What follows from it.**

- Committing the phase apart from the user's migrations is safe: its migrations only add, and each step is skipped when its result already holds. If the user's migration then fails, Prisma's own tables stay up to date, which is the state the installed release needs.
- A command that only reads (`db verify`, `migration status`, `migration log`, a dry run, the client's check on first use) does not run the phase. When it finds the new tables missing and the old ones present, it says that Prisma's own tables were written by an earlier release and names the command to run.
- The policies do not govern the phase. A database whose change policy forbids `db update` is still brought up to date by `db migrate`, which is the command such a database permits.

## 2. The split and the renames are separate migrations only if a release candidate is published between them

The first slice renames PostgreSQL's schema and keeps the tables `marker`, `ledger` and `contract`. The second splits `marker` into `signatures` and `config`. If no release candidate is published between the two, the second slice rewrites the first migration, so `8.0.0` has one. If one is published, the second slice adds a migration, which is permitted before `8.0.0`.

## 3. Columns nothing writes are dropped when the marker is split

`contract_json`, `canonical_version` and `app_tag` are written as `NULL` by every writer on every target and read by nothing. The design drops `contract_json`. The other two go with it, since no column can be removed after `8.0.0`. SQLite's and MySQL's ledger columns `contract_json_before` and `contract_json_after` are likewise created and never written, and are dropped with their targets' slices.

## 4. The contract table has a reader

Nothing in this repository reads PostgreSQL's `contract` table, but Prisma Studio does: `data/migrations.ts` in prisma/studio joins it to the ledger for the Migrations view. This is evidence for the last slice's decision, not a change to the design.

## 5. An earlier release in the same major keeps working on a database a later one has brought further

The design says the space's row records the hash of its contract and that within a major its migrations only add, so that an earlier release keeps reading the tables during a deploy. It does not say what an earlier release does when it finds a row at a hash it does not know. Refusing would break a rollback and a rolling deploy that migrates at start. So: when the row's hash is not in the installed package's migrations, and the installed package's newest contract appears in the space's ledger, the database has already passed through this release's form, and the release carries on without applying anything. Only a row the ledger cannot explain is an error.

## 6. Renaming the schema needs its owner

`ALTER SCHEMA … RENAME` needs ownership of the schema, which creating tables if absent never needed. A database whose `prisma_contract` schema was created by an administrator role, with a migrating role that only has grants, cannot be renamed by that role. The first migration checks this before it renames and says which role must run the command. This is the one case where a release-candidate database needs a person, and the upgrade instructions say so.
