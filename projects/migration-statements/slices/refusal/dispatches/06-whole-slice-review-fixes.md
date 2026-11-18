# Dispatch 6 — Whole-slice review fixes

**Reviews:** [`../reviews/system-design-review.md`](../reviews/system-design-review.md) (S01–S20) and [`../reviews/code-review-final.md`](../reviews/code-review-final.md) (F01–F10, with the probe log). Read both before starting. Fix on new commits; no push.

## Decisions already taken

- **S01 / F02, namespace-wide `--delete`:** deferred to slice 3; recorded in the slice spec and `deferred.md` (`4fe1ebe66c`). Nothing to build. Update the app upgrade fragment and the README if they promise it.
- **S06 renaming of the class value, S20 (`allow` outside the four verbs), S07, S08:** close-out ADR or later slices. Not here.
- **S14, S16, F03, F10:** engine side; handled on prisma/prisma-cli#337 (`values()` and the ADR are done; shell-quoting of flag forms and the prompt fixes are requested).

## Fix in this dispatch

**Correctness**
- **F01 (high):** `answerPlanQuestions` must decide whether a typed rename resolved its loss by the asked-about operation being gone from the re-plan, not by subject equality; a loss left on the same subject is asked in the next round. The probe: `T.ratio Float` → `T.ratio2 Int`; `--rename T.ratio:T.ratio2 --delete T.ratio` on the command line works, the same rename typed fails with `STATEMENT_DID_NOT_RESOLVE_LOSS` and the advice then drops the column. Test both paths.
- **S02 (high):** `executeMigrationPlanCommand` parses `delete`/`allow` statements and drops them; pass them as pre-answers exactly as `executeDbUpdate` does, and refuse unused ones (`STATEMENT_ANSWERS_NO_QUESTION`). Test.
- **F04 / S17:** re-pin the root override to the current #337 head `84ce08e` (has `949a03a` longest-subject matching, `take`, `values()`), run `pnpm install`, and add a CLI test with subjects `Legacy` and `Legacy:x` in one plan where `--delete Legacy:x` answers the right question.
- **F05:** the dry run's "An apply asks about" list and the JSON subjects (`subjectDisplay` in `migration-blocks.ts`) must print the same text the questions use (`User.nickname` after a rename; no `public.` prefix where the question has none). Carry the question's subject text in each entry. Test on Postgres with a renamed model.
- **F06:** a dry run given the correct `--delete`/`--allow` flags must not fail with `CONSENT_UNUSED`; check them in plan mode with `refuseUnusedConsents` and consume the matching ones (use `ctx.statements.values()` to read, then the engine's matching by asking the questions with a plan-mode answerer that accepts flag answers and never prompts; say which you chose). The exact apply command must preview cleanly. Test.
- **S05:** fill `PerSpacePlan.dataLoss` for recorded paths in the aggregate planner (`resolve-recorded-path.ts` and `planner.ts`), using `storageNameOf`, and delete the strategy check in `db-run.ts`.
- **S09:** split `acceptAccessWidening` from `acceptDataLoss` on the control API; `acceptDataLoss: true` no longer answers `allow` questions. Fragment and README.
- **F09:** a policy replacement whose policies have generated (wire) names is a create-then-drop with different names; exclude it from `accessWidening` by pairing drop and create on the same table and the same wire-name prefix (`parseWireName`), as the explicit-name case already pairs by name. Test both.

**Advice text**
- **F07:** with no origin snapshot, the refusal's next actions include the snapshot recovery steps (slice 1's `STATEMENT_ORIGIN_UNKNOWN` advice) before `--delete <storage name>`, and say that `--delete` loses the rows. Test the text.
- **F08:** offer `rename` only where it can succeed: not for a lossy type change on a field that keeps its name, not on MongoDB. Test the verbs per case.

**Names and shape (architect)**
- **S04:** `MigrationStatementSubject` → `MigrationSubject` (and its JSON form), everywhere, docs and fragment included.
- **S03:** export `AnswerPlanQuestions`, `PlanQuestion`, `PlanAnswer`, `PlanQuestionVerb` from `exports/control-api.ts`.
- **S10:** either give `DeleteMigrationStatement` and the delete branch of `describeMigrationStatement` a production caller (the `Statements applied` delete line should use it) or remove them; fix the Migration System doc line 223 accordingly.
- **S12:** rename the loop so it is not the same word as the callback type; move the access-widening question builder out of `data-loss-questions.ts` (or rename the module `plan-questions.ts`); one `sameSubject` helper replaces the four `JSON.stringify` comparisons.
- **S11:** declare the `{ dataLoss, accessWidening }` pair once (`PlanSubjects`) and reuse it; rename one of the two `planSubjects` functions; rename `SubjectTarget` to what it is.
- **S13:** the error reference says `CLI.CONSENT_UNUSED` (engine, CLI flags) and `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION` (control API, programmatic) are the same condition at two boundaries.
- **S15:** one shared verb-declaration object for both commands; fix the engine spec sentence that says the verbs are registered once for the ORM (that file is the orchestrator's: report the sentence, do not edit it).
- **S06 docs:** the five "no neutral middle class" comments in the Postgres and SQLite sources, and the Style Guide's "drops are destructive", say what `widening` means now.
- **S19:** the class doc says `data` operations run what their author wrote and may lose data by design; only the planner's own classification promises data loss ⇔ `destructive`.
- **S18:** a shared test helper that asserts, for a planner's result, that every `destructive` operation has exactly one `dataLoss` entry and no `widening` one has any; use it in the three targets' data-loss tests.

## Gate

The standard gate, `lint:throws`, `check:error-reference`, `check:upgrade-coverage --mode pr --prev bot/tml-3475-statement-renames`, `lint:docs`, `lint:skills`, every journey dispatches 3 to 5 named, and the probes F01, F04, F05, F06, F07 re-run through the built CLI with their outputs pasted in the report.
