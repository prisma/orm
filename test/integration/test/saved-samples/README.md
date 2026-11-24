# Saved samples

Within Prisma 8, a later release reads every file and database record an earlier release wrote, and the user regenerates nothing after an upgrade. The files carry a format version, and the hashes they record follow rules that do not change within the major; see the decision records on [stored file format versions](../../../../docs/architecture%20docs/adrs/ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md) and on [hash rules](../../../../docs/architecture%20docs/adrs/ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md).

This folder holds what releases wrote, so that every change is tested against it before it is released. Each `<release>/` folder holds one set, written by that release's code:

- `<release>/postgres/project/` and `<release>/mongo/project/`: a project's `contract.prisma`, its emitted `contract.json` and `contract.d.ts`, its migrations (`migration.json`, `ops.json`, `migration.ts`), snapshots and refs, and on PostgreSQL the pgvector pack's migrations and refs. The config is not saved, because a release does not write it; `sample-projects.ts` writes one for each run.
- `<release>/postgres/database/`: the rows of Prisma's tables (`prisma_contract.marker`, `ledger` and `contract`) after the migrations were applied, one JSON file per table.
- `<release>/mongo/database/`: the documents of Prisma's `_prisma_migrations` collection after the migrations were applied, in canonical Extended JSON so that dates and object ids keep their types.
- `<release>/README.md`: which release wrote the set and when.

## What the tests check

For every set, with the current code:

- `saved-files.test.ts`: every contract and snapshot is read through the database's facade; the hashes this release computes from each contract and snapshot are the ones the files record, and each snapshot is named by its storage hash; every migration reads and its `migrationHash` verifies; the application migrations start and end at snapshots; every ref reads and names a snapshot.
- `postgres-database.test.ts` and `mongo-database.test.ts`: the saved migrations apply to an empty database and `prisma db verify` passes. Then, on a database whose schema was made by applying them, Prisma's own tables are emptied and filled with the saved records; `prisma migration status` shows every saved ledger entry as applied and nothing pending, `prisma db migrate` has nothing to apply, `prisma db verify` passes, and a row written and read through the facade comes back.

Each test copies the saved project into a temporary folder and never changes the saved files.

## A released set is never edited

A set records what a release wrote. If a change makes a test here fail, the change broke the promise to users of that release: fix the change, not the set. A set may be replaced only while its release has not been published.

## Adding a set

Add a set when `8.0.0` is cut, and for every later release that changes the format of a stored file or of Prisma's database records.

1. On the branch that will be released, build the workspace with `pnpm build`.
2. From `test/integration`, run the generator, naming the release the code will ship in:

   ```bash
   REGENERATE_SAVED_SAMPLES=8.1.0 pnpm test test/saved-samples/regenerate.test.ts
   ```

   It starts an in-process PostgreSQL server and an in-process MongoDB replica set, builds each project with the CLI (`contract emit`, `migration plan`, `db migrate`, `migration ref set production`), and writes the project files and the database records into `8.1.0/`. It refuses to write a set that exists.
3. Write `8.1.0/README.md`, saying which release wrote the set and when.
4. Run `saved-files.test.ts`, `postgres-database.test.ts` and `mongo-database.test.ts` one at a time, and commit the set with the release.

The generator changes the projects only to cover what is new: when a release adds something a user can store, such as a new kind of migration operation or a new field in a ref, add it to the projects in `regenerate.test.ts` before writing the new set.

## Replacing the release candidate set at 8.0.0

The set written for `8.0.0-rc.26` holds the format a release candidate wrote, and release candidates make no compatibility promise. When `8.0.0` is cut, delete the `8.0.0-rc.26` folder and write the `8.0.0` set as above. From then on, sets are only added.
