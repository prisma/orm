# Dispatch 15: round 4 fixes for PR #30970

**Reviews:** `../reviews/pr-30970/round-4/system-design-review.md` (Q1 to Q4) and `../reviews/pr-30970/round-4/code-review.md` (one finding) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-10-qa-4b-pr1-round-4.md` (problems 1 to 3) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (tip `af97728c9f`)

Each code fix with a test that fails without it. Leave CLI text and names alone (Will).

1. **The shared `const` is chosen by value, not by collection (Q1, code review).** `ValidatorNames` maps a collection to a name, so with two validator changes on one collection both render `usersValidator` even when only one matches the check, and the rendered file would emit a different `ops.json` without an error. A call uses a shared name only when its own validator is canonically equal to the shared value. Test: two validator changes on one collection, one matching the check; the rendered file reproduces `ops.json`.
2. **Values declared once, the way imports are (Q2).** The renderer picks `CollModCall` and `CheckDocumentsCall` out with `instanceof` and passes them names; any other call renders a literal. Let a call declare the values it wants declared once, the way `importRequirements()` declares imports, and let the renderer collect, name and pass them to every call through the base class. No `instanceof` in the renderer for this.
3. **Q3.** ADR 188's last sentence of the section still says the call reads its validator from the validator change; say both calls receive the same value through the shared `const`.
4. **Q4.** `validatorCheckedBy` begins with `!('command' in source)`; use `isInspectionCheckSource`.
5. **QA 1.** When a check or rewrite ran and the validator change did not (the apply stopped before it, for any reason), the failure says that documents the plan already changed may no longer fit the collection's current validator, so updates to them fail until the migration finishes, as the cast and data transform failures already say.
6. **QA 2.** When a document fails only because of a field stored under a name containing `.` or starting with `$`, the advice does not say to change the document so it fits; it says such a field can never fit the validator, and to store it under a name without `.` or `$`, or to set `checkDocuments: false`.
7. **QA 3.** The Migration System doc, the skill reference and the upgrade fragment say that `migration.ts` declares each validator once as a `const`, that the early check and the validator change both use it, and that editing it changes both.

## Rules

As in the earlier briefs. Commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Nothing under `packages/1-framework` changes.

## Done when

Each fix with a test that was red first. Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package, `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage` against `origin/main`, the MongoDB integration files and every MongoDB journey pass. The committed MongoDB example migrations re-emit unchanged.

## Report

Plain English, short sentences: each item, the tests that were red first, the checks, and the commits.
