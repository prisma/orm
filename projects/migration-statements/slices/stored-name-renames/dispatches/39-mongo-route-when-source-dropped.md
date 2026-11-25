# Dispatch 39 (MongoDB): the shared-collection route when the plan without the statements drops the source

**Case:** CodeRabbit comment 4693501400. The entry is in `wip/coderabbit/triage.md`, and the probe and partial fix are in `wip/coderabbit/probe-c13.test.ts.txt` and `probe-c13-partial.diff`.

`User`, `Admin` and `Auditor` share collection `users`. `User` is renamed with `--rename`, and `Admin` and `Auditor` move to their own collections by `@@map`. Today the route says the documents stay and nothing is asked. In fact, the plan without the statement drops `users` and asks about all three models.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d29-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The decision (made by the orchestrator)

Each group's consequence comes from what the plan without the statements actually does to the source collection, which that plan's result already holds. It is not inferred from which models the route thinks stay.

- **The plan keeps the source collection:** the leave-behind route stays as it is.
- **The plan drops the source collection:** every model whose documents are in it, not only the refused one, is answered by the drop question. The route then covers each of those models:
  - Print the steps that move the documents of every model leaving that collection. Use the planned copy steps where they apply, and the hand-written route where they do not.
  - Say to answer the drop question with the `--delete` it offers, because the copies run before the drop. This is the same as the existing case where every model leaves.

## Tests

- Probe c13 as a planner test asserting the whole route text. It must be red first.
- A runner test, or extend `runner-document-moves.test.ts`, that follows that route to the end. The documents of all three models must end in their new collections, and `users` must be dropped.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in the touched packages, `test/integration` included.
- `lint:deps` and `lint:ratchets` pass.
- Every test and journey file you change passes, each run on its own.

## Report

Plain English, short:

- what changed, and which test was red first;
- the commits;
- each check, with its result.
