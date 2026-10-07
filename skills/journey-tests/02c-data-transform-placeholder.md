# Journey 02c — Fill a placeholder data transform

**Skills under test:** `prisma-8` (`references/migrations.md` § *Workflow — Fill a placeholder* and § *Data changes go in a data transform*). Postgres.

**Acceptance criterion:** AC5c.

## Prompt

> Add a `displayName String` field to User, NOT NULL, defaulting to the user's email if displayName isn't set yet.

## Expected agent behavior

- [ ] Adds `displayName String` (required, no default) to the contract and runs `prisma contract emit`.
- [ ] Runs `prisma migration plan` and sees `pendingPlaceholders: true`. The rendered `migration.ts` holds `this.addColumn(...)` for a nullable `displayName`, `this.dataTransform(endContract, 'backfill-user-displayName', { check: () => placeholder(...), run: () => placeholder(...) })` and `this.setNotNull(...)`.
- [ ] Adds `const { sql: db, contract } = postgres<End>({ contractJson: endContract })` and passes that `contract` as the first argument of `this.dataTransform`, in place of the rendered `endContract`. Replaces the two `placeholder(...)` arrows with SQL query builder queries: `check` selects `id` where `displayName` is null, limit 1; `run` sets `displayName` from `email` where `displayName` is null. Leaves the rest of the rendered operation list as it is.
- [ ] Self-emits the migration (`node migrations/app/<dir>/migration.ts`).
- [ ] Applies with `prisma db migrate`.

## Success criteria

- [ ] No `placeholder(...)` is left in `migration.ts`.
- [ ] The data transform has a `check`, and no `rawSql` step, `db.raw.sql` query or `fns.raw` expression writes rows.
- [ ] Self-emit completed without `MIGRATION.UNFILLED_PLACEHOLDER`, and `ops.json` changed after the TS edit.
- [ ] `db migrate` completed without an error.
- [ ] Existing rows have a non-null `displayName`.
