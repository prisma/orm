# Slice plan — Both commands refuse data loss until the user states what each operation means

**Spec:** [`spec.md`](./spec.md) · **Linear:** [TML-3476](https://linear.app/prisma-company/issue/TML-3476) · **Branch:** `tml-3476-statement-refusal` · **Depends on:** `@prisma/cli-engine` 0.7 from [`../engine-statement-prompt/`](../engine-statement-prompt/spec.md)

Every dispatch runs on Opus. Validation gate unless stated: `pnpm typecheck`, `pnpm --filter <touched packages> lint`, `pnpm --filter <touched packages> test`, `pnpm lint:deps` when imports change, `pnpm fixtures:check` when classes or rendering change, `pnpm check:error-reference` when error codes change, `pnpm lint:framework-vocabulary` when `packages/1-framework` changes. Never the full integration or package suites locally; run named files, and both rename-statements journeys plus the new ones.

Dispatches 1 and 2 do not touch the prompt and start before the engine ships. Dispatches 3 to 5 need the engine pin.

## Dispatches

### 1 — Destructive means data loss, on every target

**Outcome.** `SET NOT NULL`, the known safe type widenings, SQLite rebuilds caused only by a nullability tightening, MongoDB index drops, validator tightenings and change-stream image settings are `widening`; drop table, drop column, drop collection, and type changes that can lose values stay `destructive`. The `MigrationOperationClass` doc and the Migration System doc § Operation Model say what each class means. Example migrations and planner goldens are regenerated where a class changed; `examples/prisma7-adoption/test/handover.test.ts` expectations follow.

**Builds on.** Slice 1.

**Hands to.** A `destructive` set the refusal can refuse without blocking a required column.

### 2 — The planner result names what each destructive operation would lose

**Outcome.** The framework type `MigrationSubject` beside `AppliedMigrationStatement`; the planner success result carries `dataLoss: { operationIndex, subject }[]` and `accessWidening: { operationIndex, subject }[]`; the SQL family maps a dropped or type-changed table or column back to the origin contract's model or field when `fromContract` is present, else to a storage subject; MongoDB maps a dropped collection to its model; the transient DROP of a policy replacement is not listed. The aggregate planner and `planFromDiff` pass both lists through. The missing-origin check in `resolve-statements.ts` moves inside the per-statement loop.

**Builds on.** Dispatch 1.

**Hands to.** The structured refusal, ready for the CLI to render and for the prompt to consume.

### 3 — The engine pin, the verbs, and the refusal on `migration plan`

**Outcome.** `@prisma/cli-engine` 0.7 pinned; each command declares its verbs from one shared table (`rename`, `delete`, and on `db update` `allow`); `migration plan` plans, turns every `dataLoss` entry into a `ctx.prompt.statements` question, re-plans with any `rename` answers, matches `delete` answers, and writes only when nothing is left unanswered. The auto-baseline consent (`refuseUnconsentedDestructiveBaseline`, `consentToken`, the plan-hash round trip) is gone; `MIGRATION.DESTRUCTIVE_CHANGES` and `CONSENT_PLAN_MISMATCH` are retired from this command; `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS` is new. `Statements applied` and JSON `appliedStatements` carry `delete` lines with `verb`. Statement order comes from the engine's ordered verb-flag list.

**Builds on.** Dispatch 2 and the engine.

**Hands to.** The refusal shape on one command; the `delete` path end to end offline.

### 4 — The refusal and `allow` on `db update`

**Outcome.** `db update` asks the same questions per destructive operation and, in apply mode, an `allow` question per access-widening operation; `guardDestructiveChanges`, the consent prompt in `orm/db/consent.ts`, `acceptDataLoss`'s CLI path, `MIGRATION.DESTRUCTIVE_CHANGES` and `CONSENT_PLAN_MISMATCH` are gone from the CLI (the control API keeps `acceptDataLoss` and gains `statements`); a dry run lists `dataLoss` and asks nothing; `retryCommandFor` carries every verb. Without an origin snapshot, `delete` works on storage subjects and the refusal says why the names are storage names.

**Builds on.** Dispatch 3.

**Hands to.** Both commands on the one consent model.

### 5 — Journeys, docs, upgrade fragments

**Outcome.** The slice done conditions hold through journeys on Postgres, SQLite and MongoDB (rename plus delete through both commands; the refusal's `nextActions` flag then succeeds; `--confirm <database>` no longer consents; a required field plans without refusal; `--allow` on a policy drop). The CLI README's two command sections, the Migration System doc § Statements and § `db update`, the error reference, the CLI Style Guide's consent section, and `skills/prisma-8` describe statements as the data-loss consent. The app upgrade fragment records that `--confirm` no longer consents to data loss and that `migration plan` refuses every plan that loses data; the extension fragment records `dataLoss`, `accessWidening` and `MigrationSubject`. Every `--confirm` in tests and journeys for these two commands is replaced.

**Builds on.** Dispatch 4.

**Hands to.** Slice DoD.

## Open items

- The PR must not merge while `pkg.pr.new` appears in any `package.json` or the root `pnpm.overrides`: the engine pin switches to the published `@prisma/cli-engine` 0.7.0 first.
- Dispatch 5's app upgrade fragment names the control-API break: `executeMigrationPlanCommand` requires `answerDataLoss`; `consent` and `carryEmittedExtensionDirs` are gone.

- Dispatch 5 adds a planner test where a codec hook emits a destructive call, proving the hook-call-to-field match (by object identity) survives the control-policy partitions.

- Whether the Mongo planner's `statementRefused` for `rename` needs its wording changed now that `delete` exists: dispatch 3 reads the text and decides.
