# ADR 339 — Each target has a contract space for Prisma's own tables

**Status:** Proposed
**Date:** 2026-11-27
**Domain:** Migration System, Adapters & Targets
**Changes:** [ADR 212](ADR%20212%20-%20Contract%20spaces.md) (one space is read from the installed package), [ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md) (the tables are created by a migration), [ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md) (a refused command has still brought Prisma's own tables up to date). Each is updated in place.

## At a glance

Prisma keeps tables for itself in a user's database: the record of which contract each contract space was signed with, the ledger of migrations applied, and on PostgreSQL a store of contracts by hash. A user upgrades Prisma and deploys as usual:

```bash
pnpm add @prisma/orm-postgres@latest
prisma db migrate
```

Before `db migrate` reads anything, it brings Prisma's own tables to the form the installed release expects. On a database created by a release candidate that means renaming the schema `prisma_contract` to `_prisma`. On a new database it means creating the tables. On a database already up to date it means reading one row. The user writes nothing and is asked nothing, and these tables are not listed among the user's own migrations. When the step changed something, the command says so in one line. It does not list what it did: the runner's result does not say which operations ran, and adding that to a framework type was not worth it for a line that appears once per database. The upgrade instructions say that the first such command renames the schema.

The tables are a contract space, named `_prisma`, that the target package carries: a contract and migrations in the same form an application's or an extension's have. This record calls it the Prisma space.

## Context

Until this decision each target's runner created these tables itself, with `CREATE … IF NOT EXISTS` statements its adapter supplied, before it read a marker. `db sign` created the marker table by a second route. A table that existed was never changed, so a database kept the form of whichever release first touched it, and a later release that expected a new column failed with a database error. The project kept no code for older forms.

From `8.0.0` the compatibility policy promises that no upgrade within Prisma 8 fails because of these tables. So they need what the user's own tables have: a recorded form, and a way to move from one form to the next.

## Decision

### The tables are a contract space the target package carries

An extension such as pgvector holds a contract and migration folders in its package and carries them on its descriptor in a `contractSpace` field ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)). A target package does the same for Prisma's own tables, with the same `contractSpace` field on the target's control descriptor. The contract is emitted and the migrations are written with the same commands and in the same file formats. One thing differs in the layout: the config used to emit them sits in the target's adapter package, because a config names an adapter and the adapter depends on the target.

The space's name is `_prisma` on every target. The framework holds that name as a constant, with one function that answers "is this the Prisma space", and everything that treats the space differently asks that function. No extension or application can declare a space of that name: the code that builds the list of spaces refuses any name that is not a valid folder name, which begins with a letter. That check is what refuses it today; nothing about the space depends on it, since the space never comes from the user's repository. A user's contract declaring a PostgreSQL namespace named `_prisma` is not yet refused.

Each target has its own contract and migrations, in its own database's terms. The framework has no say in what a target stores or what it calls it, because the target also writes the queries against it.

The space's own row in the marker table records the hash of its contract, which says which form the tables are in, and the invariants its migrations provided. No version number is needed. Its migrations leave ledger rows like any other space's.

### It is applied in a first phase, from the installed package

The commands that change a database (`db init`, `db update`, `db migrate`, `db sign`) begin by bringing this space up to date:

1. Read the Prisma space's own row. A missing table reads as "no row".
2. If the row is at the newest contract in the installed target package, stop.
3. Otherwise find the path through the migrations on the target descriptor and apply it with the target's ordinary runner, in its own transaction where the target has one. The runner writes the space's row and ledger rows as for any space.

Only then does the command read the other spaces' rows and the database's policies, and plan.

Three things differ from an extension's space:

- **It is read from the installed package, not from the user's repository.** An extension's contract and migrations are copied into the user's repository, and only those copies are read when migrations are applied. These tables must match the release that is installed. A user who upgraded Prisma and deployed without emitting would otherwise apply an old copy, and the new release would then write to tables in the old form. The target package is always installed when migrations are applied, because the runner is in it.
- **It is applied before anything is read.** Every command reads the rows of all spaces and the policies before the runner starts, and plans from what it read. A migration of these tables that ran inside the same runner call would move the rows after the plans were made.
- **It is not part of the list of spaces built from the repository.** So no command lists it and no folder under `migrations/` is written for it. The checks for rows of undeclared spaces count it as declared. `migration log` does not show its ledger rows; a user can read them in the table.

