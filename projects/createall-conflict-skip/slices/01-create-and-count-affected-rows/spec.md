# Slice 1: `createAndCount` returns the database count

Project: [`../../spec.md`](../../spec.md) · Plan entry: [`../../plan.md`](../../plan.md) § Slice 1 · Linear issue: _not yet created_

## Outcome

`createAndCount` on the SQL ORM client returns the number of rows the database reports inserting, taken from the execute statistics (`affectedRows`), on both the single-statement Postgres path and the SQLite split path. It never returns `data.length`.

## Why

`packages/3-extensions/sql-orm-client/src/collection.ts` returns `data.length` from `createAndCount` on both paths. `updateAndCount` and `deleteAndCount` already return `stats.affectedRows`. The next slice adds a conflict-skip option that makes the database insert fewer rows than were passed, so the count must come from the database before that lands. It is a bug independent of that feature.

## In scope

- `createAndCount` in `collection.ts`: single-statement path returns `stats.affectedRows`; split path sums `affectedRows` across the per-group statements.
- Tests that fail against the current implementation and pass after the fix, in the unit tier (`packages/3-extensions/sql-orm-client/test/`) and the Postgres integration tier (`test/integration/test/sql-orm-client/`). A SQLite end-to-end assertion if the existing `test/e2e/framework/test/sqlite/orm.test.ts` harness makes it cheap.
- The doc comment on `createAndCount` says the count is the database's.

## Out of scope

- Any conflict-skip behaviour. That is slice 2.
- `createAll`, `create`, MTI paths, Mongo.
- Changing the execute statistics shape.

## Edge cases

| Case | Expected |
| --- | --- |
| Empty input | Returns 0 without executing, as today. |
| Postgres, N rows, all inserted | Returns N, sourced from `affectedRows`, not from `data.length`. |
| SQLite split path, rows in two column-signature groups | Returns the sum of both statements' `affectedRows`. |
| Database inserts fewer rows than passed | Returns the database's number. If no cheap way exists to make Postgres drop a row before slice 2, the unit tier proves the source of the number by stubbing the runtime's execute statistics. |

## Slice Definition of Done

Inherits [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md) slice overlay.

- [ ] A test exists that fails on `main` and passes on this branch, proving the count comes from execute statistics.
- [ ] `pnpm --filter @internal/sql-orm-client test`, `pnpm --filter @internal/sql-orm-client lint`, `pnpm typecheck` pass.
- [ ] `pnpm test:integration` for `sql-orm-client/create` passes.
- [ ] No `projects/` reference in any long-lived file touched.
