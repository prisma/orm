# Journey 02c — Fill a placeholder data transform

**Skills under test:** `prisma-8` (`references/migrations.md` § *Workflow — Fill a placeholder* and § *Data changes go in a data transform*). Postgres.

**Acceptance criterion:** AC5c.

## Setup

The `User` table holds at least one row, created before the migration is planned. Every row has a non-null `email`.

## Prompt

> Add a `displayName String` field to User, NOT NULL, defaulting to the user's email if displayName isn't set yet.

The request is a backfill of existing rows. New rows supply `displayName` themselves.

## Expected agent behavior

- [ ] Adds `displayName String` (required, no default) to the contract and runs `prisma contract emit`.
- [ ] Runs `prisma migration plan --name <slug> --backfill User.displayName` and sees `pendingPlaceholders: true`. The rendered `migration.ts` holds `this.addColumn(...)` for a nullable `displayName`, a `this.dataTransform(endContract, …, { check: () => placeholder('User.displayName:check'), run: () => placeholder('User.displayName:run') })` and `this.setNotNull(...)`.
- [ ] Adds `const { sql: db, contract } = postgres({ contract: contractFromJson<End>(endContract) })` and passes that `contract` as the first argument of `this.dataTransform`, in place of the rendered `endContract`. Replaces the two `placeholder(...)` arrows with SQL query builder queries: `check` selects `id` where `displayName` is null, limit 1; `run` sets `displayName` from `email` where `displayName` is null. Leaves the rest of the rendered operation list as it is.
- [ ] Self-emits the migration (`node <package dir>/migration.ts`).
- [ ] Applies with `prisma db migrate`.

## Success criteria

- [ ] No `placeholder(...)` is left in `migration.ts`.
- [ ] The data transform has a `check`. Both `check` and `run` are SQL query builder queries: neither uses a `db.raw.sql` query or an `fns.raw` expression, and no `rawSql` step writes rows.
- [ ] Self-emit completed without `MIGRATION.UNFILLED_PLACEHOLDER`, and `ops.json` changed after the TS edit.
- [ ] `db migrate` completed without an error.
- [ ] Every row from the setup has a `displayName` equal to its `email`.
