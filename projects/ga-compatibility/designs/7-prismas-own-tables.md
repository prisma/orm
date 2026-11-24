# Design: bring Prisma's own database tables up to date in each release

The design for project 7 of the [plan](../plan.md). It holds only what has been agreed. It implements section 6.4 of the [policy](../spec.md).

Prisma keeps tables for itself in a user's database: the marker, which records the contract the database matches; the ledger, which lists the migrations applied; and the contract table.

## 1. Each target keeps a contract and migrations for its own tables

Prisma's own tables are described by a contract and changed by migrations, like the application's tables and each extension's. This uses the concepts we already have for keeping a database in the form a contract describes, and adds no second mechanism.

Each target has its own tables, in its own database's terms, so each target package holds the contract and the ordered migrations for them. What SQL targets share sits in the SQL family.

The hash of that contract, recorded in the database, says which form the tables are in. No version number is needed. The target records it as a row in the marker table, under a reserved space name that no extension can take.

## 2. The framework does not see it

Today each target's migration runner creates these tables itself when it starts, with statements its adapter supplies. The framework takes no part. That stays so: the runner brings the tables up to date at the same point, by executing its own migrations from the recorded hash to the newest.

So this is not one of the contract spaces the framework assembles, orders and applies. Three things follow without any code:

- **Nothing is copied into the user's repository.** The contract and migrations are read from the installed target package. These tables must match the release that is installed, not the repository: a user who upgrades Prisma and deploys without emitting first would otherwise apply an old copy, and the new release would then write to tables in the old form.
- **It comes before every other space**, because the runner does it before it executes anything else.
- **It is not displayed.** A user does not need to see or review changes to these tables, as with any other ORM.

The framework's command-line code reads every marker row and refuses one whose space the project does not declare. The target's adapter does not report its own row there, so the framework needs no change.

## 3. When it is applied

When migrations are executed, the target's runner brings its own tables up to date as well as applying the application's migrations. It does so before the first write to these tables, at the point where commands create them today, and in the same transaction where the database allows it.

The user is not asked and writes nothing.

These operations must not fail, because a user can do little to repair them.

## 4. What its migrations may contain

Within a major version, only additions. Application instances on an earlier release keep reading these tables while a deploy is in progress. This is easy to enforce, because the migrations are our own and can be checked before a release.

## 5. From `8.0.0`

`8.0.0` writes the marker row for this space. Every database from `8.0.0` on then says which form its tables are in.

Without that row, a database could be in any earlier form, and a later release could not tell which. So this is built before GA. It also removes friction for the release candidates that follow.

## 6. Not yet discussed

- How a database set up by a release candidate, whose tables may be in an older form, gets its starting row.
- A change that is not an addition: the policy says the ORM stops and names the one command that makes it.
- MongoDB, which keeps these records in one collection.
