# Dispatch 1: build the new output when a plan stops to ask

**Spec:** `projects/migration-statements/slices/consent-text/spec.md` (read all of it first; it is the authority) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3900-plan-stop-output` (fresh from main) · **Ticket:** TML-3900

Work only inside the worktree. Progress notes in `wip/consent-text/out/d1-progress.md`, updated as you go, so the work survives an interruption.

## Why this work exists

The maintainer read the refusal `"Shop.legacy" needs a statement, and the session is not interactive.` and called it terrible user-facing output. A user who hits it has just made a change that would lose data; they need to learn that first, in the words of their own contract, then what each flag would do. They do not know our words "statement" or "question". Judge every string you write by reading it as that user: someone who knows their schema and nothing about how this CLI is built.

## Inputs

- The spec.
- The code: `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts` (`PlanQuestion`, `dataLossQuestion`, `accessChangeQuestion`, `lossText`, `typeChangeNote`, `renameForm`, `withNamespaceDeleteOnFirstQuestion`, `withRecoveryOnFirstStorageQuestion`, `newRequiredFieldNote`), `packages/1-framework/3-tooling/cli/src/orm/plan-question-prompt.ts` (`ledByKeepDataWays`, `engineQuestion`, `promptPlanQuestions`), `packages/1-framework/3-tooling/cli/src/utils/{cli-errors,keep-data-edit-advice,next-actions}.ts`.
- The engine, read-only, built copy: `node_modules/.pnpm/@prisma+cli-engine@*/node_modules/@prisma/cli-engine/dist/engine-*.js` — `statementUnavailable` (builds the refusal and its `meta`), `askStatement` and `statementHint` (the prompt), `writeDiagnostic` (prints `✘ [CODE] summary`, `why:`, `→ label`, `docs:`). You cannot change it.
- Facts already established: the engine's refusal passes through the `.catch` in `promptPlanQuestions`, so the CLI can rebuild summary, `why`, next actions and `meta`. The engine exposes no field for `--yes`; its summary contains `which --yes cannot give`. Tests that assert the old texts in full include the journeys `stored-name-db-update`, `stored-name-chains-and-merges`, `variant-storage-moves`, `table-map-change`, `value-object-statements`, `value-object-backfill.mongo`, `enum-value-statements.mongo`, `namespace-statements`, `convenience-date-time-types-move` (and their `.sqlite` / `.mongo` copies) under `test/integration/test/cli-journeys/`, and the CLI unit tests `test/orm/{plan-question-prompt,db-update-consent,migration-plan}.test.ts` and `test/control-api/statements/{value-object-and-variant-questions,ask-plan-questions,data-loss-question,delete-namespace}.test.ts`. Many more assert one flag or the code; find them with a search for the old strings.
- Ticket TML-3845 (Linear): `db update` prints the same `--allow <Model>` line twice when one model has two access changes, and following it once fails. If the cause is in the question or refusal code you are rewriting, fix it here with a test and say so; if it is elsewhere, leave it and say where.

## Outcome

The spec's "Done when", all five points. Tests first. Where the spec gives a wording, use it unless it would be false or read badly in a case you find; then choose better words in the same order (what the change would do, what the plan would run, each answer with its meaning) and list every such choice in your report with the reason. Where a headline says "Removing …", prove from the code that the subject is in fact removed in every case that reaches that branch.

## Constraints, and why

- **Framework domain.** `packages/1-framework` defines concepts every family shares, and adding to them for one feature has cost the project before. This work may change only family-blind text and CLI-internal types inside `packages/1-framework/3-tooling/cli`. It must not change contract types, `1-core`, or any interface a family or target implements, and CLI text must not name a table, column, row, document or collection except by quoting a label a target supplied. If the work seems to need more, stop and report.
- **Stable contract for scripts.** Agents and CI read `code`, exit code and `meta.subject`, `meta.verbs`, `meta.unanswered[{subject,verbs}]`, `meta.unmatched`, `meta.confirm`. Keep them exactly.
- **No engine-text surgery.** Do not edit the engine's strings by replacement; build from the questions and `meta`. The one allowed read of engine text is the `--yes` check the spec describes.
- **This machine is shared and heavily loaded.** Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named test files only, one at a time (`cd test/integration && mise exec -- pnpm test <file>` for journeys). Run `mise exec -- pnpm build` in full after changing exported types; never build one package, which leaves stale `dist` elsewhere. Save long output to a file under `wip/consent-text/out/` and read the file.
- Run node and pnpm through `mise exec --`. Never `npx`. Use `pnpm test`, not `vitest` directly.
- Code style: no comments where code can say it; no `any`; no bare `as` in production code (`blindCast`/`castAs` from `@internal/utils/casts`); no `@ts-expect-error`; no re-exports outside `exports/`; test names omit "should"; test files under 500 lines; assert whole texts and whole objects, not substrings. Markdown prose is never hard-wrapped. No ticket, slice or review identifiers in code, tests or `docs/`.
- Docs you touch describe the end state only, in plain English.
- Git: stage by explicit path. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "TML-3900: <one sentence saying what is now true>"`. No Co-Authored-By line, no "Generated with" line, no AI attribution anywhere. Never amend, rebase, squash, stash or force-push. Do not push and do not open a pull request.

## Report

In your final message (plain English, short sentences; do not try to save it as a file): what is now true; a table of every situation in the spec's first "Done when" point with the full new text and the test that asserts it; each wording you chose differently from the spec, and why; what you found on TML-3845; anything you had to leave, with the reason; the commits; every check with its result. Say plainly what you did not verify.
