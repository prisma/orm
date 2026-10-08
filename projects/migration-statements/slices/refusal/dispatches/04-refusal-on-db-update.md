# Dispatch 4 — The refusal and `allow` on `db update`

**Slice:** [`../spec.md`](../spec.md) § "`--delete` and how statements consent", § "Access widening (`allow`)" · **Plan:** [`../plan.md`](../plan.md) dispatch 4 · **Builds on:** dispatch 3

## Step 0 — already done in dispatch 3

The slice 1 branch is merged (`0bf6536f64`). Skip to the outcome.

## Carried from dispatch 3's review (D3-8)

A delete is reported through the origin model (`delete field "Profile.nickname"`) although the question wrote it as `User.nickname`. Describe it the way the question writes it, in both commands' `Statements applied` and JSON, with a test.

## Old step 0 (kept for the record)

`bot/tml-3475-statement-renames` moved after this branch was cut (the merge-queue test fix, a merge of `main`, and two follow-ups). Merge it into `tml-3476-statement-refusal` with `git merge --no-ff`; do not rebase. Resolve conflicts keeping both sides; the base's rewritten test "writes nothing when the delta planner refuses after the baseline was planned" is the one dispatch 3 already satisfies. Run the gate on the merge before starting the rest.

## Outcome

`db update` asks the same per-operation questions as `migration plan`, with one engine mechanism; in apply mode it also asks, with the verb `allow`, before it widens who can read or write rows; the blanket consent and its errors are gone from the CLI.

## What to build

1. **Declare and read.** `db update` declares `statements: { rename, delete, allow }` with briefs, drops the slice 1 `--rename` flag declaration, builds the rename list from `ctx.statements.take('rename')`, and passes the `delete` and `allow` answers through the same `answerDataLoss`-style callback as `migration plan` (share the question builder in `control-api/statements/data-loss-questions.ts`; add an `accessWidening` question builder next to it).
2. **Plan, then ask, then apply.** `executeDbUpdate` plans once (the current pre-plan), asks for every `dataLoss` entry across all spaces (an extension space's entry has a storage subject and offers `delete` only) and, in apply mode, every `accessWidening` entry (verb `allow` only; subject the model; question text from the label: `Disable row-level security on "User" would widen who can read and write its rows.`), all in one `statements(..., { last: true })` call, then applies. A typed `rename` re-plans as on `migration plan`. A dry run (`--dry-run`) plans, lists `dataLoss` and `accessWidening` in its output, and asks nothing; a `--delete` or `--allow` given to a dry run is unused and fails with `CLI.CONSENT_UNUSED`, which is the engine's rule, so say so in the README.
3. **Remove the blanket consent.** `guardDestructiveChanges`, the consent prompt and helpers in `orm/db/consent.ts`, `acceptDataLoss`'s CLI path, `DESTRUCTIVE_CHANGES` and `CONSENT_PLAN_MISMATCH` from `DbUpdateFailureCode`, `computePlanHash`'s consent use, and `MIGRATION.DESTRUCTIVE_CHANGES` / `MIGRATION.CONSENT_PLAN_MISMATCH` from the errors package and the error reference (nothing raises them any more after dispatch 3). `DB_INIT_ADDITIVE_ONLY_FIX` in `db-init-failure.ts` stops telling users to pass `--confirm`. The control API keeps `acceptDataLoss` for programmatic callers and gains `statements`.
4. **Retry command.** `retryCommandFor` carries every verb's values (`rename`, `delete`, `allow`) in order.
5. **No origin snapshot.** With statements but no snapshot, `rename` fails as in slice 1; subjects are storage names, `delete` consents to them, and the refusal says the names are storage names because the origin contract is unknown.
6. **Output.** `Statements applied` and JSON `appliedStatements` carry `delete` and `allow` lines with their positions, offset per space as the positions already are. JSON `dataLoss` and `accessWidening` appear on the dry-run document.
7. **Docs.** CLI README `db update`: statements, the questions, `allow`, the dry run, `--confirm` no longer consents; the Migration System doc § `db update` (including that recorded extension migrations contribute no `accessWidening` question, because a written migration is reviewed before it runs); the error reference; the CLI Style Guide's consent section: statements are the data-loss form, `consent`/`--confirm` stays for one-thing-at-stake commands.

## Not in this dispatch

Journeys, upgrade fragments, the skill references (dispatch 5).

## Tests

CLI tests through the mocked client and the control-API tests with a mock family: refusal lists every operation across spaces; `--delete` applies; `--allow User` applies a policy drop and its absence refuses in apply mode and is not asked in dry run; a typed answer; `--confirm <database>` no longer consents (nothing asks for it); `CLI.CONSENT_UNUSED` for a stray value; retry command carries all verbs; no-snapshot storage subjects. Update `db-update-consent.test.ts`, `db-update.test.ts`, `db-update-to-resolution.test.ts` and `control-api/db-update.test.ts`.

## Halt conditions

Stop and report if sharing the question builder between the two commands needs the control API to know about the engine's prompt types (it must not: the callback boundary stays at the command); if the dry run's `CONSENT_UNUSED` behaviour under the engine cannot be made to say something useful; or if retiring the two error codes breaks a published surface a fragment must name.

## Gate

Standard, plus `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, both rename-statements journeys, `cli-journeys/db-update-workflows.e2e.test.ts`, `drift-schema.e2e.test.ts`, `mongo-db-update-consent.e2e.test.ts`, `rename-table-migration.sqlite.e2e.test.ts`, `cli.db-update.e2e.test.ts` and `cli.db-update.preflight-gaps.e2e.test.ts` (they pass `--confirm` today and must change to statements).
