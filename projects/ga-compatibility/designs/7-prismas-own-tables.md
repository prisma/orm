# Design: bring Prisma's own database tables up to date in each release

The design for project 7 of the [plan](../plan.md). It holds only what has been agreed. It implements section 6.4 of the [policy](../spec.md).

Prisma keeps tables for itself in a user's database: the marker, which records the contract the database matches; the ledger, which lists the migrations applied; and the contract table.

## 1. The tables are a contract space

Prisma's own tables are described by a contract and changed by migrations, like the application's tables and each extension's. They form a contract space that the framework owns. This uses the concepts we already have for keeping a database in the form a contract describes, and adds no second mechanism.

The hash of that contract, recorded in the space's own marker row, says which form the tables are in. No version number is needed.

## 2. Where it differs from an extension's space

**Nothing is copied into the user's repository.** An extension's contract and migrations are copied into the user's repository, and only those copies are read when migrations are applied. For the framework's space, the contract and migrations are read from the installed package.

The reason: these tables must match the release that is installed, not the repository. A user who upgrades Prisma and deploys without emitting first would otherwise apply an old copy, and the new release would then write to tables in the old form.

This is a stated exception to the decision record on contract spaces, which says that everything needed to apply and verify a database is in the user's repository.

**It is not shown by default.** A user does not need to see or review changes to these tables, as with any other ORM. The command-line tool leaves this space out of what it displays, and shows it when asked.

## 3. When it is applied

When migrations are executed, the framework goes through its own space as well as the application's. It does so before the first write to these tables, at the point where commands create them today, and in the same transaction where the database allows it.

The user is not asked and writes nothing.

These operations must not fail, because a user can do little to repair them.

## 4. What its migrations may contain

Within a major version, only additions. Application instances on an earlier release keep reading these tables while a deploy is in progress. This is easy to enforce, because the migrations are our own and can be checked before a release.

## 5. From `8.0.0`

`8.0.0` writes the marker row for this space. Every database from `8.0.0` on then says which form its tables are in.

Without that row, a database could be in any earlier form, and a later release could not tell which. So this is built before GA. It also removes friction for the release candidates that follow.

## 6. Not yet discussed

- Each target has its own tables, in its own database's terms. Which package owns the space for each target.
- How a database set up by a release candidate, whose tables may be in an older form, gets its starting row.
- A change that is not an addition: the policy says the ORM stops and names the one command that makes it.
- MongoDB, which keeps these records in one collection.
