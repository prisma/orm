# Adopting Prisma 8 beside Prisma 7

A Prisma 7 project (PostgreSQL) adopts Prisma 8 the way the public guide [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) describes, with one change: instead of running `prisma contract infer` and hand-editing the inferred contract, Prisma 8 reads `prisma/schema.prisma` directly through `prisma7Schema(...)`. Prisma 7 is installed for real (`@prisma/prisma7`, `@prisma/client`, `@prisma/adapter-pg`, all 7.10.0) and keeps owning the database and its migrations; Prisma 8 reads the schema, signs and verifies the database, and serves the routes that have moved. Nothing is hand-edited.

## The story in one run

```bash
cd examples/prisma7-adoption
pnpm db:start            # terminal 1: in-process Postgres, writes DATABASE_URL to .env
pnpm v7:migrate          # terminal 2: prisma7 migrate deploy --config prisma7.config.ts
pnpm emit                # prisma contract emit: Prisma 8 reads prisma/schema.prisma via prisma7Schema
pnpm sign                # prisma db sign: verifies the database, records the marker
pnpm verify              # prisma db verify: zero findings
pnpm v7:generate         # prisma7 generate: the Prisma 7 client
pnpm seed                # rows written through the Prisma 7 client
pnpm start               # the same rows read and written through the Prisma 8 ORM
pnpm v7:read             # the same rows read through Prisma 7 again
pnpm test                # the whole story on a fresh database, including the second migration
```

`prisma/migrations/` holds two Prisma 7 migrations, the initial one and one adding `Post.viewCount`. On a fresh database `pnpm v7:migrate` applies both at once, so to watch the refresh loop that every later Prisma 7 migration needs, run `pnpm test`: it rolls a scratch copy of this example back to the first migration, runs the commands above, then lands the second migration and runs `pnpm emit`, `pnpm sign`, and `pnpm verify` again. After every `prisma7 migrate deploy` (or `migrate dev`) that is the whole loop: emit, sign, verify. Nothing else changes.

## Phase by phase

The guide's phases, and what this example does in each.

### 1. Prepare Prisma 7 to run side by side

`package.json` has `@prisma/prisma7@7.10.0` as a dev dependency instead of `prisma`, so the Prisma 7 CLI is the `prisma7` binary and `prisma` is free for Prisma 8. Prisma 7's config is `prisma7.config.ts`, importing `defineConfig` from `@prisma/prisma7/config`; Prisma 7.10.0 looks for `prisma7.config.*` before `prisma.config.*`, so it finds its own config without help even though `prisma.config.ts` sits beside it; the scripts here still pass `--config prisma7.config.ts` so that every command shows which config it reads. `@prisma/client@7.10.0` and `@prisma/adapter-pg@7.10.0` stay, and the schema's generator writes the Prisma 7 client to `generated/prisma7/` (gitignored; `pnpm v7:generate` recreates it).

### 2. Add Prisma 8

`prisma.config.ts` is the guide's file with the contract line changed:

```ts
import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as definePostgresConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: definePostgresConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    output: 'generated/prisma8',
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
```

In your own project the first import is `import { definePrismaConfig } from 'prisma/config'` and the Prisma 8 CLI is the published `prisma@latest` dev dependency, exactly as the guide shows. Inside this repository the published `prisma` package is built elsewhere, so this example aliases the workspace CLI as its `prisma` dev dependency (`"prisma": "workspace:@internal/cli@..."`) and imports `definePrismaConfig` from `@prisma/cli-engine`, which the published package re-exports as `prisma/config`. Everything else is what you would write.

`prisma7Schema` replaces the guide's `prisma contract infer` step and the two hand edits after it (deleting the `PrismaMigrations` model, adding `@@map` to every model): the source reads the Prisma 7 schema itself, so model names stay as written and `_prisma_migrations` is never part of the contract. `pnpm emit` writes `generated/prisma8/contract.json` and `contract.d.ts`; `pnpm sign` verifies the live schema against that contract and writes Prisma 8's marker; `pnpm verify` reports nothing when they match.

Two rules to know before you start:

- A database last migrated on Prisma 5 or earlier must migrate on Prisma 7 first. Since Prisma 6.0.0 the implicit many-to-many junction tables (`_PostToTag` here) carry a primary key on `(A, B)` instead of a unique index, and the source describes that shape; on an older database `db sign` reports the difference.
- Every construct the source cannot express is a hard error with the file, line, and what to change, never a silent change. Prisma 7 still owns the database, so any such edit is a Prisma 7 schema change that its next migration applies. The list, with what each edit does to the database, is in the `prisma7Schema` section of the [`@prisma/orm-postgres` README](../../packages/3-extensions/postgres/README.md). In this schema nothing needs editing.

