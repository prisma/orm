# Dispatch 1 — `--convert` and `--backfill` reach the planner, and questions know why data is lost

**Slice:** [`../spec.md`](../spec.md) § The two flags, § How the pieces fit, § Implementation notes · **Plan:** [`../plan.md`](../plan.md) dispatch 1 · **Builds on:** slice 2 (merged on `main`)

## Outcome

Both flags are parsed, resolved against the two contracts, and handed to the SQL planners as destination coordinates. The planners do nothing new with them yet. Each data-loss entry says whether it is a `drop` or a `typeChange`, and the questions offer the verbs that fit. `db update` refuses both flags with a clear error.

## What to build

1. **Verbs per command.** `orm/statement-verbs.ts` declares verbs per command. `migration plan`: `rename`, `delete`, `convert`, `backfill`. `db update`: `rename`, `delete`, `allow`, plus `convert` and `backfill` declared only so they can be refused: any value fails with the new `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`, whose message says `db update` has no migration file to fill and names `migration plan`. Error reference entry.
2. **Resolved statements gain a `kind`.** `ResolvedMigrationStatement` (`packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`) becomes `kind: 'rename' | 'convert' | 'backfill'`. Every reader that assumes a rename switches on `kind` first: `describeMigrationStatement`, `migrationStatementJson`, `sameCoordinate` and `renamedModel` in `plan-questions.ts`, `originTable` and `originColumn` in the SQL family `operation-subjects.ts`, `StatementPlanner.plan` in `statement-planning.ts` (today it plans any non-model statement as a column rename), and the MongoDB planner (keeps refusing every statement it cannot carry out).
3. **Resolution rules** (in `resolve-statements.ts`):
   - `convert Model.field`: names the field by its destination name (after `--rename User.age:User.years`, `--convert User.years`); the field exists in the destination and, through any earlier rename, in the origin; its type changes. Needs the origin contract, else `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`.
   - `backfill Model.field`: the field is required in the destination and is either new on a model that exists in the origin or optional in the origin.
   - Anything else is `MIGRATION.STATEMENT_UNRESOLVED` naming what was found.
4. **Handed to the planners.** `migration plan` takes `convert` and `backfill` from the run before planning, like `rename`. The SQL planners receive them as destination coordinates (namespace, table, column) on the strategy context (Postgres `planner-strategies.ts` around `StrategyContext`; SQLite equivalent). They do not go through `planStatements`, which applies renames to the working schema. No strategy reads them yet.
5. **The loss kind.** Each `dataLoss` entry gains `loss: 'drop' | 'typeChange'`, set by each target's operation-subjects function. `dataLossQuestion` stops inferring from whether the destination still has the field. A `typeChange` question offers `convert` and `delete` on `migration plan` and `delete` only on `db update`. A `drop` question offers `rename` and `delete`, as today.
6. **Re-plan with every statement.** `askPlanQuestions` re-plans with all planned statements, not only renames, so a typed `convert` re-plans.
7. **Reporting a delete on a type change.** A `delete` answering a `typeChange` question is described as `delete values of field "User.age" (type change)`, not `delete field`.

## Not in this dispatch

Any planner output change (dispatches 2–4). The temporary default. Docs beyond the error reference entry. Journeys.

## Tests

Unit tests in the CLI and framework-components packages: each resolution rule, both pass and fail; `convert` after a rename uses the new name; `convert` with no origin contract; the verbs offered per loss kind and per command; `db update --convert` fails with the new code before planning; a typed `convert` triggers a re-plan; the delete-on-type-change description; every `kind` switch (a `convert` statement is never planned as a column rename — write the test that would have caught it).

## Halt conditions

Stop and report if the engine cannot declare a verb on `db update` that the command refuses with its own error; or if `dataLoss` producers outside the SQL family (extension spaces applying recorded migrations, MongoDB) cannot set `loss` without a design decision.

## Gate

The plan's gate, plus `pnpm check:error-reference` and `pnpm lint:framework-vocabulary`.
