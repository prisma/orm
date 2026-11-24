# Slice: later releases are tested against what an earlier release stored

One pull request. Part of the project in [../../spec.md](../../spec.md), section 4. Built on the hash slice, because the samples must be in the final format with the final hashes.

## What it protects

A change that stops the current code reading what a release of Prisma 8 wrote fails a test, before it is released. Today nothing reads a file or a database record that an earlier release wrote.

## What is built

- **A sample set per database, PostgreSQL and MongoDB,** of everything a release writes:
  - a project's files: `contract.json` and `contract.d.ts`, the migrations (`migration.json`, `ops.json`, `migration.ts`), the snapshots, and ref files, for the application and for one extension that owns tables on PostgreSQL;
  - the database records: the marker, the ledger and, on PostgreSQL, the contract table, as the release wrote them after applying those migrations, saved in a form the test can load into an empty database.
- The samples are written by the code of the branch they are built on, which is the format the next release candidate writes. Each set records which release wrote it.
- **Tests,** run on every later change:
  - the current code reads every saved file without error;
  - it computes, from each saved contract, the hashes the files record;
  - it applies the saved migrations to an empty database, and the result matches the saved contract (`db verify` passes);
  - with the saved database records loaded into a database whose schema matches, it reads the marker and the ledger, `migration status` reports the database up to date, `db migrate` has nothing to do, and a query runs.
- **A written procedure,** beside the samples, to replace them when `8.0.0` is cut, and to add a set for each later release that changes a format. A sample set, once released, is never edited.

## What it must not do

- Run anything against a database other than the in-process servers the repository's tests already use.
- Depend on the repository's live examples or fixtures, which change: the samples are copied into their own folder.

## Done when

- Both sample sets and their tests exist and pass. Each test fails when the code under it is broken (shown by breaking a reader and seeing the test fail).
- The procedure exists, and a reviewer can follow it.
- `/drive-code-review` on the final commit has no open finding.
