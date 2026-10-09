# Adopting Prisma 8 beside Prisma 7

A Prisma 7 project (PostgreSQL) adopts Prisma 8 the way the public guide [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) describes, with one change: instead of running `prisma contract infer` and hand-editing the inferred contract, Prisma 8 reads `prisma/schema.prisma` directly through `prisma7Schema(...)`. Prisma 7 is installed for real (`@prisma/prisma7`, `@prisma/client`, `@prisma/adapter-pg`, all 7.10.0). At first it keeps owning the database and its migrations, while Prisma 8 reads the schema, signs and verifies the database, and serves the routes that have moved. Then Prisma 8 takes over the migrations, and Prisma 7 only generates its client. Nothing is hand-edited.

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
pnpm test                # the whole story on a fresh database, including the second migration and the handover
```

`prisma/migrations/` holds two Prisma 7 migrations, the initial one and one adding `Post.viewCount`. On a fresh database `pnpm v7:migrate` applies both at once, so to watch the refresh loop that every later Prisma 7 migration needs, run `pnpm test`: it rolls a scratch copy of this example back to the first migration, runs the commands above, then lands the second migration and runs `pnpm emit`, `pnpm sign`, and `pnpm verify` again. Until phase 4, after every `prisma7 migrate deploy` (or `migrate dev`) that is the whole loop: emit, sign, verify. Nothing else changes.

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

`prisma7Schema` replaces the guide's `prisma contract infer` step and the hand edit after it (adding `@@map` to every model): the source reads the Prisma 7 schema itself, so model names stay as written. Neither `prisma contract infer` nor the source puts Prisma 7's `_prisma_migrations` table in the contract. `pnpm emit` writes `generated/prisma8/contract.json` and `contract.d.ts`; `pnpm sign` verifies the live schema against that contract and writes Prisma 8's marker; `pnpm verify` reports nothing when they match.

Two rules to know before you start:

- A database last migrated on Prisma 5 or earlier must migrate on Prisma 7 first. Since Prisma 6.0.0 the implicit many-to-many junction tables (`_PostToTag` here) carry a primary key on `(A, B)` instead of a unique index, and the source describes that shape; on an older database `db sign` reports the difference.
- Every construct the source cannot express is a hard error with the file, line, and what to change, never a silent change. Prisma 7 still owns the database, so any such edit is a Prisma 7 schema change that its next migration applies. The list, with what each edit does to the database, is in the `prisma7Schema` section of the [`@prisma/orm-postgres` README](../../packages/3-extensions/postgres/README.md). In this schema nothing needs editing.

### 3. Move routes one at a time

`src/db.ts` instantiates both clients over the same `DATABASE_URL`, as the guide's `src/db.ts` does: `prisma` (Prisma 7, through `@prisma/adapter-pg`) and `db` (Prisma 8, `postgres<Contract>({ url, contractJson })`). `scripts/seed.ts` and `src/v7-read.ts` are the routes that have not moved: they use the Prisma 7 client. `src/main.ts` is a route that has: it lists users with their posts and the posts' tags through `db.orm.public.User.include('posts', ...)`, reaching the tags through the `_PostToTag` junction Prisma 7 created, creates a post connected to an existing tag through `db.orm.public.Post.include('tags').create({ ..., tags: (tags) => tags.connect([...]) })`, and renames a user through `db.orm.public.User.where(...).update(...)`, printing the `updatedAt` before and after: Prisma 8's own generator sets it, as Prisma 7's `@updatedAt` did. Run `pnpm start` and then `pnpm v7:read` to see the post Prisma 8 wrote come back through Prisma 7.

### 4. Transfer migration ownership, then 5. remove Prisma 7

Prisma 8 can take over migrations while `prisma/schema.prisma`, in the Prisma 7 dialect, stays the contract source and Prisma 7 keeps generating the client that serves the routes that have not moved. `test/handover.test.ts` runs this phase on a fresh database. Its starting point is the end of phase 3: Prisma 7 has applied both of its migrations, and `prisma contract emit`, `prisma db sign` and `prisma db verify` have run.

From then on, you edit `prisma/schema.prisma` as before, and Prisma 8 plans and applies the change:

```bash
# edit prisma/schema.prisma in the Prisma 7 dialect
pnpm exec prisma contract emit
pnpm exec prisma migration plan --name add-comments
pnpm exec prisma db migrate --advance-ref db
pnpm exec prisma db verify --strict       # zero findings, nothing unclaimed
pnpm exec prisma db verify                # zero findings
pnpm exec prisma7 migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --config prisma7.config.ts
                                          # -- This is an empty migration.
