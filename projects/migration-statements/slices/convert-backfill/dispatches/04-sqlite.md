# Dispatch 4 — SQLite: `--convert`, `--backfill` and the temporary value

**Slice:** [`../spec.md`](../spec.md) § What the planners write, § Implementation notes · **Plan:** [`../plan.md`](../plan.md) dispatch 4 · **Builds on:** dispatches 2 and 3

## Outcome

SQLite behaves like Postgres for every row of the spec's table. A table rebuild can copy a column through an expression, which carries the conversion slot and the temporary value.

## What to build

1. **Copy expressions.** `recreateTable` (`packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts`) takes a per-column copy expression for the `INSERT INTO … SELECT` step. `RecreateTableCall` renders it as code, so it can hold `placeholder(...)`, and an unfilled slot makes `toOp()` return the unfilled-placeholder result.
2. **`--convert`.** A lossy type change plans nothing without a statement (the destructive rebuild that dispatch 1's questions ask about). With `--convert`, the rebuild's copy expression for the column is `placeholder('<Model>.<field>:using')`, and the rebuild is classed `data`.
3. **`--backfill`.** New required field: add the column nullable, a `dataTransform` with placeholders, then a tightening rebuild. Optional made required: `dataTransform`, then the tightening rebuild. `nullabilityTighteningBackfillStrategy` runs only for a field `--backfill` names.
4. **No flag.** Optional made required: the tightening rebuild, `widening`. New required field on an existing table: a rebuild whose copy expression for the new column is a fill value, under both commands. Refused for a column in a new primary key, unique or foreign key, as on Postgres.
5. **Fill values.** A SQLite fill-value map, consulted after the codec hook as on Postgres: integer `0`, real `0`, text `''`, blob `X''`, and whatever SQLite's boolean and date-time codecs store (find them in the SQLite target's codecs; do not guess).

## Tests

- Planner: each row of the spec's table for SQLite, with and without each flag, under `migration plan` and `db update`.
- Rendering round trip for the rebuild with a copy expression and with a placeholder.
- On SQLite with rows: the conversion slot filled with `CAST("age" AS INTEGER)` converts the values; the temporary value lands in old rows and the column is `NOT NULL`; the backfill scaffold, filled, applies.
- `delete-statements-migration.sqlite.e2e.test.ts` journey S3 now adds the required field to a table with rows (it used an empty table because of this gap).
- The deferred item "SQLite `db update` cannot add a required field to a table that has rows" is closed: remove it from `projects/migration-statements/deferred.md`.

## Halt conditions

Stop and report if a SQLite codec stores booleans or dates in a form that has no safe fill value; or if the copy expression cannot be added without changing the rebuild's postcheck SQL for plans that do not use it (existing `ops.json` must not change).

## Gate

The plan's gate, plus `pnpm fixtures:check` and every file under `test/integration` or `test/e2e` that runs `migration plan` or `db update` against SQLite with a type change or a new required field (directly or through `journey-test-helpers.ts`, F44).
