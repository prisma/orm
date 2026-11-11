# Dispatch 22: round 11 fixes

**Reviews:** `../reviews/pr-30970/round-11/system-design-review.md` (Z1 to Z3) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-10-qa-4b-pr1-round-11.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (tip `7a03502b31`)

Same principle as dispatch 21: each operation is self-contained and its messages speak only about itself. Do not reintroduce any tracking of what else ran in the apply. QA's problem 1 (partial-apply reporting) and its problem 4 (the framework's "operations that ran stay applied" sentence) are out of scope.

Each code fix with a test that fails without it.

1. **Z1.** In `docs/architecture docs/subsystems/7. Migration System.md`: line ~281 still says `migration plan` does not show planner warnings; it now does. Line ~543 says a MongoDB validator applies to later writes only; say that a validator change the planner writes checks the existing documents first (`checkDocuments`), as the doc already says for Postgres checks.
2. **Z2.** `documentsFitValidator` and `RAW_PLAN_META` moved to family-mongo only for the removed early check; the target is now their only user. Move them back beside `collMod` in the target, and remove the family file, its test and its export. Make `OpFactoryCallNode` private to its file again if nothing outside uses it.
3. **Z3.** Planner warnings have two shapes in `--json`: `migration plan` joins summary and why into one string; `db update` and `db init` list `MigrationPlannerConflict` objects. Return the conflicts from the control API for `migration plan` too, and format them only in human output. Keep the existing `warnings` field for `migration plan`'s own fork warning working; if both kinds share a field today, choose a shape and say which. Add a test that `migration plan` prints a planner warning and lists it in `--json`.
4. **QA 2.** The validator check's failure suggests `--backfill` for fields the plan already filled (`plan` after a fill). Name `--backfill` only for required fields the failing documents actually lack, as the per-document reason already finds.
5. **QA 3.** A new required unique field on a collection with documents fails at the index build with a duplicate `null`. When the duplicate key's values are all `null` or missing, add that the documents lack the field, and that under `migration plan`, `--backfill <Model.field>` writes a slot to give each document its own value, where the planner accepts it.
6. **QA 5.** The failed-cast advice (CLI, `utils/runner-failure-advice.ts`) offers only replacing the cast. Add the simpler route, family-neutrally: or change the value the failure names so the cast accepts it, then re-run.
7. **QA 6.** A document that fails because a field holds a value outside its enum gets no "That document …" reason. Add one.
8. **QA 7.** The planner warning has a ⚠ marker under `migration plan` but not under `db update`. Make both commands render it the same way.
9. **QA 8.** The `documentsNotRewritten` warning says "This change is not a statement". Say instead that no statement (`--rename`, `--delete`, `--convert`, `--backfill`) covers this change, so the plan does not rewrite the documents.
10. **Docs:** update the error reference and any doc that quotes the changed texts.

## Rules

As in dispatch 21: nothing under `packages/1-framework` except CLI code and text; no family vocabulary in CLI strings or identifiers; never the full integration suites; `mise exec --`; no `/tmp`; no bare `git stash`; no comments where code can say it; no bare `as`; no invented names; no hard-wrapped Markdown; commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Do not regenerate the CLI recordings.

## Done when

Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package (CLI included), `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage` against `origin/main`, the MongoDB runner integration files, every MongoDB journey and the Postgres and SQLite journeys and e2e files that assert CLI text all pass, each run to completion.

## Report

Plain English, short sentences: each item with before and after text where text changed, the tests that were red first, the checks, and the commits.
