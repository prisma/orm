# ADR 337 — Each target has a contract space for Prisma's own tables

**Status:** Proposed
**Date:** 2026-11-26
**Domain:** Migration System, Adapters & Targets

## At a glance

Prisma keeps tables for itself in a user's database: the record of which contract each contract space was signed with, the ledger of migrations applied, and on PostgreSQL a store of contracts by hash. A user upgrades Prisma and deploys as usual:

```bash
pnpm add @prisma/orm-postgres@latest
prisma db migrate
```

Before `db migrate` reads anything, it brings Prisma's own tables to the form the installed release expects. On a database created by a release candidate that means renaming the schema `prisma_contract` to `_prisma`; on a new database it means creating the tables; on a database already up to date it means reading one row. The user writes nothing, is asked nothing, and does not see these tables among their own migrations.

The tables are a contract space, named `_prisma`, that the target package carries: a contract and migrations made with the same commands an application or an extension uses.

## Context

Until this decision each target's runner created these tables itself, with `CREATE … IF NOT EXISTS` statements its adapter supplied, before it read a marker. `db sign` created the marker table by a second route. A table that existed was never changed, so a database kept the form of whichever release first touched it, and a later release that expected a new column failed with a database error. The project kept no code for older forms.

From `8.0.0` the compatibility policy promises that no upgrade within Prisma 8 fails because of these tables. So they need what the user's own tables have: a recorded form and a way to move from one form to the next.

## Decision

### The tables are a contract space the target package carries

An extension such as pgvector holds a contract and migration folders in its package and carries them on its descriptor in a `contractSpace` field ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)). A target package does the same for Prisma's own tables: the same package layout, the same authoring commands, and the same `contractSpace` field, on the target's control descriptor. The space is named `_prisma` on every target, and the framework reserves that name.

Each target has its own contract and migrations, in its own database's terms. The framework has no say in what a target stores or what it calls it, because the target also writes the queries against it.

The space's own row in the marker table records the hash of its contract, which says which form the tables are in. No version number is needed. Its migrations leave ledger rows like any other space's.

### It is applied in a first phase, from the installed package

The commands that change a database (`db init`, `db update`, `db migrate`, `db sign`) begin by bringing this space up to date:

1. Read the `_prisma` space's own row. A missing table reads as "no row".
2. If the row is at the newest contract in the installed target package, stop.
3. Otherwise find the path through the migrations on the target descriptor and apply it with the target's ordinary runner, in its own transaction where the target has one. The runner writes the space's row and ledger rows as for any space.

Only then does the command read the other spaces' rows and the database's policies, and plan.

Three things differ from an extension's space:

- **It is read from the installed package, not from the user's repository.** An extension's contract and migrations are copied into the user's repository, and only those copies are read when migrations are applied. These tables must match the release that is installed. A user who upgraded Prisma and deployed without emitting would otherwise apply an old copy, and the new release would then write to tables in the old form. The target package is always installed when migrations are applied, because the runner is in it.
- **It is applied before anything is read.** Every command reads the rows of all spaces and the policies before the runner starts, and plans from what it read. A migration of these tables that ran inside the same runner call would move the rows after the plans were made.
- **It is not part of the list of spaces built from the repository.** So no command lists it, no folder under `migrations/` is written for it, and its name does not have to be a valid folder name. The checks for rows of undeclared spaces count it as declared. `migration log` leaves its rows out unless asked.

The phase commits apart from the user's migrations. That is safe because its migrations only add and each step is skipped when its result already holds. If the user's migration then fails, Prisma's own tables stay in the form the installed release needs.

The database's change policy and data protection policy ([ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md)) do not govern this phase. They say how the user's schema may change. A database that forbids `db update` is brought up to date by `db migrate`, which is the command it permits.

A command that only reads (`db verify`, `migration status`, `migration log`, a dry run) and the client's check on first use do not run the phase. When they find the tables in an earlier release's form, they say so and name the command to run.

