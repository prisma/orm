# Dispatch 2 — Postgres: `--convert` writes the conversion slot

**Slice:** [`../spec.md`](../spec.md) § What changes for users, § What the planners write · **Plan:** [`../plan.md`](../plan.md) dispatch 2 · **Builds on:** dispatch 1

## Outcome

On Postgres, a lossy type change plans no placeholder unless `--convert` names the field. With `--convert User.age`, `migration plan` writes one `alterColumnType` whose `using` is `placeholder(...)`, classed `data`. `alterColumnType` takes plain options.

## What to build

1. **Gate the type-change scaffold.** `typeChangeCallStrategy` (`packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`) runs only for a field that a `convert` statement names. Without one, the type change falls through to the direct alter: `widening` for a known-safe widening, `destructive` otherwise, which dispatch 1's questions already ask about.
2. **One slot, in the alter.** With `convert`, the strategy writes a single `alterColumnType` with `using: placeholder('<Model>.<field>:using')` and no separate data transform. No separate NULL transform either: when the field also becomes required, `SET NOT NULL` follows the alter, and the conversion expression can map NULL.
3. **Class `data`.** `AlterColumnTypeClass` gains `data`. A converted alter is `data`, so it is not in `dataLoss`, and a typed `convert` at the prompt resolves the question on re-plan.
4. **Plain options.** The facade's `alterColumnType` (`postgres-migration.ts`) takes `{ table, column, type, using? }` (plus a namespace where the facade needs one; match the neighbouring facade calls). The rendered call shows that shape, with no `qualifiedTargetType`, `formatTypeExpected` or `rawTargetTypeForLabel`. The `using` slot renders as code, imports `placeholder`, and an unfilled slot makes `toOp()` return the unfilled-placeholder result (`unfilledPlaceholderOperation`), so the CLI writes `ops.json` as `[]` with `pendingPlaceholders`.
5. **Upgrade instructions** for hand-written migrations that call `alterColumnType`, using the `record-upgrade-instructions` skill.

## Not in this dispatch

Backfill and the temporary default (dispatch 3). SQLite (dispatch 4). Docs beyond the upgrade instructions.

## Tests

- Planner: a lossy change with no statement plans the direct `destructive` alter; with `convert` plans one `data` alter with the slot; a safe widening ignores `convert` (dispatch 1's resolver already refuses a convert with nothing to convert — keep that).
- Rendering: the rendered `migration.ts` for a convert; filling the slot with `'"age"::integer'` and running the file produces an `ops.json` whose SQL is `ALTER TABLE ... TYPE integer USING "age"::integer`; that SQL runs on PGlite against rows holding numeric strings and converts them.
- CLI: `migration plan --convert User.age` reports `pendingPlaceholders`; a typed `convert` at the prompt re-plans and asks nothing more.
- Update `render-typescript.test.ts`, `postgres-issue-planner.test.ts` and any test that asserted the old automatic scaffold.

## Halt conditions

Stop and report if the `using` slot cannot render as code without changing the shared call-rendering helper for every call; or if any example migration under `examples/` calls `alterColumnType` with the old options in a way the upgrade instructions cannot describe.

## Gate

The plan's gate, plus `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD`, and `test/integration/test/cli-journeys/data-transform-strategies.e2e.test.ts` (its type-change scenario changes).
