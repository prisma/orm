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
  why: The operation of the plan that does this: Drop column "legacy" from "Store Front".
→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating
→ If the values can go: --delete Shop.legacy
```

Every message a user sees when `migration plan` or `db update` stops to ask follows the same order: what the change would do, in the words of the user's contract; which operations of the plan do it; each answer with what it means. Every printed line works when a careful reader follows it.

## Terms

- **Question**: one stop of a plan, about one subject (a model, field, enum value, value object field, namespace, or storage no model stores). Built by `dataLossQuestion` and `accessChangeQuestion` in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`.
- **Answer**: a flag that settles a question: `--rename`, `--delete`, `--convert`, `--allow`.
- **Refusal**: the `CLI.CONSENT_REQUIRED` error printed when nobody can answer.
- **Engine**: the dependency `@prisma/cli-engine`, whose source is in another repository. It draws the prompt, builds the refusal first (`statementUnavailable`), and prints errors (`✘ [CODE] summary`, `why:`, `→` lines, `docs:`).

## Scope

This repository only. No engine change. The CLI already catches the engine's refusal and rebuilds it (`ledByKeepDataWays` in `packages/1-framework/3-tooling/cli/src/orm/plan-question-prompt.ts`); this slice makes the CLI build the whole refusal from its own questions.

The framework rule holds: the change is family-blind text and CLI-internal types in `packages/1-framework/3-tooling/cli`. No change to contract types, the control or migration vocabulary, or an interface a family or target implements. Targets keep supplying operation labels and advice strings as today. If the work seems to need more, stop and report.

## Design

1. **A question carries its parts, not one sentence.** `PlanQuestion` extends `QuestionParts` (`plan-question-text.ts`): the headline, how a list of several names the subject (`subjectInList`), the operation labels, the notes (facts only), the ways to keep the data other than the question's own flags (`keepDataWays`, and `keepDataWaysNamingSubject`, the same ways naming their subject for a refusal with several open), the answers (each a flag with `meaning`, `meaningNamingSubject` and `promptMeaning`), what else to give when the data goes (`alsoGiveWhenDeleted`), the effect on the data (`effect`: `deletes data`, `may change data`, `changes access`), and the removed namespace of its model, if any (`removedNamespaceParts`). `planQuestion` is the only constructor; it derives `verbs` and `forms` from the answers. `questionText` builds the prompt text where the question goes to the engine, and `refusalText` builds the refusal, so no sentence is written twice and no stored copy can drift. The types and `questionText` are exported beside `PlanQuestion`.
2. **The CLI builds the refusal.** From the open questions and the engine error's `meta` (`unanswered`, `unmatched`, `confirm`), it builds summary, `why` and next actions. It finds the open questions from `meta.unanswered` by subject and verbs together, and throws `InternalError` when the engine lists one the CLI did not ask. `code`, `severity`, `docsUrl`, exit code, and the `meta` fields `subject`, `verbs`, `unanswered`, `unmatched`, `confirm` are the engine's: scripts and agents read them. The engine's `CLI.PROMPT_INVALID` for a flag or typed answer a question's `validate` rejected is rebuilt the same way: `<flag> does not fit this change: <the CLI's reason>` for a flag, and `"<verb> <text>" does not fit this change: …` for a typed answer, so it never names a flag the user did not give, with the question's headline as `why`.
3. **Kind of loss, decided once.** `lossKind` returns `removed`, `deleted` or `retyped`, and throws `InternalError` for a type change of a subject kind the CLI has no words for (only fields and storage have them). "Removing" is said only when the contract still has the model, enum, value object or namespace the subject was in and not the subject; when only that place is missing, the subject may have moved with it, and the headline says `This change would delete …`.
   - removed: `Removing model "Bug" would delete its data.`, `Removing field "Shop.legacy" would delete its values.`, `Removing enum value "Status.ARCHIVED" would remove it from the data that holds it.`, `Removing value object field "GeoPoint.note" would delete its values.`
   - not known to be removed: `This change would delete the data of model "billing.Invoice".`, `This change would delete the values of field "Profile.nickname".`
   - a change the CLI can name: `Changing the discriminator value of model "Bug" from "bug" to "defect" would delete its data.`, `Changing the stored value of enum value "Status.ACTIVE" from "active" to "on" would remove "active" from the data that holds it.`
   - type change: `Changing the type of field "User.age" can change or lose its values.`
   - storage no model stores: `This change would delete the data in "public.user.age", which no model of the contract before this change stores.` With that contract unknown: `…, named by its storage name because the contract before this change is not known.`
   - access, one question per model for all its access changes: `Access to the data of "User" would widen.` when any change widens it, else `Access to the data of "User" would change.`