### 3. Move routes one at a time

`src/db.ts` instantiates both clients over the same `DATABASE_URL`, as the guide's `src/db.ts` does: `prisma` (Prisma 7, through `@prisma/adapter-pg`) and `db` (Prisma 8, `postgres<Contract>({ url, contractJson })`). `scripts/seed.ts` and `src/v7-read.ts` are the routes that have not moved: they use the Prisma 7 client. `src/main.ts` is a route that has: it lists users with their posts and the posts' tags through `db.orm.public.User.include('posts', ...)`, reaching the tags through the `_PostToTag` junction Prisma 7 created, creates a post connected to an existing tag through `db.orm.public.Post.include('tags').create({ ..., tags: (tags) => tags.connect([...]) })`, and renames a user through `db.orm.public.User.where(...).update(...)`, printing the `updatedAt` before and after: Prisma 8's own generator sets it, as Prisma 7's `@updatedAt` did. Run `pnpm start` and then `pnpm v7:read` to see the post Prisma 8 wrote come back through Prisma 7.

### 4. Transfer migration ownership, then 5. remove Prisma 7

Out of scope here. When the last route has moved, follow the guide's phase 4 (`prisma migration plan --name baseline`, `prisma db sign`, `prisma migration ref set db <timestamp>_baseline`) and phase 5.

## What a Prisma 7 user meets along the way

- `@prisma/client@7.10.0` declares `prisma` as a peer dependency. With pnpm's default automatic peer installation and no `prisma` dev dependency of your own, the package manager installs Prisma 7's `prisma` to satisfy it, and `prisma contract emit` runs Prisma 7. Keep an explicit `prisma` dev dependency for Prisma 8 (the guide's `prisma@latest`; here the workspace alias) so the `prisma` binary is Prisma 8's.
- pnpm's `trustPolicy: no-downgrade` refuses `prisma@7.10.0`, the dependency behind `@prisma/prisma7`, because earlier `prisma` releases carried provenance attestation and this one does not. The workspace exempts that one exact version in `pnpm-workspace.yaml`.
- Prisma 7 still ships the schema engine as a native binary, fetched by `@prisma/engines` at install time or on the first `prisma7` run, so one run needs network access; the Prisma 7 client itself has no engine to fetch.
- This repository's CI fetches that engine in its own step before the example tests run, so the test itself downloads nothing.
- The guide's `prisma7.config.ts` sets `datasource.url` to `process.env["DATABASE_URL"]`, which is `string | undefined`; under `exactOptionalPropertyTypes` that does not type-check, so this example adds the `datasource` block only when the variable is set. `prisma7 generate` runs without a database either way.
- Prisma 7 rejects `url` inside the `datasource` block; the URL lives only in `prisma7.config.ts` (Prisma 7) and `prisma.config.ts` (Prisma 8), both reading the same `DATABASE_URL` from `.env`.
- Prisma 8 returns `DateTime` columns as `Temporal.PlainDateTime`. Node 24 has no global `Temporal`, so `src/db.ts` imports `temporal-polyfill/full/global` before creating the client.
- `pnpm sign` creates `migrations/` (a snapshot of the signed contract and the `db` ref). It is Prisma 8's record of what was signed and is committed here; phase 4 builds on it.
- The Prisma 8 CLI prints JSON when stdout is not a terminal (a pipe, a file, or an agent) and prose in a terminal.

## Files

| Path | Role |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/` | The Prisma 7 schema and its migrations; Prisma 7 owns both. |
| `prisma7.config.ts` | Prisma 7's config (`@prisma/prisma7/config`). |
| `prisma.config.ts` | Prisma 8's config; `prisma7Schema('prisma/schema.prisma')` is the contract source. |
| `generated/prisma8/` | `contract.json` and `contract.d.ts` emitted by Prisma 8 (committed). |
| `generated/prisma7/` | The Prisma 7 client (`pnpm v7:generate`, gitignored). |
| `src/db.ts` | Both clients over one `DATABASE_URL`. |
| `src/main.ts` | Routes that moved to Prisma 8. |
| `scripts/seed.ts`, `src/v7-read.ts` | Routes still on Prisma 7. |
| `scripts/db-start.ts` | In-process Postgres for local runs. |
| `test/adoption.test.ts` | The whole story on a fresh database, including the second migration. |
