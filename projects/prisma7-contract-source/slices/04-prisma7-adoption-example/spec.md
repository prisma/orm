# Slice 4: the Prisma 7 adoption example app

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: an example app under `examples/` shows a real Prisma 7 project adopting Prisma 8 side by side exactly as the public upgrade guide describes, except that the guide's "infer, then hand-edit" step becomes "point Prisma 8 at the Prisma 7 schema"._

## The documented story this example follows

Source: [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql), read 2026-09-14. Its phases:

1. Prepare Prisma 7 for side-by-side operation: the `prisma` dev dependency becomes `@prisma/prisma7` (binary `prisma7`), `prisma.config.ts` becomes `prisma7.config.ts` importing `defineConfig` from `@prisma/prisma7/config`, scripts call `prisma7 generate`, `prisma7 migrate dev`, `prisma7 migrate status`. `@prisma/client@^7.10.0` and `@prisma/adapter-pg@^7.10.0` stay.
2. Add Prisma 8: `prisma@latest` as a dev dependency (binary `prisma`) and `@prisma/orm-postgres` as a dependency; `prisma.config.ts` with `definePrismaConfig` from `prisma/config` wrapping `defineConfig` from `@prisma/orm-postgres/config` with `contract`, `output`, and `db.connection`. Today the guide then runs `prisma contract infer`, deletes the `PrismaMigrations` model by hand, adds `@@map` to every model by hand, and runs `prisma contract emit`. **This example replaces that step with `contract: prisma7Schema('prisma/schema.prisma')` and no hand edits.**
3. Migrate one route: both clients instantiated, routes moved one at a time to `db.orm.public.<Model>`.
4. Transfer migration ownership: `prisma migration plan --name baseline`, `prisma db sign`, `prisma migration ref set db <timestamp>_baseline`; from then on Prisma 8 owns migrations.
5. Remove Prisma 7.

During phases 1 to 3, Prisma 7 owns migrations; after each `prisma7 migrate dev` the Prisma 8 contract is refreshed and `db sign` re-run. There is no binary collision: Prisma 7 is `prisma7`, Prisma 8 is `prisma`.

## At a glance

```bash
cd examples/prisma7-adoption
pnpm db:start     # in-process Postgres, writes DATABASE_URL to .env
pnpm v7:migrate   # prisma7 migrate deploy: Prisma 7 applies its own migrations
pnpm emit         # prisma contract emit: Prisma 8 reads prisma/schema.prisma via prisma7Schema
pnpm sign         # prisma db sign: verifies the database, records the marker
pnpm verify       # prisma db verify: zero findings
pnpm seed         # rows written through the Prisma 7 client
pnpm start        # the same rows read and written through the Prisma 8 ORM
pnpm test         # the whole story as one vitest run, including the second migration
```

## Chosen design

- **Prisma 7 exactly as the guide installs it.** Dev dependency `@prisma/prisma7@7.10.0`, dependencies `@prisma/client@7.10.0` and `@prisma/adapter-pg@7.10.0`, `prisma7.config.ts` importing `defineConfig` from `@prisma/prisma7/config` with `schema`, `migrations.path`, and `datasource.url` from `.env`, and `generator client { provider = "prisma-client", output = "../generated/prisma7" }` in the schema. Two committed migrations under `prisma/migrations/`: the initial one and one adding `Post.viewCount Int @default(0)`. Seeding and a `src/v7-read.ts` use the generated Prisma 7 client through `@prisma/adapter-pg`, so both clients are shown on one database, as the guide's phase 3 does.
- **Prisma 8 from the workspace.** Inside this repository the Prisma 8 CLI is the workspace-local `prisma` bin and the config wrapper is `definePrismaConfig` from `@prisma/cli-engine`, because the published `prisma` package that re-exports it as `prisma/config` is built elsewhere. The example's `prisma.config.ts` uses the workspace form, and its README says what the published form is, with one sentence explaining the difference. `contract: prisma7Schema('prisma/schema.prisma')` with no options, `output: 'generated/prisma8'` on `defineConfig` as the guide sets it, and `db.connection` from `.env`.
- **Database.** In-process Postgres from `@prisma/dev` as the other examples do; `db:start` writes `DATABASE_URL` into `.env`.
- **Schema.** The guide's own `User` and `Post` models, extended enough to exercise what the source handles: `User` gains `role Role @default(USER)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`; `Post` gains `content String?` and `tags Tag[]`; `Tag` (`id`, `name @unique`, `posts Post[]`); enum `Role`. The implicit many-to-many is deliberate.
- **Queries.** `src/main.ts` uses the Prisma 8 ORM client (`db.orm.public.User`, the guide's spelling): list users with posts and their tags through `_PostToTag`, create a post connected to existing tags, update a post and show `updatedAt` advanced by the Prisma 8 generator. `src/v7-read.ts` reads the same rows through the Prisma 7 client.
- **Test.** `test/adoption.test.ts` runs the story in order on a fresh dev database: `prisma7 migrate deploy`, `contract emit`, `db sign`, `db verify` with zero findings, seed through Prisma 7, read through Prisma 8, second `prisma7 migrate deploy`, `contract emit` and `db sign` again, `db verify` zero findings. Wired into the CI job that runs the other examples' tests.
- **Phase 4 is out of scope.** The cutover (`migration plan --name baseline`, `migration ref set`) belongs with slice 3's converter; the README ends by pointing at the guide's phase 4.

## Edge cases

| Case | Disposition |
|---|---|
| `pnpm-workspace.yaml` policy blocks a Prisma 7 package (release cooldown, `allowBuilds` for `@prisma/client` or `@prisma/engines` postinstall, `trustPolicy`) | Add the minimal entry with a comment naming this example, pinned to the exact version. Halt if a global relaxation would be needed. |
| `prisma7 migrate deploy` cannot reach the `@prisma/dev` database through `@prisma/adapter-pg` | Halt and report; do not fall back to raw SQL, because running Prisma 7 for real is the point of this example. |
| `prisma7 generate` needs network or a postinstall | Record what it needs in the README; halt if CI cannot satisfy it. |
| `contract.d.ts` imports workspace-internal names | The example's `package.json` depends on `@prisma/orm-postgres`, as the `prisma7Schema` README requires. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] `pnpm --filter prisma7-adoption test` runs the full story green on a fresh dev database, and the example is included wherever CI runs example tests.
- [ ] `pnpm start` output shows users with posts and tags read through the junction and an `updatedAt` that advances on update; `pnpm v7:read` shows the same rows through Prisma 7.
- [ ] README walks a Prisma 7 user through the story in the guide's order, names the guide, shows both config forms, states the Prisma 5 junction caveat and the hard-error rule, and points at phase 4 for cutover.
- [ ] The `prisma7Schema` section of `packages/3-extensions/postgres/README.md` shows the published `prisma/config` import as the primary form, with the workspace form noted for contributors.
- [ ] The workspace lockfile change is the example's dependencies only; no framework, family, target, or extension package depends on Prisma 7.
- [ ] `docs/` mention of the example added where the other examples are listed.
