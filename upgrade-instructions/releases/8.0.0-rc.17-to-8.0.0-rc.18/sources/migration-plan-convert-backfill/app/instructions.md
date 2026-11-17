---
changes:
  - id: lossy-type-changes-ask
    summary: |
      On Postgres and SQLite, `migration plan` and `db update` no longer write a type change that can lose values without asking. A script that runs them without a terminal fails with `CLI.CONSENT_REQUIRED` until it passes `--convert <Model.field>` (`migration plan` only: write the conversion into the slot) or `--delete <Model.field>` (the database's own cast runs: it may cut or round values, such as a longer text cut to a shorter `VarChar` on Postgres, and a value it cannot cast fails the apply).
  - id: placeholders-only-when-asked
    summary: |
      `migration plan` writes `placeholder(...)` slots on Postgres and SQLite only for a field that `--convert` or `--backfill` names. A new required field now gets a temporary value in the existing rows (`''`, `0`, …), which the output names, and an optional field made required is tightened directly. Pass `--backfill <Model.field>` to get the backfill step to fill instead.
  - id: required-field-failures-count-rows
    summary: |
      A migration that makes a field required while rows have no value for it fails with `MIGRATION.RUNNER_FAILED`, whose summary counts the rows and whose advice names the fix. Scripts that matched the old summary text (`… failed during precheck: ensure no NULL values in …`) must match the new one, or the `rowsWithoutValue` failure field.
---

# Statements decide placeholders and type changes

A Postgres or SQLite project that changes a field's type so that values may not survive, adds a required field to a table with rows, or makes an optional field required, plans differently.

For each script, CI job or documented workflow that runs `prisma migration plan` or `prisma db update` without a terminal:

1. If it changes a field's type, add `--convert <Model.field>` to `migration plan` and write the conversion into the `using: placeholder('<Model.field>:convert')` slot of the written `migration.ts` as SQL text over the column, such as `using: '"age"::integer'` (on SQLite, the column's copy expression in `recreateTable`, such as `copyExpressions: { age: 'CAST("age" AS INTEGER)' }`), then run `node <package dir>/migration.ts`. Or add `--delete <Model.field>` to accept the database's cast. `db update` accepts only `--delete`.
2. If it adds a required field to a table with rows, or makes an optional field required, and relied on the backfill step `migration plan` used to write, add `--backfill <Model.field>`. Without it the existing rows get a temporary value, or, for a field made required, the apply fails when rows hold NULL. A new unique, primary-key or foreign-key field, or one whose values come from a value set, has no temporary value: use `--backfill` when the table has rows. Fill the slots the plan writes, then run `node <package dir>/migration.ts`. On Postgres, `check` returns a query that finds a row still without a value, and `run` is one closure, or an array of closures, each returning one update (not one closure returning an array): `check: () => db.public.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)` and `run: () => db.public.user.update({ name: '' }).where((f, fns) => fns.eq(f.name, null))`, with `db` the `sql` of `postgres<End>({ contractJson: endContract })`. On SQLite there is only `run`, a closure that returns the SQL text of one statement: ``run: () => `UPDATE "User" SET name = 'user ' || id WHERE name IS NULL` ``.
3. If it parses the failure of such an apply, match the new summary, for example `3 rows of "Item" hold NULL in "note", so it cannot become required.`