### Within a major version its migrations only add

Application instances on an earlier release keep reading these tables while a deploy is in progress, and a team may roll a release back. So within a major a migration of this space adds columns, tables or rows and changes nothing that exists. A change that is not an addition goes into the next major's migrations and is applied the same way.

An earlier release that meets a database a later release has brought further finds a row at a hash it does not know. It looks in the space's ledger: when its own newest contract is recorded there, the database has passed through this release's form, and the release carries on without applying anything. A row the ledger cannot explain is an error, `MIGRATION.INSTALLED_SPACE_UNREACHABLE`.

### `8.0.0` writes the space's row, and release-candidate databases are brought up to date

Every database from `8.0.0` on says which form its tables are in. A database set up by a release candidate has the tables and no row for this space, so the phase runs the first migration. Each step checks whether its result already holds and is skipped if so; then the row is written.

On PostgreSQL the first migration:

1. Renames the schema `prisma_contract` to `_prisma` when the old schema exists ([ADR 336](ADR%20336%20-%20Names%20Prisma%20puts%20in%20a%20database%20or%20a%20query%20begin%20with%20_prisma.md)). `ALTER SCHEMA … RENAME` changes only the catalogue, so it is instant at any size.
2. Creates the schema and each table that is missing.
3. Checks that each table has the expected columns. A database from before the release candidates can have these tables in an older form; the command then stops, names the table, and points at the upgrade instructions. Those forms are not migrated.

Two cases stop the first migration without changing anything. PostgreSQL lets only a role with the privileges of a schema's owner rename it, so a migrating role that has only grants on `prisma_contract` is told which statement gives it ownership. And a database that has both schemas is not guessed at.

A runner asked to apply a user's space on a database where these tables are missing refuses before any operation, with `MIGRATION.PRISMA_TABLES_MISSING`.

A consequence: a release candidate's command-line tool or application, pointed at a database that `8.0.0` has brought up to date, finds no marker. The application warns and runs ([ADR 333](ADR%20333%20-%20The%20runtime%27s%20marker%20check%20only%20warns.md)).

## Where this stands

PostgreSQL follows this record. SQLite, MySQL, MariaDB and MongoDB still create their tables with `CREATE … IF NOT EXISTS` or on first write, and move to it in a later change; this section is removed when they have.

## Consequences

- Prisma's own tables can change in any release, by an ordinary migration, with no step for the user.
- A target author ships a contract and migrations for these tables, as an extension author does for theirs.
- The table definitions the adapters read and write through are still written by hand beside the contract. With an emitted contract, a target can query its own tables through a client typed from it; that is not done yet.
- This is a stated exception to [ADR 212](ADR%20212%20-%20Contract%20spaces.md), which says everything needed to apply and verify a database is in the user's repository. For this one space it is in the installed target package.
- Two commands that start at the same moment on a database that needs the first migration both run it. The runner's lock makes the second wait, every step is then skipped, and the second writes a second ledger row for the `_prisma` space. The tables and the user's data are correct.

## Alternatives considered

- **A version number on the marker and ledger.** Rejected: a contract hash already says which form the tables are in, and a second mechanism for the same job is not needed.
- **Copying the space into the user's repository like an extension's.** Rejected: the tables must match the installed release, not the repository.
- **Adding the space to the list of spaces a command applies, first in the order, in the same transaction.** Rejected: the commands read every space's row and the policies before the runner starts, so on a database whose schema is renamed during the run they would plan from an empty database. Holding one transaction across reading, planning and applying would need the caller to own the runner's transaction, and `db update` asks the user questions between planning and applying.
- **Making every reader fall back to the earlier names.** Rejected: every read of these tables, in every release of Prisma 8, would carry the earlier form.
- **Each target's runner adding its own space,** with nothing in the framework. Rejected: the mechanism would be written once per target and would drift.
- **A numbered list of statements kept by the target and run in order,** outside the migration system. Rejected: it is a second, weaker migration system beside the one that exists.