4. **Several open.** The summary says what would happen: `This change would lose data: model "Bug", model "Task".`, `This change would change or lose data: field "User.age", field "User.score".` when only type changes are open, `This change would change who can read and write data: "User".`, or `This change would lose data and change access: model "Bug", "User".` (`would change or lose data and change access` when no deletion is open). Each open question is a paragraph of `why`, opened by its headline; blank lines separate subjects only. A removed namespace is said once, after the headline of the first question about it and before its operation line: `The contract no longer has namespace "billing".` With one question open, `why` starts with the fact, followed directly by the operation line.
5. **The operations.** The line lists only the operations that cause this loss: `The operation of the plan that does this: <label>.`, or `The operations of the plan that do this:` with one `- <label>` line each.
6. **Next actions, in order.** First the lines that remove flags that did nothing; then the ways to keep the data that take more than one flag (the target's advice, the rename of a field's missing model, the steps that store the contract before this change); then the removed namespace's flags; then one line per answer, meaning first, flag last; then what else to give when the data goes (a `--backfill` for a new required field).
   - rename, one new name possible: `If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating`
   - rename, several possible: `If the field was renamed to "rating" or "score", put that name in place of <new name> to keep its values: --rename 'Shop.legacy:Shop.<new name>'`
   - rename, none possible: `If the field was renamed, add it to the contract under its new name and run `{bin} contract emit`; then keep its values: --rename 'Shop.legacy:Shop.<new name>'`. The new names are the contract's new fields, members or value object fields, a variant's new sibling variants, or a model's new models in its own namespace (all namespaces when there are none there).
   - delete: `If the values can go: --delete Shop.legacy` (a model: `If its data can go`; an enum value: `If it can go from the data`); when `migration plan`'s way to keep the data runs the same `--delete` and then edits migration.ts, it adds `, or to keep the data by editing migration.ts as above`.
   - delete on a type change: `To let the database cast the values, which can change or lose some: --delete User.age`
   - convert: `To write the conversion yourself: --convert User.age`
   - allow: `To allow it: --allow User`, or `To allow both changes: --allow User` for two access changes of one model.
   - a field whose model the contract names differently: `If model "Profile" was renamed to "Person", say so first: --rename Profile:Person`, with the same three forms as a rename; the next run asks about the field again.
   - a removed namespace: `If the data of everything in namespace "billing" can go: --delete billing`, and `If namespace "billing" was renamed to "finance", keep its data: --rename billing:finance` when the contract adds a namespace.
   With several questions open, each line names its subject (`If the data of model "Bug" can go: --delete Bug`), and so does each way to keep the data (`For field "Shop.legacy": to keep its data, move the column by hand.`; the snapshot steps open with `If "audit" or "audit_old" was renamed, keep its data: …`).
   - a rename to a name the contract does not have, as a flag: `MIGRATION.STATEMENT_UNRESOLVED` with `The contract has no field "Shop.nope" to rename "Shop.legacy" to.`, `why` `The contract adds field "Shop.rating".` when it adds any, and next actions `If field "Shop.legacy" was renamed to "Shop.nope", add field "Shop.nope" to the contract, run `{bin} contract emit`, and run this command again.` and one `If field "Shop.legacy" was renamed to "Shop.rating": --rename Shop.legacy:Shop.rating` per name it adds; the same for a model, enum value, value object field and namespace. Code and `meta` stay. Typed at the prompt, the reason is the same text in one sentence run; a new name the contract had before gets `the contract had field "Shop.id" before this change too, so it is not the new name of "Shop.legacy".`, and a wrong old name `The rename's old name is not "Shop.legacy". Write it as …`.
