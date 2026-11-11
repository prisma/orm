# Dispatch 14: round 3 fixes for PR #30970

**Reviews:** `../reviews/pr-30970/round-3/system-design-review.md` (R1 to R4, N3) and `../reviews/pr-30970/round-3/code-review.md` (F01) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-10-qa-4b-pr1-round-3.md` (problem 1) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Each code fix with a test that fails without it. Leave CLI text and names alone (Will).

1. **Replace the `beginOperationsRead` override with one shared value in `migration.ts` (R1).** The framework's hook is documented as discarding per-read state before a read. Swapping the `operations` getter from it uses it for something else, and a subclass that overrides it without `super` would emit a check that checks nothing. Instead:
   - The early check carries its validator again: `checkDocuments({ collection, validator, rewrittenFields, renamedFields })` builds its relaxed precheck when it is built, as it did before dispatch 12.
   - The target's renderer (`render-typescript.ts` and the call classes) writes each validator the plan uses once, as a `const` at module level in `migration.ts`, and both the early check and the validator change refer to it by name. So the file holds each validator once, an edit applies to both, and each `ops.json` entry carries its own check.
   - Remove the override, the resolver (`resolveDocumentChecks`, `document-checks.ts` resolution path) and the "no validator change after it" emit error and its error reference text, which no longer apply. Keep `documentsFitValidator` where both the factory and `collMod` use it.
   - A hand-written `migration.ts` may pass any validator to the check; ADR 188 and the Migration System doc say the check and the validator change should use the same value, and show the `const`.
   - Tests: the rendered `migration.ts` declares one `const` per validator and both calls use it; re-running it reproduces `ops.json`; editing the `const` changes both the check and the validator change; `PlannerProducedMongoMigration` (`db update`) builds the same operations.
2. **F01, R2. Fail closed.** An `ops.json` entry whose `meta.checkDocuments` is set but whose precheck is empty is refused when it is read, with `MIGRATION.INVALID_OPERATION_ENTRY`. Serializer test.
3. **R3.** Put the reader that takes the validator back out of the check's pipeline (`validatorCheckedBy`) beside `documentsFitValidator`, which writes that shape.
4. **R4.** Keep one read plan meta constant in the family; remove the target's duplicate.
5. **N3, `meta`.** ADR 188 says that the operation's `meta` in `ops.json` and `collMod`'s third argument are unrelated.
6. **QA 1.** When the only reason a document fails is a field stored under a name containing `.` or starting with `$`, the "That document …" sentence names it.

## Rules

As in the earlier briefs. Commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push.

## Done when

Each fix with a test that was red first. Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package, `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage` against `origin/main`, the MongoDB integration files and every MongoDB journey pass. The committed MongoDB example migrations re-emit unchanged. Nothing under `packages/1-framework` changes.

## Report

Plain English, short sentences: each item, an example of the rendered `migration.ts` with the shared `const`, the early check's `ops.json` entry, the tests that were red first, the checks, and the commits.
