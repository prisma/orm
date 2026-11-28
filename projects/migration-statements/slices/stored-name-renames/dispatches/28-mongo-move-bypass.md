# Dispatch 28 (MongoDB): the document move skips validation when the target's validator changes later

**Design:** `projects/migration-statements/slices/stored-name-renames/design-move-bypass.md` (approved by the operator; build it as written). **Reviews it answers:** `reviews/move-bypass-design/architect-review.md` and `pe-review.md` in the same slice folder. **Also fixes:** round 10 system-design review A37 and QA round 4 finding 11 (`reviews/pr2-round-10/system-design-review.md`, `manual-qa-reports/2026-11-24-qa-stored-names-mongo-round-4.md`). **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d19-progress.md`. Never use `/tmp`.

## Rules

- Run only the test and journey files you change, one per command. Never run a whole suite.
- Run everything through `mise exec --`. Never use `npx`.
- Change nothing under `packages/1-framework` beyond `3-tooling/cli`.
- Write the tests first. Each behaviour change is red before the fix.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Add no AI attribution lines.
- Do not push.
- No QA is running, so you may build.

## Stop and report instead of building something else when

- building the route text after statement planning (design section 3) is not a contained change;
- the destination contract with the variant kept is not available to the variant route;
- the shared per-collection function (design section 2) cannot be extracted without changing what `planCalls` emits.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Write it in plain English and keep it short:

- for each design section, what changed and which test was red first;
- any design point you could not build as written, and why;
- the commits;
- each check, with its result.
