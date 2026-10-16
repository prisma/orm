# Manual QA: slice 7, generated values

Run against branch `tml-3267-generated-values` after merging `origin/main` and running `pnpm build`. Use the real CLI (the workspace `prisma` bin), a scratch project under `wip/qa/`, and an in-process Postgres from `@prisma/dev` as `examples/prisma7-adoption` does. Record each step's command, output and verdict in `manual-qa-reports/<YYYY-MM-DD>-<runner>.md`.

## 1. A Prisma 7 schema with every new shape loads, signs and verifies

Write `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../generated/prisma7"
}

model Post {
  id        String    @id @default(uuid())
  token     String?   @default(uuid())
  updatedAt DateTime  @default(now()) @updatedAt
  editedAt  DateTime? @updatedAt
  day       DateTime  @updatedAt @db.Date
  at        DateTime  @updatedAt @db.Time(0)
  atz       DateTime  @updatedAt @db.Timetz(3)
}
```

- Prisma 7.10.0 creates the database: `prisma7 migrate dev --name init` (or apply the SQL from `prisma7 migrate diff --from-empty --to-schema prisma/schema.prisma --script`).
- `prisma contract emit` with `contract: prisma7Schema('prisma/schema.prisma')` succeeds.
- `prisma db sign`, then `prisma db verify --strict` report no findings.

## 2. The ORM writes what Prisma 7 would

With the emitted contract, through the Prisma 8 ORM:

- Create a `Post` with no fields given: `id`, `token`, `updatedAt`, `editedAt`, `day`, `at`, `atz` are all filled.
- Create a `Post` with `token: null` and `editedAt: null`: both are stored as `NULL`.
- Update a `Post` changing nothing but one field: `updatedAt`, `day`, `at`, `atz` and `editedAt` change; with `editedAt: null` it stays `NULL`.
- At a time just before midnight (fake the clock in a script, or run near 23:59:59), `at` (`time(0)`) is read back without an error.
- Read the same rows through the Prisma 7 client: the values agree.

## 3. `contract print` writes it and reads it back

- `prisma contract print` prints the model. Check by eye that it uses `@default(now())` beside a `temporal.*` preset, `?` on the optional preset fields, and the new date and time presets.
- `prisma contract print --output src/prisma/contract.prisma`, switch `contract:` to that file, `prisma contract emit`: the contract's storage hash equals the one from step 1, and `prisma db verify --strict` has no findings.

## 4. Refusals that must remain, with messages a user can act on

Each must fail `contract emit` with one diagnostic naming the file, line and fix:

- `title String @updatedAt` → `PSL.PRISMA7_UPDATED_AT_FIELD_INVALID`.
- `tags DateTime[] @updatedAt` → the same code, with Prisma 7's own message about lists.
- `stamp DateTime @updatedAt @db.Text` → the same code, at the `@db.Text` attribute.
- Prisma 8 PSL: a preset that makes the field the primary key, written with `?`, such as `id id.uuidv4Native()?`, → `PSL_PRESET_NOT_OPTIONAL`. A preset with an `onCreate` generator, written with a generating `@default(...)`, such as `id id.uuidv4Native() @default(uuid())`, → `PSL_PRESET_AND_DEFAULT_CONFLICT`, and the first fix it offers is to remove `@default(...)`. Read each message and check it says what to change.
- No Postgres preset sets its own database default today, so the other case of `PSL_PRESET_AND_DEFAULT_CONFLICT` cannot be reached from a real preset.

## 5. An extension's default function prints

- In a Prisma 8 PSL project that composes the slugid test pack from `test/integration/test/authoring/parity/default-pack-slugid/`, a field `@default(slugid())` emits, and `prisma contract print` writes `@default(slugid())` back.

## 6. Upgrade instructions are right

- Follow `upgrade-instructions/pending/now-generators-for-every-date-time-type/app/instructions.md` on `examples/prisma7-adoption` as it was on `main`: re-emit only, no `db sign`, and the app still starts and writes `updatedAt`.
- Read `upgrade-instructions/pending/contract-print-generated-values/extension/instructions.md` as a pack author: could you add `printArguments` to your own default function from it alone?
