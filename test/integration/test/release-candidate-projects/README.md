# Projects a release candidate wrote

`fixtures/8.0.0-rc.25/` holds two projects, `postgres-app` and `mongo-app`, whose stored files the `8.0.0-rc.25` CLI wrote, in format version 0: no file has `formatVersion`, and each contract has `"schemaVersion": "1"`. Their hashes are the ones the release candidate computes: the storage and execution hashes from the content, and, for PostgreSQL, the profile hash of no declared capabilities, as `8.0.0-rc.25` computed it. `rc-25.test.ts` checks that this release reads every file and that the recorded storage and execution hashes match the contracts. Formatting and linting are off for the fixtures, so the files keep their bytes.

## How they were made

1. In a folder outside the workspace, install `@prisma/orm-postgres` (or `@prisma/orm-mongo`), `@prisma/orm-toolchain` at `8.0.0-rc.25` and `@prisma/cli-engine` at `0.10.4`, with `pnpm install --ignore-workspace`. The published `prisma@8.0.0-rc.25` package depends on `@prisma/orm-toolchain@8.0.0-rc.19`, so run the CLI of the `8.0.0-rc.25` toolchain instead: a file `prisma.mjs` holding `import { runOrmBin } from '@prisma/orm-toolchain/cli'; await runOrmBin();`, run with `node prisma.mjs`.
2. Copy `prisma.config.ts` and the first version of the contract source (without `body` in Postgres, without `bio` and the `title` index in MongoDB). Run `contract emit`, then `migration plan --name init`.
3. Set the `db` ref to the first contract (`migration ref set db <hash>`), add the field (and, in MongoDB, the index), run `contract emit` and `migration plan` again (`add_post_body`, `add_title_index`), and set the `production` ref to the first contract.
4. Copy `prisma.config.ts`, `src/` and `migrations/` here.

## At 8.0.0

`8.0.0` reads format version 1 only, so these projects are no longer read as they are. They exist only to prove that this release reads files a release candidate wrote, so delete this directory and its tests when `8.0.0` is cut, with the rest of format version 0. `packages/1-framework/0-foundation/contract/test/format-version.release-candidate.test.ts` lists everything to remove.
