# Dispatch 35 (MongoDB): fixes from review round 17 and QA round 9, then merge main

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-17/system-design-review.md` (A64) and `code-review.md` (F01, the same defect). Probes are in that folder: `sd-probe.*` P1 and `cr-probe.planner.test.ts` MIXED_KINDS. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-9.md`, findings 30 and 31. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d26-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **A64 and F01.** A refusal that does not print the route says the refusal that prints it "says why". That is false when the two are of different kinds: for a split and a merge refused together, the merge's own reason is printed nowhere.
   - When a refusal's kind differs from the one that prints the route, it keeps its own reason sentence. It points to the other refusal only for what that plan does and how to keep the documents.
   - Test both statement orders and assert each refusal's whole text. Red first.
2. **QA 30.** The variant route's `db update` sentence gives the wrong order: applying the change first makes `db update` stop at the source collection's validator. Say that the documents are moved first and the change is applied after. Check the same order in `migration plan` wording. Add a planner test, red first. Follow the corrected order once in a runner test or journey if the existing ones make that cheap.
3. **QA 31.** A hand-written `dataTransform` update that fails part way runs again over every document it selects, including those it already changed (the same is true on `main`). Say so in the message, and say to make the update give the same result when run twice, or to restore the changed documents first. Runner unit test, red first.
4. **Merge `origin/main` into the branch.** Use a merge commit; do not rebase. Resolve any conflicts. Then run `mise exec -- pnpm build`, typecheck and lint in the touched packages, and the test files that touch any conflicted area.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass after the merge.
- Every test and journey file you change passes, each run on its own. Each behaviour change is red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- any merge conflicts, and how you resolved them;
- the commits;
- each check, with its result.
