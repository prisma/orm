# Slice: the output when a plan stops to ask

## The problem

A user removes a field and runs `prisma migration plan` where nobody can answer a prompt. Today:

```text
✘ [CLI.CONSENT_REQUIRED] "Shop.legacy" needs a statement, and the session is not interactive.
  why: Drop column "legacy" from "Store Front" would lose the values of field "Shop.legacy".
→ Run the command again with --rename Shop.legacy:Shop.rating
→ Run the command again with --delete Shop.legacy
```

Will, 2026-11-19: "This is terrible user-facing output." What is wrong: "statement" is our internal word for the `--rename` and `--delete` flags; "the session is not interactive" is about the tool; the news that data would be lost comes second, labelled "why"; the flags do not say what each one means.

## The outcome

```text
✘ [CLI.CONSENT_REQUIRED] Removing field "Shop.legacy" would delete its values.
  why: The plan would run: Drop column "legacy" from "Store Front".
→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating
→ If the values can go: --delete Shop.legacy
```

Every message a user sees when `migration plan` or `db update` stops to ask follows the same order: what the change would do, in the words of the user's contract; what the plan would run; each answer with what it means.

## Terms

- **Question**: one stop of a plan, about one subject (a model, field, enum value, value object field, namespace, or storage no model stores). Built by `dataLossQuestion` and `accessChangeQuestion` in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`.
- **Answer**: a flag that settles a question: `--rename`, `--delete`, `--convert`, `--allow`.
- **Refusal**: the `CLI.CONSENT_REQUIRED` error printed when nobody can answer.
- **Engine**: the dependency `@prisma/cli-engine`, whose source is in another repository. It draws the prompt, builds the refusal first (`statementUnavailable`), and prints errors (`✘ [CODE] summary`, `why:`, `→` lines, `docs:`).

## Scope

This repository only. No engine change. The CLI already catches the engine's refusal and rebuilds it (`ledByKeepDataWays` in `packages/1-framework/3-tooling/cli/src/orm/plan-question-prompt.ts`); this slice makes the CLI build the whole refusal from its own questions.

The framework rule holds: the change is family-blind text and CLI-internal types in `packages/1-framework/3-tooling/cli`. No change to contract types, the control or migration vocabulary, or an interface a family or target implements. Targets keep supplying operation labels and advice strings as today. If the work seems to need more, stop and report.

## Design

1. **A question carries its parts, not one sentence.** `PlanQuestion` gains the parts the texts below are built from: what the change would do (the headline), the operation labels, a meaning for each answer, and the extra notes. One function builds the prompt text from the parts and one builds the refusal, so no sentence is written twice.
2. **The CLI builds the refusal.** From the open questions and the engine error's `meta` (`unanswered`, `unmatched`, `confirm`), it builds summary, `why` and next actions. It no longer edits engine text by string replacement. `code`, `severity`, `docsUrl`, exit code, and the `meta` fields `subject`, `verbs`, `unanswered`, `unmatched`, `confirm` are unchanged: scripts and agents read them.
3. **Headline.** In contract terms. `Removing <kind> "<name>" would delete its <data|values>.` only where the CLI knows the destination contract lacks the subject; otherwise `This change would delete the <data|values> of <kind> "<name>".` It must be true in every case that reaches it: check each loss kind and subject kind against the code before choosing the words.
   - type change: `Changing the type of field "User.age" can change or lose its values.`
   - enum value: `Removing enum value "Status.ARCHIVED" would remove it from the data that holds it.`
   - storage no model stores: `This change would delete the data in "public.user.age", which no model of the origin contract stores.` With no origin contract: `…, named by its storage name because the origin contract is unknown.`
   - access change: `This change would widen who can read and write the data of "User".` (or `change`).
   - several questions open: `This change needs <N> answers: "Bug", "Task".` and each question's headline opens its paragraph in `why`.
4. **What the plan would run.** One operation: `The plan would run: <label>.` Several: `The plan would run:` and one `- <label>` line each.
5. **Answers.** One next action per answer, meaning first, flag last. With one question open:
   - rename, new name known: `If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating`
   - rename, new name unknown: `If the field was renamed, keep its values: --rename 'Shop.legacy:Shop.<new name>'`
   - delete: `If the values can go: --delete Shop.legacy` (a model: `If its data can go`)
   - delete on a type change: `To let the database cast the values, which can change or lose some: --delete User.age`
   - convert: `To write the conversion yourself: --convert User.age`
   - allow: `To allow it: --allow User`
   With several questions open, each line names its subject (`If the data of model "Bug" can go: --delete Bug`). The ways to keep the data that a target supplies (`keepDataWays`) stay first, as today.
6. **Flags that answered nothing**, from `meta.unmatched` and `meta.confirm`, as lines in `why`: `--delete nope names nothing this change asks about.` and `--confirm postgres does not answer this.`
7. **`--yes`.** The engine exposes no field for it; its summary says `which --yes cannot give`. When the engine's summary contains `--yes`, `why` gains `--yes does not answer this: it would delete data.` (for an access change: `…: it would change access.`). A journey asserts it against the real engine, so an engine wording change fails a test.
8. **The prompt.** The engine prints `<question text> (<verb form> or <verb>)`. The question text is the headline, what the plan would run, the notes, and one short sentence on what each verb means (for example `rename keeps the values under the new name; delete lets them go.`).
9. **The words "statement" and "question"** do not appear in any text this slice builds. Name the flag. Other errors (`MIGRATION.STATEMENT_*`) and the docs' use of "statement" as the name of these flags are out of scope.
10. **Existing notes** (namespace delete and rename, origin snapshot recovery, the new-required-field notes, `db update` enum advice) keep their facts and are reworded only to drop "statement", "question" and "answers this question", and to fit the order above.

## Out of scope, recorded in `deferred.md`

- Engine changes: a per-answer description in the prompt; a `meta` field saying why nobody could answer (`--yes` or not interactive); the wording of `CLI.PROMPT_INVALID`, `CLI.PROMPT_CANCELLED` and the engine's own `CLI.CONSENT_UNUSED`.
- "Statement" in `MIGRATION.STATEMENT_*` texts, `resolve-statements.ts`, the SQL family and MongoDB advice strings, and the docs.

## Done when

1. Every refusal and prompt text for: a removed model (one and several operations), field, enum value, value object field, namespace, storage no model stores (origin known and unknown), a type change on `migration plan` and on `db update`, an access change, several open questions, a stray flag, `--confirm`, and `--yes`, on PostgreSQL, SQLite and MongoDB where each applies, is asserted in full by a unit test or journey.
2. No user-visible string built by `plan-questions.ts`, `plan-question-prompt.ts` or the refusal contains "statement" or "question"; a test checks the built texts.
3. Every journey and unit test that asserted the old texts asserts the new ones in full.
4. `docs/reference/error-reference.md` (`CLI.CONSENT_REQUIRED`), the CLI README and `skills/prisma-8/references/{migrations,debug}.md` show the new output; an upgrade note under `upgrade-instructions/pending/` tells scripts that match the summary or next-action text what changed and that `meta.unanswered` is unchanged.
5. `pnpm build`, `pnpm typecheck`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage` pass; lint and `pnpm test --coverage` pass in each touched package; each touched journey passes run by name.
