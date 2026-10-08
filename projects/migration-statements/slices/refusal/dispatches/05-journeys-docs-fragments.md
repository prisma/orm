# Dispatch 5 — Journeys, docs, upgrade fragments

**Slice:** [`../spec.md`](../spec.md) § "Slice done conditions" · **Plan:** [`../plan.md`](../plan.md) dispatch 5 · **Builds on:** dispatch 4

## Outcome

The slice done conditions hold through journeys on all three targets; every document and skill that describes consent describes statements; the upgrade fragments name every behaviour change and every removed export, and are validated by execution.

## Journeys (`test/integration/test/cli-journeys/`)

Next to the `rename-statements-migration*` journeys, one Postgres file, one SQLite file and one MongoDB file, labelled `S` steps as the existing ones are:

1. **Rename plus delete through `migration plan`:** rename a model and a field and remove another model; without `--delete`, `migration plan --json` exits 2 with `CLI.CONSENT_REQUIRED` whose `nextActions` contain `--delete <Model>`; with that exact flag it writes the plan; `migrate` applies it on tables with rows, a unique, a foreign key from another table, a secondary index and (Postgres) a check; rows and objects present under the new names, the deleted table gone, a further plan empty, `db verify --schema-only` clean.
2. **The same through `db update`:** no prompt; `--confirm <database>` alone is refused with `CLI.CONSENT_REQUIRED`; a second `db update` with the same statements fails on the first statement (`MIGRATION.STATEMENT_UNRESOLVED`).
3. **A required field:** adding a non-nullable field plans and applies on all three targets with no refusal.
4. **Postgres only, `allow`:** `db update` that drops a policy refuses in apply mode without `--allow <Model>` (`nextActions` names it), applies with it, and a dry run lists it under `accessWidening` without asking.
5. **MongoDB:** a collection drop is refused and `--delete <Model>` consents; a `rename` is still refused by the Mongo planner with `statementRefused`.
6. **No snapshot (Postgres and SQLite, one each):** `db update --db <url>` with a dropped model refuses with a storage subject and the note that the origin is unknown; `--delete <storage name>` applies; the SQLite form is the unqualified name, the Postgres form is `public.user`.

Add the planner test the review asked for: a codec hook that emits a destructive call, proving the hook-call-to-field match survives the control-policy partitions (`../plan.md` open items).

## Carried from dispatch 4's review (D4-6)

A programmatic dry run (`mode: 'plan'`) ignores a `delete` or `allow` statement that matches no subject, where apply mode fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. Check them in plan mode too, without asking, so both modes refuse; test it. The new code goes in the app upgrade fragment's control-API list.

## Docs and skills

- `skills/prisma-8/references/migrations.md`, `debug.md` and `SKILL.md`: replace `MIGRATION.DESTRUCTIVE_CHANGES` and `--confirm <database>` with the statements and the refusal; the error-code table lists `CLI.CONSENT_REQUIRED`, `CLI.CONSENT_UNUSED` and `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS`; `skills/journey-tests/*` that mention `--confirm` for these commands.
- `docs/commands/SUMMARY.md` and `docs/reference/error-reference.md`: already touched in dispatches 3 and 4; re-read for stale consent wording.
- `docs/architecture docs/subsystems/7. Migration System.md` § Statements: one coherent section for `rename`, `delete`, `allow`, the questions and the interactive answer; § `db update`: recorded extension migrations contribute no `accessWidening` question.
- The slice spec and the project spec: nothing to change unless the implementation diverged; report any divergence instead of editing them.

## Upgrade fragments (`upgrade-instructions/pending/migration-statement-refusal/`)

**app/instructions.md** (extend the fragment dispatch 1 created):
- `migration plan` refuses every plan that loses data, not only auto-baselines; the way out is `--delete <coordinate>` or `--rename`; detection: scripts and CI that run `migration plan` on a contract change that drops something (no reliable regex; say so and give the `nextActions` form).
- `db update --confirm <database>` no longer consents; detection regex on `--confirm` next to `db update`; replacement `--delete <Model|Model.field>` per operation, `--allow <Model>` before an access widening.
- `db update` reads the origin snapshot on every run (behaviour note, no action).
- Control API: `executeMigrationPlanCommand` and `executeDbUpdate` require `answerQuestions`; `consent`, `carryEmittedExtensionDirs` and `acceptDataLoss`'s CLI path are gone; `retryCommandFor` takes `statements`. Detection on each identifier.
- Removed from `@prisma/orm-framework/errors/execution`: `ERROR_CODE_DESTRUCTIVE_CHANGES`, `errorDestructiveChanges`, `ERROR_CODE_CONSENT_PLAN_MISMATCH`, `errorConsentPlanMismatch`. Removed from `@prisma/orm-toolchain/cli/control-api`: `'DESTRUCTIVE_CHANGES'` and `'CONSENT_PLAN_MISMATCH'` in `DbUpdateFailureCode`, `DbUpdateFailure.destructiveChanges` / `.consentPlanMismatch`, `DestructivePlanOperation`, `DestructiveChangesVerdict`, `ConsentPlanMismatchVerdict`. Removed CLI codes `CLI.CONSENT_TOKEN_UNRESOLVED`, `CLI.CONSENT_OPERATIONS_MISSING`.

**extension/instructions.md** (new):
- `MigrationPlannerSuccessResult` requires `dataLoss` and `accessWidening` (`MigrationOperationSubject[]`); `MigrationStatementSubject`; `PerSpacePlan` carries both; `ControlFamilyInstance.storageNameOf` is required; `StatementVerb` gains `delete`; `DeleteMigrationStatement`; `RecreateTableCall` (SQLite) takes `lossyColumns`; `AlterColumnTypeCall` (Postgres) takes `operationClass`; `planFieldEventCalls`; the class changes from dispatch 1 as they affect a planner an extension implements. Detection regexes per identifier, with the import paths.

Validate both by execution per `skills-contrib/record-upgrade-instructions/SKILL.md` § validation (restore `examples/` and `packages/3-extensions/` to the base, apply the fragment, no diff outside tests; test dirs stay at base; run the example tests). The engine pin must not be in the fragments: it is a dependency bump the PR body states.

## Gate

Standard, plus `pnpm check:upgrade-coverage --mode pr --prev bot/tml-3475-statement-renames` (must pass now), `pnpm lint:skills`, `pnpm lint:docs`, every journey named above and every journey dispatch 4 changed, and the example tests the fragment validation runs.
