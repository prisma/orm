# Dispatch 3 — Postgres: `--backfill`, and the temporary default as a real call

**Slice:** [`../spec.md`](../spec.md) § What changes for users, § What the planners write · **Plan:** [`../plan.md`](../plan.md) dispatch 3 · **Builds on:** dispatch 1 (dispatch 2 may land first; nothing here depends on it)

## Outcome

On Postgres, `migration plan` writes a backfill placeholder only for a field `--backfill` names. Without it, a new required field on an existing table gets the temporary default under `migration plan` as well as `db update`, and an optional field made required is a direct `SET NOT NULL`. The temporary default renders as a call that reproduces `ops.json`.

## What to build

1. **Gate the backfill scaffolds.** `notNullBackfillCallStrategy` and `nullableTighteningCallStrategy` (`planner-strategies.ts`) run only for a field a `backfill` statement names.
   - New required field with `--backfill`: nullable add, `dataTransform` with placeholders, `SET NOT NULL` (today's recipe).
   - Optional made required with `--backfill`: `dataTransform` with placeholders, `SET NOT NULL`.
2. **No flag.**
   - New required field on an existing table: the temporary-default recipe (`notNullAddColumnCallStrategy`), now under `migration plan` too. It keeps today's refusal for a column in a new primary key, unique or foreign key, falling back to the empty-table direct add as today.
   - Optional made required: a direct `SET NOT NULL`, `widening`.
3. **A real call.** `AddNotNullColumnWithTempDefaultCall` and `AddNotNullColumnDirectCall` render today as `rawSql({ id, label, operationClass })` with no SQL (`op-factory-call.ts`), so re-running `migration.ts` does not reproduce `ops.json`. Render each as a facade call (a new facade method on the Postgres migration class, or an existing one with the right options) that builds the same operation. Running the written `migration.ts` reproduces `ops.json` byte for byte.

## Not in this dispatch

SQLite (dispatch 4). The NOT NULL failure text (dispatch 5). Docs and upgrade fragment (dispatch 6).

## Tests

- Planner: each row of the spec's table for Postgres, with and without `--backfill`, under `migration plan` and `db update`.
- Rendering round trip: the temporary default and the direct add, written by `migration plan`, re-run, `ops.json` identical.
- On PGlite: the temporary-default migration applied to a table with rows leaves the column `NOT NULL` with no default and the fill value in old rows; the backfill scaffold, filled with an `UPDATE`, applies.
- Update `render-typescript.test.ts` (its pinned `rawSql` output changes), `nullability-backfill` and any test that asserted the automatic scaffold; `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` (around lines 130–160) needs `--backfill`.

## Halt conditions

Stop and report if the temporary default cannot be expressed as a facade call without exposing internal operation fields in `migration.ts`; or if a codec's temporary value cannot be rendered as code.

## Gate

The plan's gate, plus `pnpm fixtures:check` and the named journeys `data-transform-strategies`, `invariant-routing`, and any other file under `test/integration` or `test/e2e` that reaches `migration plan` or `db update` with a new required field (find them through the helpers in `test/integration/test/utils/journey-test-helpers.ts` as well as the command names).