The phase is run by the control client, the programmatic interface the commands are built on, so a program that uses the client gets it too. Code that reaches the runner or the sign path without the client does not, so a program that does that calls `bringPrismaSpaceUpToDate` on the client first. On PostgreSQL such a caller is refused before anything runs when the tables are not up to date: with `MIGRATION.PRISMA_TABLES_MISSING` when they do not exist, and with `CONTRACT.PRISMA_SPACE_BEHIND` when they are still in a release candidate's schema.

### The phase commits before the command's own checks

The phase is its own transaction and commits before the command reads the policies, loads the user's migrations, or asks the user anything. It has to: on a release-candidate database the policies are in the tables the phase renames.

So a command that is then refused, cancelled, or fails for any other reason (a migration folder it cannot read, for example) has still brought Prisma's own tables up to date. `db update` on a database whose change policy forbids it renames the schema and then refuses. This is the one thing a refused command changes, and [ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md) says so. The policies govern how the user's schema may change; the phase touches only Prisma's own tables, only adds within a major, and leaves the database in the form the installed release needs whatever the command then does.

If the user's migration fails after the phase, Prisma's own tables stay up to date.

### Commands that only read

`db verify`, `migration status`, `migration log`, a dry run, and the SQL client's check on first use do not run the phase. Pointed at a PostgreSQL database that still has `prisma_contract`, each reports `CONTRACT.PRISMA_SPACE_BEHIND` and names the commands that bring the records up to date (`prisma db migrate`, `db update` or `db sign`, whichever the project uses); the client logs it as a warning, when it is given a log, and runs the query. `db verify` also reports it when the tables are in the current schema but at an older contract of the space than the installed release carries. One code covers both, because the user does the same thing in both.

### Within a major version its migrations only add

Application instances on an earlier release keep reading these tables while a deploy is in progress, and a team may roll a release back. So within a major, a migration of this space after the first adds columns, tables or rows and changes nothing that exists. A test in the target package checks it. A change that is not an addition goes into the next major's migrations and is applied the same way.

### A database that is ahead of the installed release

An earlier release that meets a database a later release has brought further finds a row at a hash it does not know. It decides from two things the database records:

- **The space's ledger.** When the installed release's newest contract appears there as a destination, the database has passed through this release's form.
- **The row's invariants.** A migration of this space provides an invariant exactly when an earlier release must not use the tables afterwards. So a migration within a major provides none, and the first migration of a major that changes the tables incompatibly provides one.

The release carries on, applying nothing, when its newest contract is in the ledger and the row records no invariant the installed package does not know. Otherwise it stops with `MIGRATION.INSTALLED_SPACE_UNREACHABLE`: either the tables were changed by a later major version, and the user must use that release, or the row is one nothing explains.

`db verify` applies the same rule through the same function, so it reports what a command that changes the database would do.

### `8.0.0` writes the space's row, and release-candidate databases are brought up to date

Every database from `8.0.0` on says which form its tables are in. A database set up by a release candidate has the tables and no row for this space, so the phase runs the first migration. Each step checks whether its result already holds and is skipped if so; then the row is written.

On PostgreSQL the first migration:

1. Checks the release candidate's tables, where they exist, for the expected columns. A database from before the release candidates can have these tables in an older form; the command then stops and names the table. Those forms are not migrated.
2. Renames the schema `prisma_contract` to `_prisma` ([ADR 338](ADR%20338%20-%20Names%20Prisma%20puts%20in%20a%20database%20or%20a%20query%20begin%20with%20_prisma.md)). `ALTER SCHEMA … RENAME` changes only the catalogue, so it is instant at any size.
3. Creates the schema and each table that is missing, and checks the result.

Two more cases stop it without changing anything. PostgreSQL lets only a role with the privileges of a schema's owner, and `CREATE` on the database, rename a schema; each condition is checked on its own and its message gives the statement that grants it. And a database that has both schemas, where `_prisma` holds anything, is not guessed at. An empty `_prisma` beside `prisma_contract` is dropped, with a statement the database refuses if the schema is not empty, and the rename goes ahead.

