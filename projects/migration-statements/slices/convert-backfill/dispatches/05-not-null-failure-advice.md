# Dispatch 5 — The NOT NULL failure names the NULL rows (TML-3517)

**Slice:** [`../spec.md`](../spec.md) § How the pieces fit · **Plan:** [`../plan.md`](../plan.md) dispatch 5 · **Builds on:** dispatches 3 and 4

## Outcome

When `SET NOT NULL` on Postgres, or a tightening rebuild on SQLite, meets NULL values, the command says how many rows hold NULL in which column, and how to fix it. It no longer talks about schema drift.

Today, on Postgres:

```text
✖ [MIGRATION.RUNNER_FAILED] Operation alterNullability.setNotNull.Item.note failed during precheck: ensure no NULL values in "note"
  why: Migration runner failed
→ Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma db update`
```

After:

```text
✖ [MIGRATION.RUNNER_FAILED] 3 rows of "Item" hold NULL in "note", so it cannot become required.
→ Set a value in those rows, or keep the field optional.
→ Or plan it with `prisma migration plan --backfill Item.note` and fill the backfill step.
```

## What to build

1. **The runner reports the count.** When the precheck that refuses NULLs fails (Postgres `runner.ts` around lines 331–355), the runner counts the NULL rows and returns a `why` with the table, the column and the count. SQLite: the tightening rebuild's copy fails with `NOT NULL constraint failed`; turn that into the same report, with the count.
2. **A `fix` on the failure.** `MigrationRunnerFailure` gains an optional `fix`. The `db update`, `db init` and `migrate` error mappers (`db-update-failure.ts` around lines 23–27, and the matching spots for the other two) use it when present, instead of the fixed drift advice.
3. **A required column added to an empty table only** (a new unique, primary-key or foreign-key column, or a type with no temporary value such as a native enum) fails its empty-table precheck on a table with rows. Today `db migrate` says "Fix the issue and re-run" and `db update` says to reconcile schema drift. Give it its own advice naming the field: plan it with `migration plan --backfill <Model.field>` and fill the step, make the field optional, or give it a default. On `db update`, point to `migration plan`. (Review finding D3-1 of dispatch 3; the reviewer confirmed the `--backfill` route applies for an enum column and a unique column.)
4. **The fix names a flag only where it applies.** `--backfill` is suggested for `db update` and `migration plan`, written in the field's contract name when the origin contract is known, and through `statementFlag` so it is shell-quoted. Under `migrate`, the advice says to fix the rows and re-run, since the migration is already written.

## Tests

On PGlite and SQLite, a table with NULLs in a field made required: each command prints the count and the fix; following the fix (set the values, re-run) applies; following the `--backfill` advice plans a backfill scaffold. The previous text no longer appears.

## Gate

The plan's gate, plus `pnpm check:error-reference` if a code or entry changes, and every journey that asserts the old drift advice.
