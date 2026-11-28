# Projects a release candidate wrote

`fixtures/8.0.0-rc.25/` holds two projects, `postgres-app` and `mongo-app`, exactly as the `8.0.0-rc.25` CLI wrote them, in format version 0: no file has `formatVersion`, and each contract has `"schemaVersion": "1"`. Every hash in them is the one the release candidate computed: the storage, execution and profile hashes, each `migrationHash`, and the hashes in `migration.json` and the refs. `rc-25.test.ts` checks that this release reads every file and that each hash is still the literal value the release candidate wrote. It then runs the `contract-hash-inputs` upgrade script (`upgrade-instructions/pending/contract-hash-inputs/app/`) on a copy of each project, and checks that every file of the copy reads and that the hashes it records are the ones this release computes from its contracts. Formatting and linting are off for the fixtures, so the files keep their bytes; never emit or plan into them again.

It also holds two more PostgreSQL projects, written the same way, whose contract source holds a value the release candidate wrote as an empty object, for the `contract-hash-inputs` script's tests in `upgrade-instructions/contract-hash-inputs/release-candidate-projects.test.ts`. `postgres-emptied-value` has a GIN index with the options `{ fastupdate: false }`, which the release candidate wrote, and hashed, as `options: {}`. `postgres-emptied-value-and-policy` adds row-level security and a policy with no roles, whose `roles: []` the release candidate kept in the file and left out of the hash. The tests read the hashes the release candidate wrote from these files, and compute none of them with the code under test.

## How they were made

1. In a folder outside the workspace, install `@prisma/orm-postgres` (or `@prisma/orm-mongo`), `@prisma/orm-toolchain` at `8.0.0-rc.25` and `@prisma/cli-engine` at `0.10.4`, with `pnpm install --ignore-workspace`. The published `prisma@8.0.0-rc.25` package depends on `@prisma/orm-toolchain@8.0.0-rc.19`, so run the CLI of the `8.0.0-rc.25` toolchain instead: a file `prisma.mjs` holding `import { runOrmBin } from '@prisma/orm-toolchain/cli'; await runOrmBin();`, run with `node prisma.mjs`.
2. Copy `prisma.config.ts` and the first version of the contract source (without `body` in Postgres, without `bio` and the `title` index in MongoDB). Run `contract emit`, then `migration plan --name init`.
3. Set the `db` ref to the first contract (`migration ref set db <hash>`), add the field (and, in MongoDB, the index), run `contract emit` and `migration plan` again (`add_post_body`, `add_title_index`), and set the `production` ref to the first contract.
4. Copy `prisma.config.ts`, `src/` and `migrations/` here.

The two other projects were made the same way from the TypeScript source in each `src/prisma/contract.ts`, with one migration each: `contract emit`, `migration plan --name init`, then `db migrate` against an empty PostgreSQL database, which wrote the `db` ref. The release candidate refuses its own snapshot of such a contract (`MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH`), so `migration ref set` and a second `migration plan` fail on these projects. In `test/integration/test/upgrade-instructions/contract-hash-inputs/fixtures/emitted-by-this-release/`, each project's `contract.json` and `contract.d.ts` are what `prisma contract emit` with this release wrote from the same source.

## How we know they are the release candidate's output

The files were written by one run of the steps above on 2026-11-26. On 2026-11-27 the steps were run again with the same `8.0.0-rc.25` packages, in a new folder. Every file came out identical except each migration's folder name and `createdAt`, and so its `migrationHash`, which covers `createdAt`. The `8.0.0-rc.25` `verifyMigrationHash` accepts each `migrationHash` here. So the profile hashes (`3916f444…` for PostgreSQL and `251b3ce2…` for MongoDB) are the values the release candidate computes, not values derived from its source.

## At 8.0.0

`8.0.0` reads format version 1 only, so these projects are no longer read as they are. They exist only to prove that this release reads files a release candidate wrote, so delete this directory and its tests when `8.0.0` is cut, with the rest of format version 0. `packages/1-framework/0-foundation/contract/test/format-version.release-candidate.test.ts` lists everything to remove.