7. **Flags that did nothing**, from `meta.unmatched` and `meta.confirm`: `Remove --delete Nope: nothing in this change is called that.` and `Remove --confirm postgres: nothing in this change needs it.`; and, from the flags the engine left unconsumed, a flag that names a subject with a verb its question does not take: `Remove --allow Legacy: this change does not change access to model "Legacy".` or `Remove --delete User: this change does not delete the data of "User".` A second `--delete` or `--allow` of one subject is refused before anything is asked with the CLI's `CLI.CONSENT_UNUSED` (`--allow User was given, but the question about User was already answered by --allow User.`), the same error the dry run and the control API give.
8. **`--yes`.** The engine exposes no field for it; its summary says `which --yes cannot give`. When it does, `why` ends with a paragraph naming every kind of change open: `--yes does not allow this: it would delete data.`, `…: it can change or lose data.` for a type change, `…: it would change who can read and write data.` for an access change, joined with `and` when several are open (`…: it would delete data, can change or lose data and would change who can read and write data.`). A test runs the real engine, so an engine wording change fails it.
9. **The prompt.** The engine prints `<question text> (<verb form> or <verb>)`. The question text is the headline, on the first question of a removed namespace its fact, the operations, the notes, the ways to keep the data, what else to give, and one sentence on what each verb means, the namespace's verbs first, for example `rename keeps the values under the new name; delete lets them go.`, `rename keeps the values under the new name, "rating" or "score"; …` when the contract has several, `convert writes a conversion for you to fill in; delete lets the database cast the values, which can change or lose some.`, or, when the contract has no new name, `rename works once you add the field to the contract under its new name and run `prisma contract emit``. The engine does not substitute `{bin}` in what it asks, so the CLI puts its name there, in the question text and in the reason a rejected typed answer gets.
10. **Words.** No text this slice builds, or a note or advice string the commands add to it, says "statement", "question", "answer", "asks about" or "needs N answers"; a test builds every kind of text and checks. The contract the user is planning to is "the contract"; the other is "the contract before this change", and the snapshot recovery steps say once that, for `db update`, it is the contract the database was last updated to. Target advice that reached the refusal with such a word is reworded in the target. The test also builds the rebuilt `CLI.PROMPT_INVALID` and the rejection of several wrong typed renames, and checks them and the rename-to-a-missing-name texts for "origin contract", "destination contract" and "resolve" too. The other `MIGRATION.STATEMENT_*` texts, the `Statements applied` heading, "statement" in target advice, and the docs are out of scope.
11. **One `--allow` per model.** `db update` asks one question per model about every operation that changes its access, and one `--allow` answers it, on the refusal, the prompt, the dry run and the control API. `matchConsents` lets a flag naming a subject answer every question about it, for `--allow` as for `--delete`, so a second `--allow User` is refused as unused, with `CLI.CONSENT_UNUSED` on every path. Each operation is still recorded as allowed at its own position; the success output and `appliedStatements` show one entry for the one flag, with all those positions.

## Out of scope, recorded in `deferred.md`

- Engine changes: a description beside each choice in the prompt; a `meta` field saying why nobody could answer, which would remove the read of `--yes` from the engine's summary; question positions in `meta.unanswered`; a title and body for a question, so `CLI.PROMPT_INVALID` for an answer with no verb and `CLI.PROMPT_CANCELLED` stop quoting the whole prompt; the engine's own `CLI.CONSENT_UNUSED` text.
- "Statement" in `MIGRATION.STATEMENT_*` texts, the `Statements applied` heading, target advice strings and planner conflicts, and the docs.
- The dry run's list of what an apply would stop for, which renders the same subjects another way.
- An operation label that shows a policy's stored name; the enum delete line not saying what the rows then hold.

## Done when

1. Every refusal and prompt text for: a removed model (one and several operations), field, enum value, value object field, namespace, storage no model stores (origin known and unknown), a type change on `migration plan` and on `db update`, an access change, several open questions, a stray flag, `--confirm`, and `--yes`, on PostgreSQL, SQLite and MongoDB where each applies, is asserted in full by a unit test or journey.
2. No user-visible string built by `plan-questions.ts`, `plan-question-text.ts`, `plan-question-prompt.ts`, `keep-data-edit-advice.ts` or the refusal contains "statement", "question", "answer", "asks about" or "needs N answers"; a test checks the built texts of every builder.
3. Every journey and unit test that asserted the old texts asserts the new ones in full.
4. `docs/reference/error-reference.md` (`CLI.CONSENT_REQUIRED`), the CLI README and `skills/prisma-8/references/{migrations,debug}.md` show the new output; an upgrade note under `upgrade-instructions/pending/` tells scripts that match the summary or next-action text what changed and to read `meta.unanswered`, that one `--allow` now allows every access change of a model, and that `PlanQuestion` lost its `question` text.
6. For each refusal of the hands-on test, a test follows each printed line as a careful reader would and checks the data it said it would keep or let go.
5. `pnpm build`, `pnpm typecheck`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage` pass; lint and `pnpm test --coverage` pass in each touched package; each touched journey passes run by name.
