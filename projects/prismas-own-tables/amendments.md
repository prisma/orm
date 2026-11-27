# Amendments to the design, found by checking it against the code

[design.md](design.md) was written before anything was built. Its purpose is unchanged: no upgrade fails because of Prisma's own tables, and every name Prisma owns in a user's database is one we can keep for all of Prisma 8. This file records where the mechanism had to change, with the evidence. Where this file and the design differ, this file is right.

Evidence is from reading `main` at `f0241ad4c5` on 2026-11-26. Paths under `cli/` are in `packages/1-framework/3-tooling/cli/src/`.

## 1. The space is applied in a first phase, not as one more entry in the list

**Status: agreed with the operator on 2026-11-27.** It keeps the design's intent (the tables are a contract space the target package carries, read from the installed package and applied before anything else) and changes where "applied first" happens.

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

## 7. Found by the review of the whole slice

- **Names.** In the framework and the shared command line the concept is "the Prisma space" (`PRISMA_SPACE_ID`, `bringPrismaSpaceUpToDate`, `CONTRACT.PRISMA_SPACE_BEHIND`), because MongoDB has collections, not tables. One function answers "is this the Prisma space", and every special case asks it. Inside the PostgreSQL packages and the SQL family, "tables" stays.
- **A later major.** The rule in section 5 could not tell a later release of this major from a release of the next major, which may change the tables incompatibly. The rule gains a second condition from data the row already holds: the database is accepted as ahead only when its row records no invariant the installed package does not know. So a migration of this space provides an invariant exactly when an earlier release must stop, and a migration within a major provides none.
- **Two commands at once on a later migration.** The function read the row before the runner took its lock, so the second command failed on a stale origin. It now reads the row again once when the runner reports that, and carries on if the row is up to date.
- **The phase commits before the command's own checks.** A command that the change policy then refuses, or that the user cancels, has still brought Prisma's own tables up to date. This cannot be reordered, because the policies are in the tables the phase renames. The decision record on policies is updated in place to say so.
- **One code for "not up to date".** A database in a release candidate's schema and a database at an older contract of the space both report `CONTRACT.PRISMA_SPACE_BEHIND`, and `db verify` classifies a row with the same function the phase uses.
- **`migration log` does not show the space's rows,** and no flag was added to show them. The design's "shows it when asked" is dropped: a user can read the table.
- **Framework changes beyond section 1's list,** all in the command-line tooling: the `db verify` check that the space is behind, with its option; the helper that turns a failed phase into a command-line error; the filter in `migration log`; one line of output when the phase applied something.

## 8. Deferred

- A user's contract may declare a namespace named `_prisma`; nothing refuses it yet.
- A test that pins the space's hashes, once the one-time hash change has merged and the files have been emitted for the last time.
- A client typed from the space's contract for the adapter's own reads and writes, which would remove the hand-written table definitions.

## 9. Found by the second review

- **Decision records renumbered** to 338 (names begin `_prisma`) and 339 (the Prisma space), because `main` took 336 and an open pull request takes 337.
- **A row at a known contract carrying a later major's invariant** must stop too, not only a row at an unknown contract. Being fixed.
- **Commands that fail for reasons other than a policy** (a migration folder that cannot be read) have also already run the phase. The decision record says so.
- **`db verify --schema-only` on a release candidate's database** reports that the records are behind, as every reading command does. Intended: the command cannot read the rows it would verify against.
- **No `--json` field says the phase applied something.** The command-line output formats are being designed in their own project; a field can be added there, since adding a field does not break a reader.
- **The general shape of `applyInstalledContractSpace`** stays: it takes the space id and descriptor and contains nothing PostgreSQL- or `_prisma`-specific, so a second target uses it unchanged.
- **Two commands starting together** are tested with a fake runner only. A test against a real database would need two processes racing for a lock and could not fail reliably; the retry is a pure function of the runner's typed failure, which the unit test covers.
- **Further framework changes beyond section 1,** all agreed in this round: `errorPrismaSpaceBehind` and the export of the upgrade instructions' address in the core errors package; the exports for classifying the row and `errorInstalledSpaceUnreachable` with its `reason`; the listener the four client methods take for the one line of output; and those methods returning the phase's failure in their existing result shape.

## 10. Found by manual QA and the third round

- **A release candidate's tool against an upgraded database** replays every migration from the beginning. It is a consequence of renaming the schema, which no later release can prevent. The upgrade instructions say first that every service and pipeline that changes the database moves to `8.0.0` together.
- **The advice when the records are behind** names `db migrate`, `db update` and `db sign`, because a project that only uses `db update` has no migrations for `db migrate` to apply.
- **What the phase did** is listed from the ledger the runner already writes: the labels of operations that ran, not those skipped or check-only. No framework type gained a field.
- **The two permission conditions of a rename** are separate checks with their own advice. An empty `_prisma` beside `prisma_contract` is dropped, without `CASCADE`, and the rename goes ahead.
- **One payload for `CONTRACT.PRISMA_SPACE_BEHIND`:** the space and `situation`. The extra fields of earlier rounds are gone.
- **Message strings exported from published entry points** stay: the build has no way to keep one subpath of a published package unpublished without dropping an existing export, and a published package's imports from another must be published. A per-subpath "not published" setting in the build tooling would fix it; it is not part of this project.
- **A user's own `_prisma.marker` of another shape** stops a command that changes the database with the first migration's column check. A command that only reads gets the database's own error.