A user's own `_prisma.marker` that lacks the columns Prisma reads is treated as no row, so the first migration's checks run and stop the command with a message that names the table. A command that only reads gets the database's own error in that case.

The text of a failed check is part of the migration's hash, so it carries no address. The command-line error around it gives the address of the upgrade instructions.

A consequence: a release candidate's command-line tool or application, pointed at a database that `8.0.0` has brought up to date, finds no marker. The application warns and runs ([ADR 333](ADR%20333%20-%20The%20runtime%27s%20marker%20check%20only%20warns.md)). A release candidate's command-line tool must not be used against such a database. It does not see the records, creates a new, empty `prisma_contract`, which later releases ignore, and applies every migration again from the beginning: steps whose result already holds are skipped, but a data migration or raw SQL without such a check runs again. So every service and pipeline that changes a database moves to `8.0.0` together. Nothing in a later release can stop an earlier one doing this; the upgrade instructions say it first.

### Two commands at once

The runner takes its lock before it applies anything, and the phase read the space's row before that. Two commands that start together both plan the same migration. The second waits for the lock.

- On the first migration, the second then finds every step's result in place, skips them all, and writes a second ledger row for the Prisma space. The tables and the user's data are correct.
- On a later migration, the runner refuses the second because the row moved under it. The phase reads the row again, finds it up to date, and carries on.

## Where this stands

PostgreSQL follows this record. SQLite, MySQL, MariaDB and MongoDB still create their tables with `CREATE … IF NOT EXISTS` or on first write, and their descriptors carry no space, so the phase does nothing for them. They move to it in a later change, and this section is removed when they have.

## Consequences

- Prisma's own tables can change in any release, by an ordinary migration, with no step for the user.
- A target author ships a contract and migrations for these tables, as an extension author does for theirs.
- On PostgreSQL the tables are described in four places: the contract, the statements that create them, the columns the first migration checks, and the table definitions the adapter reads and writes through. Tests keep them in agreement. With an emitted contract a target can query its own tables through a client typed from it, which would remove the last of these; that is not done yet.
- This is a stated exception to [ADR 212](ADR%20212%20-%20Contract%20spaces.md), which says everything needed to apply and verify a database is in the user's repository. For this one space it is in the installed target package.
- A refused, cancelled or failed command is no longer guaranteed to change nothing: it may have brought Prisma's own tables up to date.
- `CONTRACT.PRISMA_SPACE_BEHIND` is raised by every command that only reads, and is also a finding of `db verify`, where findings exit with code 4 as the other drift findings do. Its payload is the same wherever it is raised: the space and `situation`, one of `releaseCandidateSchema`, `missingRow` or `olderContract`.

## Alternatives considered

- **A version number on the marker and ledger.** Rejected: a contract hash already says which form the tables are in, and a second mechanism for the same job is not needed.
- **Copying the space into the user's repository like an extension's.** Rejected: the tables must match the installed release, not the repository.
- **Adding the space to the list of spaces a command applies, first in the order, in the same transaction.** This is what the design first said. Rejected: the commands read every space's row and the policies before the runner starts, so on a database whose schema is renamed during the run they would plan from an empty database. Holding one transaction across reading, planning and applying would need the caller to own the runner's transaction, and `db update` asks the user questions between planning and applying.
- **Keeping the space in the list and making every reader look under the earlier names too.** It would keep one transaction and a refused command would change nothing. Rejected: the phase would still be needed for every later change to these tables, since a reader can fall back to an old name but not to a missing column; and every read of these tables, in every release of Prisma 8, would carry the release candidates' form.
- **Each target's runner adding its own space,** with nothing in the framework. Rejected: the mechanism would be written once per target and would drift.
- **A numbered list of statements kept by the target and run in order,** outside the migration system. Rejected: it is a second, weaker migration system beside the one that exists.
- **Telling a later major's database from a later minor's by a version number in the row.** Rejected for the invariant rule above, which uses what the row already records.
