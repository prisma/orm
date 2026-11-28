# Dispatch 40 (MongoDB): fixes from review round 21 and QA round 11

**Reviews to fix:**

- `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-21/system-design-review.md`: A66 and A67. A68 is done in the PR description.
- `code-review.md` in the same folder: F01 to F03. Its probes are in that folder (`cr-probe.m13a.test.ts.txt`, `cr-probe.m13b.test.ts.txt`).

**QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-11.md`, findings 32 and 33 and the wording note.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d30-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **A66.** The runner's `renameTargetExistsRefusal` and the "MongoDB renames" paragraph of `docs/reference/error-reference.md` still say to make a by-hand `renameCollection` the first operation. Give them the planner's placement: right after the drops of indexes on the old collection, before every other operation. Pin it in the runner test, red first.
2. **A67 and QA 33.** The `migration plan` half of the time-series route in `collectionRenameRefusal` says to stop writes, as the `db update` half does. Pin it, red first.
3. **QA 32.** Under `migration plan`, the swap routes cannot see the database.
   - Their text no longer calls a temporary name one "nothing uses". Say it is unused in both contracts, and to pick another if the database already has a collection or field of that name.
   - The runner's stop when the rename target already exists also says to pick another temporary name, besides dropping the existing collection, when the target is a temporary name from such a route. If the runner cannot tell that, give both options in plain words.
   - Pin both, red first.
4. **QA wording note.** In the three-model split, the plain plan's question tells the user to move the documents of `Bot` and `Staff` but does not name `User`, whose documents also leave. Name every model whose documents leave. Pin it.
5. **F01.** Add the two missing tests for `callRenamingEveryDocument`, from probes m13a (a variant statement's call) and m13b (a call on another collection). Each must fail when its guard is removed. For the third guard (the model still reads that collection), add a test if one can fail, or record why no case can.
6. **F02.** Add a test row with members `"9007199254740994"` and `"1"`, so that removing `Number.isSafeInteger` fails a test.
7. **F03.** Test files over the 500-line limit:
   - Split `runner-document-moves.test.ts` and `mongo-planner.stored-name-sharing.test.ts` by what they test, so each file is at most 500 lines.
   - For `mongo-runner.test.ts`, which was already 1,337 lines on `main`, move this branch's additions (about 570 lines) into new files grouped by subject. Leave `main`'s part as it was.
   - Move tests without changing them. Every moved test still passes.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change or create passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- the new test files, with their line counts;
- the commits;
- each check, with its result.
