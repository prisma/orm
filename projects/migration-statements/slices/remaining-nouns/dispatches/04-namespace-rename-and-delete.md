# Dispatch 4 — a namespace is renamed or deleted by statement

**Slice:** [`../spec.md`](../spec.md) § "Statement grammar" and § "What each statement does", Namespaces; decision 3 · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3537-namespaces` · **Builds on:** dispatch 2 (`renameSchema`, `dropSchema`), dispatch 3 (the working-schema step for a namespace change)

## Outcome

On Postgres, `--rename billing:finance` renames the schema, and a namespace the origin contract declares and the destination does not becomes data-loss questions, one per model in it, which `--delete billing` answers in one go before the schema is dropped. A schema another contract space declares is refused.

## What exists

- The resolver reads one name as a model only (`resolve-statements.ts`, around line 240). A namespace is never a subject.
- `ResolvedMigrationStatement` has model rename, field rename, convert and backfill (`framework-components/src/control/migration-statements.ts`). `MigrationSubject` has `model`, `field`, `storage`; every switch over it is exhaustive.
- The Postgres diff drops every `not-expected` issue under a schema not in `ownedSchemaNames(expected)` (`diff-database-schema.ts:48-53` and `:238-255`). The owned set comes from the destination contract only, so a removed namespace's tables are kept silently (spec decision 3).
- `--delete` answers a question only when its text equals the subject's text (`plan-questions.ts`, `givenFor`). The CLI engine's own matching accepts a value equal to the subject or starting with `<subject>:`. So `--delete billing` must be expanded by the CLI into one answer per model in the namespace before the questions are asked (`deferred.md`, "`--delete <namespace>` consenting for every model in the namespace").
- The Postgres planner gets `fromContract` only from `migration plan`; `db update` reads the origin from the snapshot store (Migration System § "The origin of `db update`").
- `createSchema` is planned from a `not-found` namespace issue; any other namespace issue is refused as "Unexpected namespace drift" (`issue-planner.ts` around line 910).

## Do

1. **Grammar and resolution.** One name reads as a namespace or as a model. Exactly one reading resolving wins; both resolving is refused with a message that names each reading and asks for the qualified form (`--rename billing.billing:...` is not possible for a namespace, so the message says how to say the model: `<ns>.<Model>`). A namespace rename resolves when the old name is a namespace of the origin and not of the destination, and the new name one of the destination and not of the origin. Add a namespace rename kind to `ResolvedMigrationStatement`, with `describeMigrationStatement` text `rename namespace "billing" to "finance"` and JSON output.
2. **Namespace rename in the SQL family and Postgres.** A working-schema step that renames the schema and re-keys its tables, so later statements and the diff see the new name; the `renameSchema` call; the control policy check as for a table rename. Refuse a rename of a schema that another contract space of the same project declares (an extension space): find how the planner knows the other spaces' namespaces (the aggregate planner's `PlannerInput`, the Supabase extension's `auth` schema is the real case) and refuse with a message that names the space. Refuse a rename of the target's default namespace (`public`): first check on PGlite whether an ordinary owner can run `ALTER SCHEMA public RENAME` at all; whether it works or not, the refusal stands, because `public` is target-owned (ADR 223) and Postgres puts it on every search path. The message says to move the models with `--rename Model:new.Model` instead. Correct the spec's edge-case row "Renaming `public`" to say this.
3. **A removed namespace becomes questions.** When the planner has an origin contract, the owned schema set is the destination's namespaces plus the origin contract's. Then the tables under a namespace the destination dropped reach the diff as drops, each a `model` subject named through the origin contract, as today for a dropped table. Without an origin contract (`db update` with no snapshot), nothing changes. A schema the origin never declared is still ignored; add a test that Supabase's `auth` schema, declared by no contract of the project, is still left alone.
4. **`dropSchema` after the tables.** Once every table of a removed namespace is dropped, the planner drops the schema. Dispatch 2's ordering bucket already puts the schema drop after the table drops. An enum type or other object the contract declared in that schema is dropped first by the existing planner; an object the contract never declared blocks the drop at its precheck, and that failure is what the user sees.
5. **`--delete <namespace>`.** In `askPlanQuestions`, a `delete` whose text is a namespace of the origin contract expands into a `delete` for every data-loss subject whose model is in that namespace, before the pre-answers are matched. The expanded answers are reported as `delete model "billing.Invoice"` each, under `Statements applied`. A `--delete billing` that matches no namespace and no subject fails with `CLI.CONSENT_UNUSED` as any unused delete does. A `--rename billing.Invoice:Invoice` given in the same run keeps that model: the rename is planned first, so its table is not among the drops.
6. **Tests first**, red before each change: parser and resolver readings and refusals; the family working-schema step; the Postgres planner for a rename, a removal with two tables, a removal next to an undeclared schema, the `public` refusal and the shared-space refusal; `plan-questions` expansion; `migration.ts` round trip for a plan with `renameSchema` and with `dropSchema`; both commands on PGlite: rename a namespace with rows in its tables and verify the rows are there under the new name, and delete a namespace with `--delete` and verify the schema is gone.
7. **Docs:** error reference for every new refusal; Migration System § Statements: grammar (a side can be a namespace), application (schema rename, removed namespace, `--delete <namespace>`), and the "Rename limits" list; CLI README where `--rename` and `--delete` are described.

## Do not

- Do not add enum value, value object or variant readings; those are later PRs.
- Do not change SQLite behaviour; it has no namespaces and refuses namespace blocks at authoring.
- Do not write the journeys and the final docs pass; that is dispatch 5. Unit and planner tests, and one PGlite test per command, are this dispatch's.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; no backwards-compatibility exports; framework packages name no family or target (`pnpm lint:framework-vocabulary`).
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and tests with coverage in framework-components, the CLI, the migration package, the SQL family, the Postgres target and the Postgres adapter; `lint:deps`; `lint:framework-vocabulary`; `fixtures:check`; `check:error-reference`; `lint:throws`; `lint:casts`.
- Inside `test/integration`, by name: every file that mentions `--rename` or `--delete` or `CONSENT_REQUIRED`, and every file under `test/ports/prisma/functional/multi-schema/`.

## Report

Plain English, short sentences: the grammar rule and its refusal texts; what the planner does for a namespace rename and for a removed namespace; the `public` finding on PGlite; the shared-space refusal and how the planner learns the other spaces; the `--delete` expansion; the test that was red first for each change; the gates with results; anything the brief did not cover; the commits.
