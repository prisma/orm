# Slice 3 — plan

Spec: [`spec.md`](spec.md). One persistent Opus implementer runs the dispatches in order; the orchestrator writes ADR 308, the glossary, the skill and the PR text.

## Dispatch 1: the types, the refs and the marker

**Outcome:** `DatabasePolicies` and friends exist in `packages/1-framework/1-core/framework-components/src/control/`; every ref writer goes through `advanceRef`, which keeps `invariants` and `policies`; the runner on Postgres, SQLite, MySQL and MongoDB accepts `databasePolicies` and writes `meta.policies` with the marker, inside the transaction where there is one and after the last migration on MongoDB; a run with zero edges still writes the marker when given policies; no marker write on any target loses `meta` keys it does not own.

**Files:** `framework-components/src/control/control-migration-types.ts` (beside `MigrationOperationPolicy`) and its exports; `migration/src/refs.ts` (`RefEntry.policies`, arktype schema, `advanceRef`); callers `cli/src/control-api/operations/ref.ts:133`, `ref-advancement.ts:95`, `cli/src/orm/db/sign.ts:330`; runner option types in `framework-components` control types and the four runners (`packages/3-targets/postgres`, `sqlite`, `mysql`, `mongodb` control adapters' `initMarker`/`updateMarker`, MySQL `marker-ledger.ts` `upsertMarkerRow`); `cli/src/control-api/operations/run-migration.ts:264` where runner options are built.

**Builds on:** nothing. **Hands to:** dispatch 2 the types, `policiesOf`, `policyDifferences`, `advanceRef` and the runner option.

**Tests first:** unit tests for `policiesOf` (defaults, partial `meta.policies`, invalid → `CONTRACT.MARKER_READ_FAILED`), `policyDifferences` (declared keys only), `advanceRef` (new ref; existing ref keeps both fields; each of the three callers); per-target runner tests that `meta.policies` is written with the marker, survives a run without policies, survives MySQL's upsert, and is unchanged after a failed run (Postgres rollback; Mongo second-migration failure).

## Dispatch 2: the operations, the CLI and the errors

**Outcome:** `migrate`, `dbUpdate` and `db sign` run the checks in the spec's order; `MigrateOptions.ref` and `permitPolicyChange` replace the three ref fields; `db migrate` and `db update` take `--permit-policy-change`; `MIGRATION.POLICY_MISMATCH` and `MIGRATION.CHANGE_POLICY_FORBIDS` exist with the spec's text; `MIGRATION.MARKER_MISMATCH` gives the one recovery; `migration status --to <ref>` reports differences; a policy-only run writes the marker and says so; `docs/reference/error-reference.md` and the upgrade fragment are written.

**Files:** `cli/src/control-api/types.ts` (`MigrateOptions` :628, `DbUpdateOptions` :221), `control-api/operations/migrate.ts` (`executeMigrate` :134, early return :246, markers :166), `db-update.ts`/`db-run.ts` (markers :220, `runMigration` :499), `orm/migrate.ts` (`--to` :220/:395, markers :409), `orm/db/update.ts` (:329), `orm/db/sign.ts`, `orm/migration/status.ts` (:347/:396/:451), `utils/marker-mismatch.ts`, a new `utils/policy-errors.ts`, `exports/control-api.ts`, `docs/reference/error-reference.md`, `upgrade-instructions/pending/database-policies/app/instructions.md`.

**Builds on:** dispatch 1. **Hands to:** dispatch 3 the whole feature.

**Tests first:** unit tests asserting whole envelopes for both new errors and the two `MARKER_MISMATCH` cases; control API tests for each step of the order (mismatch without flag fails before DDL; with flag runs and writes; `migrate` refused under `change: [reconcile]`; `dbUpdate` plan mode refused under `[migrate]`; policy-only run); `db sign` refused with a marker and allowed without; `status` differences in human and `--json` output.

## Dispatch 3: integration tests on four targets

**Outcome:** the spec's done conditions hold end to end on Postgres, SQLite, MySQL and MongoDB through the CLI, in `test/integration/test/` beside `cli.migrate-drift-check.e2e.test.ts`.

**Builds on:** dispatches 1 and 2. **Hands to:** review.

## Orchestrator-owned

ADR 314; status notes on ADR 021 and ADR 218; glossary; `skills/prisma-8` (`SKILL.md`, `references/migrations.md`, `references/debug.md`); `pnpm check:error-reference`; `/drive-code-review`; pre-push checks per `drive/calibration/dod.md`; PR text.
