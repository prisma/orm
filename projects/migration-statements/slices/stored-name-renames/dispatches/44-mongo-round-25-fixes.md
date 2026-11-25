# Dispatch 44 (MongoDB): fix from review round 25

**Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-25/code-review.md`, finding F01. The design review calls the same finding A70. Probes are in that folder. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The defect

The case: a copy is rejected, and a later validator update in the same migration does not check documents, because someone set `checkDocuments` to false in `migration.ts`. The advice there says "move the copy to after that update". The routes write a move as a copy followed by `deleteDocuments`. Followed as written, the advice moves only the copy. On the re-run, the delete then runs first and removes source documents the copy never moved, and nothing reports it. A rename of the source between the copy and the update breaks the moved copy in the same way.

## The decision (made by the orchestrator)

Remove the "move the copy" option. Reordering hand-written operations has too many layouts to describe truthfully. Give instead the option that keeps the migration in the order the planner wrote:

- set the validator update's `checkDocuments` back to `true`;
- add `{ bypassDocumentValidation: true }` to the copy.

With both, the copy writes under the old validator, and the update checks every document, as the planner's own output does. Keep the existing option to fix the documents or the pipeline.

## Tests

- In `mongo-runner.copy-rejections.test.ts`, pin the new advice, including the layout where the target is renamed in between. The test must fail first.
- Remove or replace the tests for the "move the copy" text.
- Check that the error reference and any docs no longer mention moving the copy.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:docs` passes.
- Each changed test file passes, run on its own.

## Report

Plain English, short:

- what changed;
- which test failed first;
- the commit;
- each check, with its result.
