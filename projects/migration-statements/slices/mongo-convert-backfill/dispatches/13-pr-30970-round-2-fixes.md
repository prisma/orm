# Dispatch 13: round 2 fixes for PR #30970

**Reviews:** `../reviews/pr-30970/round-2/system-design-review.md` (N1 to N5) and `../reviews/pr-30970/round-2/code-review.md` (F01) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-10-qa-4b-pr1-round-2.md` (problems 1 to 5) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Each code fix with a test that fails without it. Leave CLI text and names alone (Will).

1. **The early check resolves its validator when `migration.ts` emits `ops.json` (N1, F01).** Today the `checkDocuments` operation's `ops.json` entry has no check, and the runner reads the validator from the first validator change of the same collection after it anywhere in the apply, which can be a later migration. Instead, when the migration emits its operations, find the first validator change of the same collection after the check in the same migration, and write the relaxed precheck into the check's `ops.json` entry. `migration.ts` still holds the validator once; `ops.json` describes the check itself; the runner needs no lookup (remove `earlyChecksOf` or its equivalent). A check with no validator change after it in its migration fails when `migration.ts` runs, with a message that names the collection and says to remove the call or restore the validator change (QA 1), and the error reference covers it (QA 2). Tests: a check whose only validator change is in the next migration cannot be emitted; a migration with two validator changes on one collection uses the first after the check; the hand-edited validator still flows into the check; re-running `migration.ts` reproduces `ops.json`.
2. **N2.** The runner imports planner modules again (`variantFilter`, and `rewriteRefusals` pulling in `mongo-statement-planning`). Move `variantFilter` and `otherModelsReached` (and whatever else `rewriteRefusals` needs) into `mongo-contract` or a module that does not import the planner, so the runner does not depend on the planner.
3. **N4.** `MongoFieldRewriteMeta.kind` in query-ast and the target's `RewriteKind` are not tied by type. Derive one from the other.
4. **QA 3.** A data transform whose update fails part way says that documents it already changed may no longer fit the current validator, so updates to them fail until a re-run finishes, as the `--delete` cast message now says.
5. **QA 5.** The value object type change failure includes the "That document …" sentence the other cases have, naming why the named document fails.

## Rules

As in the earlier briefs. Commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push.

## Done when

Each fix with a test that was red first. Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package, `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage`, the MongoDB integration files and every MongoDB journey pass. Re-running the committed MongoDB example migrations gives the same `ops.json`.

## Report

Plain English, short sentences: each item, the new `ops.json` entry of the early check, the new error text, the tests that were red first, the checks, and the commits.
