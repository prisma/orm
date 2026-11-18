# Slice 4 — plan

Spec: [`spec.md`](spec.md). One persistent Opus implementer runs the dispatches in order. The orchestrator writes the decision record note, the glossary, the skill, the README and Migration System doc changes, and the pull request text.

## Dispatch 1: the error, the recorded access changes, and `db migrate`

**Outcome:** `MIGRATION.DATA_PROTECTION_FORBIDS` exists with the spec's content. `ControlFamilyInstance.accessChangesOf` exists and is implemented for the SQL family (delegating to Postgres, SQLite and MySQL) and MongoDB. `resolveRecordedPath` fills `accessChanges` from it. `migrate` and `migrate-show` refuse a run the effective data protection settings forbid, before `runMigration`.

**Files:** `cli/src/utils/policy-errors.ts`; `cli/src/control-api/operations/database-policies.ts`, `migrate.ts`, `migrate-show.ts`; `migration/src/aggregate/strategies/resolve-recorded-path.ts` and `planner-types.ts`; `framework-components/src/control/control-instances.ts`; `2-sql-family/9-family/src/core/control-instance.ts`; the Postgres, SQLite and MySQL target packages; `2-mongo-family/9-family/src/core/control-instance.ts`; `docs/reference/error-reference.md`; `upgrade-instructions/pending/`.

**Tests first:** the whole error envelope for a data loss, an access change, and both; `accessChangesOf` on Postgres against operations built by the real factories and round-tripped through JSON (disable, drop, drop then create again, rename, create, unrelated); `resolveRecordedPath` lists them; control API `migrate` tests for forbidden, with-consent, `permitPolicyChange` loosening and tightening, an extension space, and a policy-only run.

**Hands to:** dispatch 2 the error factory and the helper that picks the effective settings.

## Dispatch 2: `db update` and `migration plan --to <ref>`

**Outcome:** `db-run` applies the three levels of both settings as the spec's table says, in real and dry runs. `resolveToForPlan` returns a ref's declared policies and `migration-plan` refuses a plan they forbid before writing anything.

**Files:** `cli/src/control-api/operations/db-run.ts`, `db-update.ts`, `migration-plan.ts`, `plan-resolution.ts`; `cli/src/control-api/statements/plan-questions.ts` only if the placement needs it; `cli/src/orm/db/update.ts`, `cli/src/orm/migration/plan.ts` for wiring.

**Tests first:** control API tests for each cell of the spec's table, `--rename` under `forbidden`, `acceptDataLoss` under `forbidden`, no prompt under `permitted`, dry run under `forbidden`; `migration plan` with a ref that forbids, a ref that declares nothing, and no ref.

## Dispatch 3: integration tests

**Outcome:** the spec's done conditions hold through the CLI on Postgres, SQLite and MongoDB, in `test/integration/test/` beside the existing `cli.database-policies.*.e2e.test.ts` files, reusing their utilities.

## Orchestrator-owned

Documents; `/drive-code-review` without the walkthrough on the finished branch; fixes; manual QA through the real CLI on the pushed tip; the pull request.
