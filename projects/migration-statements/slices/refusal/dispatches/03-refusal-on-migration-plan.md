# Dispatch 3 — The engine pin, the verbs, and the refusal on `migration plan`

**Slice:** [`../spec.md`](../spec.md) § "The structured refusal", § "`--delete` and how statements consent" · **Plan:** [`../plan.md`](../plan.md) dispatch 3 · **Builds on:** dispatch 2 and the engine change prisma/prisma-cli#337

## Outcome

`migration plan` refuses every plan that would lose data until the user has said what each operation means, with the engine's statement prompt doing the asking: flags on the command line, one refusal that lists every unanswered operation when nobody can answer, and a typed answer when a human runs it. The blanket consent is gone from the command.

## The engine

- `@prisma/cli-engine` 0.7.0 (prisma/prisma-cli#337; ADR 0006 there; engine README § statements). Until it is published, pin the PR's preview build in `packages/1-framework/3-tooling/cli/package.json` (`https://pkg.pr.new/@prisma/cli-engine@337`, both the dependency and the peer) and say so in the commit; the pin is switched to `0.7.0` in its own commit when it is on the registry. The PR must not merge on the preview pin.
- A command declares `statements: { rename: { arity: 1, brief }, delete: { arity: 1, brief } }`. The engine parses those flags for that command, keeps the values in argv order on the run state, and never shows them to the handler. Remove the `--rename` flag declaration slice 1 added to `migration plan` (keeping it is a construction error).
- `ctx.prompt.statements(questions, { last: true })` returns `{ verb, text, values }` per question, answered from the flags first; non-interactively it throws one `CLI.CONSENT_REQUIRED` that lists every unanswered question with its flag forms; interactively it asks each in turn and re-asks on a rejected answer. `last: true` throws `CLI.CONSENT_UNUSED` for any leftover value before the command acts.
- The run's ordered statement values are the source of the statement list that slice 1 built from `args.flags.rename`; read them through the engine's API for that (see the engine README; the implementer finds the exact accessor).

## What to build

1. **Declare and read.** `migration plan` declares `rename` and `delete` with briefs. The statement list `{ verb, text }[]` is built from the engine's ordered values; `rename` entries resolve as in slice 1; `delete` entries are kept for matching.
2. **Plan, then ask.** Plan with the `rename` statements. For each `dataLoss` entry of the delta leg (and of the baseline leg in an auto-baseline), build one question: text from the operation's label plus what is lost (`Table "Legacy" would be dropped and its rows lost.`); `subject` written as the coordinate (`Legacy`, `User.name`, or the storage name, the `kind: 'storage'` case saying so in the question); `verbs: ['rename', 'delete']` for a model or field subject, `['delete']` for storage; `forms: { rename: '<subject>:<new name>' }`; `validate`: a `delete` answer must equal the subject; a `rename` answer must parse, resolve against the two contracts with the slice 1 resolver, and have its old side equal to the subject. Ask all questions in one `statements(..., { last: true })` call. Since the engine answers from flags before prompting, a `--delete Legacy` given up front is consumed here.
3. **Re-plan with new renames.** A `rename` answer that came from the prompt is a statement the plan did not have: append it, plan again, and expect no `dataLoss` entry for that subject; if one remains, fail with the new `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS` (error reference entry). A `rename` answered from a flag was already in the statement list, so it was in the first plan; only a prompt answer triggers a re-plan.
4. **Write only when answered.** Nothing is written until every question is answered. The auto-baseline consent (`refuseUnconsentedDestructiveBaseline`, `consentToken`, `destructiveBaselineQuestion`, the `consent`/`planHash` round trip through `MigrationPlanOptions`) is removed; `MIGRATION.DESTRUCTIVE_CHANGES` and `MIGRATION.CONSENT_PLAN_MISMATCH` stop being raised by this command (keep the codes if `db update` still raises them until dispatch 4; retire them there).
5. **Output.** `Statements applied` lists `delete` lines (`delete model "Legacy" (1 operation)`) with the operation positions of the entry each consented to; JSON `appliedStatements` entries carry `verb`. `dataLoss` is not separately printed on success. The `⚠` marker on destructive operations stays.
6. **Docs.** The CLI README `migration plan` section: statements, the refusal, the interactive answer, `--confirm` no longer used; the error reference for `CLI.CONSENT_REQUIRED`/`CONSENT_UNUSED` as this command raises them (link the engine's entries) and the new code; the Migration System doc § Statements and § `migration plan`.

## Not in this dispatch

`db update` (dispatch 4); `allow`; journeys and upgrade fragments (dispatch 5); retiring the two old error codes from the errors package while `db update` still uses them.

## Tests

CLI tests through `createOrmTestCli` with the engine's scripted `answers` and `isTty` runtime options: refusal lists every operation with both flag forms; `--delete Legacy` writes the plan and reports the statement; `--rename Legacy:Archive` on the flag resolves the loss in the first plan; a typed `rename Legacy:Archive` re-plans and succeeds; a typed `delete`; a rejected typed answer is re-asked (clack) or fails (line reader, the test runtime); `--delete Nope` fails with `CLI.CONSENT_UNUSED` before any package is written; `--yes` does not answer; a storage subject offers only `delete`; an auto-baseline with a destructive delta asks before writing either package; the old `--confirm <dir>` no longer consents (the engine still parses it; nothing asks). Update `migration-plan.test.ts` and `migration-plan-statements.test.ts` where they used the old consent.

## Halt conditions

Stop and report if the engine gives no way to read the ordered statement values from a handler; if `createOrmTestCli` cannot drive the engine's interactive path; or if the preview package cannot be installed with `pnpm install` in this workspace.

## Gate

Standard, plus `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, both rename-statements journeys, `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts`, `cli-journeys/data-transform-strategies.e2e.test.ts` and `migration-plan-details.e2e.test.ts` (they plan drops without an auto-baseline and will now need statements or will assert the refusal).
