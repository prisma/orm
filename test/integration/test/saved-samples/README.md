# Saved samples

Within Prisma 8, a later release reads every file and database record an earlier release wrote, and the user regenerates nothing after an upgrade. The files carry a format version, and the hashes they record follow rules that do not change within the major; see the decision records on [stored file format versions](../../../../docs/architecture%20docs/adrs/ADR%20331%20-%20Stored%20files%20carry%20a%20format%20version%2C%20and%20a%20reader%20refuses%20one%20it%20does%20not%20know.md) and on [hash rules](../../../../docs/architecture%20docs/adrs/ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md).

This folder holds what releases wrote, so that every change is tested against it before it is released. Each `sets/<release>/` folder holds one set, written by that release's code, and `sets/<release>.sha256` beside it lists every file of the set with its SHA-256. Below, paths are inside `sets/`. Biome and the typecheck leave `sets/` alone, so the saved bytes are never reformatted or compiled.

- `<release>/postgres/project/` and `<release>/mongo/project/`: a project's `prisma.config.ts` (with `{{DB_URL}}` where each run puts its connection string) and `contract.prisma`, as its user wrote them; its emitted `contract.json` and `contract.d.ts`; its migrations (`migration.json`, `ops.json`, `migration.ts`), snapshots and refs; and on PostgreSQL the pgvector pack's migrations and refs. The `production` ref declares database policies and requires an invariant a data migration provides.
- `<release>/postgres/database/`: how Prisma's tables in `prisma_contract` were created (`tables.json`: each table's columns with their types, nullability and defaults, its primary key, and the sequences its columns own), and their rows after the migrations were applied, one JSON file per table.
- `<release>/mongo/database/`: the documents of Prisma's `_prisma_migrations` collection after the migrations were applied, in canonical Extended JSON so that dates and object ids keep their types.
- `<release>/<database>/query.json`: the row the tests write and read back through the facade.
- `<release>/README.md`: which release wrote the set, when, and what it holds.

Everything a test needs from a set is read from the set: its config, its migration spaces (the folders under `migrations/`), its records and its query. A later set can change any of them without changing what an older set is tested with.

## What the tests check

For every set, with the current code:

- `checksums.test.ts`: every file of the set has the SHA-256 its checksum list records, and the set has no other file.
- `saved-files.test.ts`: every contract and snapshot is read through the database's facade; the hashes this release computes from each contract and snapshot are the ones the files record, and each snapshot is named by its storage hash; every migration reads and its `migrationHash` verifies; the application migrations start and end at snapshots; every ref, with its policies and invariants, reads and names a snapshot.
- `postgres-database.test.ts` and `mongo-database.test.ts`: the saved migrations apply to an empty database and `prisma db verify` passes. Then, on a database whose schema was made by applying them, Prisma's own records are replaced with the saved ones. On PostgreSQL the `prisma_contract` schema is dropped and created again from `tables.json`, so the current code runs against Prisma's tables in the form the saved release left them. `prisma migration status` shows every saved ledger entry as applied and nothing pending, `prisma db migrate` has nothing to apply, `prisma db verify` passes, every saved record is still there, and a row written and read through the facade comes back.

Each test copies the saved project into a temporary folder and never changes the saved files.

Nothing reads the rows of `prisma_contract.contract` yet. Whoever adds the first reader adds a check of the saved rows here.

## A released set is never changed

A set records what a release wrote. If a change makes a test here fail, the change broke the promise to users of that release: fix the change, not the set or its checksum list. A set may be replaced only while its release has not been published.

## Adding a set

Add a set when `8.0.0` is cut, and for every later release that changes the format of a stored file or of Prisma's database records.

1. On the branch that will be released, build the workspace with `pnpm build`.
2. From `test/integration`, run the generator, naming the release the code will ship in:

   ```bash
   REGENERATE_SAVED_SAMPLES=8.1.0 pnpm samples:write
   ```

   It starts an in-process PostgreSQL server and an in-process MongoDB replica set, builds each project with the CLI (`contract emit`, `migration plan`, a data migration, `db migrate`, and `db migrate --to production --permit-policy-change`), and writes the set into `sets/8.1.0/`, its `README.md`, and its checksum list `sets/8.1.0.sha256`. It refuses to write a set that exists. The test runs leave the generator out (`vitest.config.ts`); only this command runs it.
3. Run `checksums.test.ts`, `saved-files.test.ts`, `postgres-database.test.ts` and `mongo-database.test.ts` one at a time, and commit the set and its checksum list with the release.

The generator's inputs are in `generator-inputs.ts` and `regenerate.test.ts`. When a release adds something a user can store, such as a new kind of migration operation or a new field in a ref, add it to the generator before writing the new set; the older sets keep the inputs they were written with.

## Replacing the release candidate set at 8.0.0

The set written for `8.0.0-rc.26` holds the format a release candidate wrote, and release candidates make no compatibility promise. When `8.0.0` is cut, delete `sets/8.0.0-rc.26/` and `sets/8.0.0-rc.26.sha256`, and write the `8.0.0` set as above. From then on, sets are only added.
