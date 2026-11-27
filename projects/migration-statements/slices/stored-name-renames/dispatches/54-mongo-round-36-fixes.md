# Dispatch 54 (MongoDB): fixes from review round 36, QA round 23 and CodeRabbit's fourth follow-up

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-36/`:
  - `code-review.md`, findings F01 to F05;
  - `system-design-review.md`, findings A91 to A94, and its notes for the code pass.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-23.md`, findings 45 and 46.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4715771760).

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 54". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. A live test file rebuilds `dist` before it runs, so run each one only once, or as few times as you can.

## The decisions (made by the orchestrator)

**1. Remove the printed comparison query.**

These findings all come from the query:

- F01: a time-series collection sorts the keys of an object `metaField`, so the query lists no moved documents.
- F02 and CodeRabbit's point 1: `_id` is not unique in a time-series source.
- A91 and QA 46: the user cannot tell the earlier form of a changed document from the newer one in the target.

Each round has found another case where comparing documents by hand cannot prove that a document was copied. CodeRabbit's own fallback is the safe one: when the user cannot be sure nothing wrote to either collection, keep the source and reconcile by hand.

So the advice after an interrupted or finished copy says this:

- **The counts decide only if nothing wrote to or deleted from either collection since the stop** (F05, CodeRabbit point 2). The rule for writes requires that. Say so in both count conclusions.
- **If the user cannot be sure of that, delete nothing from either collection and do not run the command again.** Tell them to reconcile the two collections by hand first: it is their data, and only they can tell which documents are which.
- **Keep the duplicates query.** It still helps after a re-run that came too early.

Remove `copiedQuery`, the `pipelines` field on `UnionCopy`, and anything else only the query used. That resolves A94. Remove or rewrite the tests that pin the query.

**2. On a database whose policy permits only `migrate`, offer the route QA found (F04, QA 45, A92).** The route:

1. Rename the collection aside with `renameCollection` in mongosh.
2. Run `db migrate`. The create now runs, and so does the rest of the migration.
3. Copy the documents back from the renamed collection.
4. Drop the renamed collection.

Two warnings go with it:

- the copied documents must satisfy the validator the migration created;
- if a later operation in the same migration changes documents of this collection, the user applies that change to the copied documents too.

The route uses only `db migrate` and work in the database by hand, so it stays within what the policy permits. Never suggest changing the policy.

- Offer this route on every database, as the route for a collection that holds data.
- Keep the `db sign` route where `reconcile` is permitted.
- Remove the sentence that says no recovery exists.

Add a journey that follows the route to `db migrate` succeeding on a database that permits only `migrate`, with the data kept.

## Fix

1. Carry out both decisions.
2. **F03, A93.** Pass the database's policies to every space's runner as a separate option, inside `@internal/target-mongo` and its caller, so an extension space gets the same advice. Do not change `packages/1-framework`, except under `3-tooling/cli` if that is truly needed. If the caller lives elsewhere in the framework, stop and report.
3. **The design review's notes.**
   - The `copyCounts` reset: if the code can show its purpose without a comment, do that. Otherwise leave it.
   - The upgrade note: use one wording for "no other database has applied it".

Then update the error reference and the upgrade note to match. List every line of `wip/mongo-stored-names/pr-body.md` that needs to change, but do not edit that file.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs` and `check:upgrade-coverage` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- for each item, what changed and which test failed first;
- the commits;
- each check, with its result.