pnpm exec prisma7 generate --config prisma7.config.ts
```

The test runs that loop three times. Each edited schema is a file in `test/handover/`:

- `edit-1.prisma` makes additive changes. It adds `User.bio String?`, `Post.likes Int @default(0)`, `@@index([authorId])` on `Post`, and a `Comment` model with a required relation to `Post`. The plan creates the `Comment` table, adds both columns, creates the index `Post_authorId_idx`, and adds the foreign key `Comment_postId_fkey` with `ON DELETE RESTRICT ON UPDATE CASCADE`. Those are the names and referential actions Prisma 7 would have written. After `prisma7 generate`, the Prisma 7 client writes and reads the new columns and the new model (`test/handover/v7-after-edit-1.ts`), and the Prisma 8 ORM reads them (`test/handover/v8-after-edit-1.ts`).
- `edit-2.prisma` makes destructive changes. It drops `User.bio` and makes `Post.likes` optional with no default. The plan drops the column, drops the default, and drops `NOT NULL`. After `prisma7 generate`, the Prisma 7 client reads the surviving columns and clears one post's `likes` to null (`test/handover/v7-after-edit-2.ts`), and the Prisma 8 ORM reads that null back (`test/handover/v8-after-edit-2.ts`).
- `edit-3.prisma` gives the existing `Post.viewCount` column, which already has rows, `@default(autoincrement())`, and names the `Post.author` foreign key with `map: "Post_author_fk"`. The plan creates the sequence `Post_viewCount_seq`, sets the column's default to it, makes the column own it, and starts it one past the largest `viewCount`; it also renames `Post_authorId_fkey` to `Post_author_fk`. After `prisma7 generate`, a post the Prisma 7 client creates without a `viewCount` gets the next number (`test/handover/v7-after-edit-3.ts`).

What each step does:

- **The first `migration plan` writes two packages.** The migrations directory has no migrations yet, only the `db` ref that `prisma db sign` wrote. So the first plan first writes a baseline package, from an empty database to the signed contract. It then writes the package for your change, from the signed contract to the new one. There is no separate baseline step. `db migrate` never runs the baseline on this database, because the database's marker already sits at the signed contract. The baseline is there so that a fresh database, such as a new developer's or a CI database, can be built from `migrations/` alone. The test proves it: `prisma db migrate` against a second, empty database applies all four packages, and `db verify --strict` then passes with nothing unclaimed.
- **`db migrate --advance-ref db` moves the `db` ref along with the marker.** Plain `db migrate` moves only the database marker. The next `migration plan` starts from the `db` ref, so without the flag it would plan from the contract before your last change.
- **`db verify --strict` passes with nothing unclaimed.** Strict mode fails on any table no contract declares, but it leaves out `_prisma_migrations`: that table is Prisma 7's migration ledger, not part of your application's schema. `prisma contract infer` leaves it out for the same reason. Any finding is real drift.
- **`prisma7 migrate diff` shows Prisma 7 agrees with the database.** An empty migration means the tables, indexes and constraints Prisma 8 created are the ones Prisma 7 would have created from the same schema.
- **A destructive plan is not confirmed at a prompt.** `migration plan` writes the package to `migrations/app/<timestamp>_<name>/`, marks the destructive operations in its output, and prints the SQL. Review that package before running `db migrate`; nothing else asks. The only prompt comes when the first plan's baseline itself would destroy data, and a baseline that only creates the existing schema never does.
- **Never run `prisma7 migrate` again.** Once Prisma 8 has applied a migration, `prisma/migrations/` no longer describes the database. `prisma7 migrate dev` would report drift and offer to reset the database, and a new migration applied with `prisma7 migrate deploy` would change the schema without moving Prisma 8's marker. From here on, Prisma 7 runs only `prisma7 generate`.

When the last route has moved to Prisma 8, `pnpm exec prisma contract print --output prisma/contract.prisma` writes the Prisma 8 PSL that produces the same contract this example emits from `prisma/schema.prisma`. Point `contract` in `prisma.config.ts` at the written file, then run `pnpm exec prisma contract emit` again to confirm the contract is unchanged. Then remove Prisma 7 as the [upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql)'s phase 5 describes.

## What a Prisma 7 user meets along the way

- `@prisma/client@7.10.0` declares `prisma` as a peer dependency. With pnpm's default automatic peer installation and no `prisma` dev dependency of your own, the package manager installs Prisma 7's `prisma` to satisfy it, and `prisma contract emit` runs Prisma 7. Keep an explicit `prisma` dev dependency for Prisma 8 (the guide's `prisma@latest`; here the workspace alias) so the `prisma` binary is Prisma 8's.
- pnpm's `trustPolicy: no-downgrade` refuses `prisma@7.10.0`, the dependency behind `@prisma/prisma7`, because earlier `prisma` releases carried provenance attestation and this one does not. The workspace exempts that one exact version in `pnpm-workspace.yaml`.
- Prisma 7 still ships the schema engine as a native binary, fetched by `@prisma/engines` at install time or on the first `prisma7` run, so one run needs network access; the Prisma 7 client itself has no engine to fetch.
- This repository's CI fetches that engine in its own step before the example tests run, so the test itself downloads nothing.
- The guide's `prisma7.config.ts` sets `datasource.url` to `process.env["DATABASE_URL"]`, which is `string | undefined`; under `exactOptionalPropertyTypes` that does not type-check, so this example adds the `datasource` block only when the variable is set. `prisma7 generate` runs without a database either way.
- Prisma 7 rejects `url` inside the `datasource` block; the URL lives only in `prisma7.config.ts` (Prisma 7) and `prisma.config.ts` (Prisma 8), both reading the same `DATABASE_URL` from `.env`.
- Where Prisma 7 named a primary key or foreign key differently from Prisma 8, the contract states Prisma 7's name: a `map` on `@id`, `@@id` or `@relation`, a junction's primary key such as `_PostToTag_AB_pkey`, and a foreign key name Prisma 7 cut to 63 bytes. `db verify` does not compare these names, but migrations drop and rename constraints by them.
- Prisma 8 reads a `DateTime` column as the text PostgreSQL prints, such as `2026-09-14 10:00:00.123` (UTC, as Prisma 7 wrote it), not as a JavaScript `Date`. `@db.Timestamptz`, `@db.Date` and `@db.Time` columns read as text too, so the application needs no `Temporal`.
- `pnpm sign` creates `migrations/` (a snapshot of the signed contract and the `db` ref). It is Prisma 8's record of what was signed and is committed here; in phase 4 the first `migration plan` builds the baseline from it.
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
| `test/adoption.test.ts` | Phases 1 to 3 on a fresh database, including the second Prisma 7 migration. |
| `test/handover.test.ts` | Phase 4 on a fresh database: Prisma 8 plans, applies and verifies an additive and a destructive edit. |
| `test/handover/` | The two edited schemas, the scripts each client runs after them, and the tsconfigs the test typechecks those scripts with once the edit is applied. |
| `test/story.ts` | Helpers both tests share. |
