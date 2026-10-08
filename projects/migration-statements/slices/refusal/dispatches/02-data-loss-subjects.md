# Dispatch 2 — The planner result names what each destructive operation would lose

**Slice:** [`../spec.md`](../spec.md) § "The structured refusal" · **Plan:** [`../plan.md`](../plan.md) dispatch 2 · **Builds on:** dispatch 1

## Outcome

The planner's success result says, for every operation that loses data and for every operation that widens access to rows, which domain thing it is about, so the CLI can ask the user about it in contract vocabulary without any family code in the framework.

## What to build

1. **Framework type** (`packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`): `MigrationStatementSubject = { kind: 'model' | 'field', namespaceId, model, field? } | { kind: 'storage', name }`, with its JSON form next to `migrationStatementJson` (leave `namespaceId` out for the unbound namespace, as statements do). `MigrationPlannerSuccessResult` gains `dataLoss: readonly { operationIndex: number; subject: MigrationStatementSubject }[]` and `accessWidening` of the same shape. Both required; every planner fills them.
2. **SQL family** (`packages/2-sql/9-family/src/core/migrations/`): after a plan is assembled, walk its operations; for each `destructive` one, map its table or column back to a model or field of `fromContract` through `model.storage.table` and `fields[f].column` (reverse of `modelTable`/`fieldColumn` in `statement-planning.ts`), with the rename statements already applied, so a table renamed earlier in the plan is found under its old name in the origin. No `fromContract`, or a table no model stores: `{ kind: 'storage', name }`. Index entries by the operation that loses the data; on SQLite a table rebuild that drops columns is that operation, not the later `dropColumn`, so list the dropped field once, at the rebuild's index. `accessWidening`: the `DropPostgresRlsPolicyCall` and `DisableRowLevelSecurityCall` operations, subject the table's model, excluding the transient DROP of a policy replacement (see `gradePolicyReplacement` and the replacement path in `planner.ts`).
3. **MongoDB**: `dropCollection` entries with the model whose collection it is; `accessWidening` empty.
4. **Safe type widenings on `db update`** (dispatch 1 left this open; the reviewer's finding is in `../reviews/code-review.md` round 1 item 7): in `mapColumnNodeIssue` (`packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` ~L654-705) the live column has no codec but carries a normalised `resolvedNativeType`. Map that name to a data type id through the written text of the parameterless types (`data-types.ts` ~L140-200) and reuse `SAFE_WIDENINGS`; require `many` false on both sides. A safe pair gets `'widening'`. Test through the issue planner with an introspected `int4` column and an `int8` contract column.
5. **Aggregate and `db update` plumbing** (`packages/1-framework/3-tooling/migration/src/aggregate/`): `PerSpacePlan` and `planFromDiff` carry `dataLoss` and `accessWidening` through; `db-run.ts`'s plan result exposes them with each entry's `operationIndex` offset the way `appliedStatements` positions are (see `operationsBefore`).
6. **Per-statement origin check**: in `resolve-statements.ts`, the `origin.kind === 'missing'` check moves inside the per-statement loop so it applies to `rename` only. Add the `delete` verb to `StatementVerb` and the parser (text is a coordinate or, when the refusal said so, a storage name; both pass through unresolved, since `delete` is matched against the plan in dispatch 3, not resolved against a contract). `describeMigrationStatement` writes `delete model "Legacy"`.

## Not in this dispatch

Any prompt, flag, or refusal text; the CLI's matching of `delete` answers to `dataLoss`; the engine pin. Those are dispatch 3.

## Tests

Family and target tests for every mapping case: model subject, field subject, renamed-earlier table, storage fallback with and without `fromContract`, SQLite rebuild indexing, Postgres policy drop and RLS disable with the replacement DROP excluded, Mongo collection. The `db update` safe-widening test. Aggregate plumbing and offset tests. Resolver tests for `delete` and for `rename` with a missing origin failing per statement.

## Halt conditions

Stop and report if the SQL operations do not carry enough (`target.details`) to find the table and column for some destructive operation; if mapping the live native type needs more than the written-text lookup described; or if excluding the policy-replacement DROP needs the planner to carry new state.

## Gate

The standard gate from `../plan.md`, plus `pnpm lint:framework-vocabulary` (the framework type must add no family word) and the two rename-statements journeys.
