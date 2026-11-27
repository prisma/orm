# Dispatch 61 (MongoDB): fixes from review round 43 and QA round 30

**Inputs:**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-43/`. Fix `code-review.md` F01 and `system-design-review.md` A106, which are the same defect, and act on the notes listed below.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-30.md`, finding 54.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 61". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

All changes are in `docs/reference/error-reference.md`, in "Moving a MongoDB collection aside", unless a test pins the text.

## Fix

1. **The time-series delete filter matches too much** (F01, A106). A MongoDB filter checks only the fields it names. So a whole-document filter also matches a document with extra fields. `{ f: null }` also matches a document that lacks `f`.
   - Remove the sentence that says matched documents "are the same in every field".
   - When the count is above 1, show the matches with `find(<filter>)`.
   - For each field a match has and the document to delete lacks, add `{ <field>: { $exists: false } }` to the filter. For a field that holds `null`, use `{ $type: "null" }`.
   - Count again, and delete only when the count is 1.
   - When the matches are the same in every field, as `find` shows, deleting one is safe.
   - When the count is 0, say the filter does not match, for example because the meta keys were typed in another order. Tell the user to copy the document from `find` again.
   - Confirm it live: an extra field, a `null` field, both insert orders, and a nested `metaField`.
2. **The regular-collection bullet** (QA 54, round 43 note). It must say plainly that you delete the one in `items` only when you keep the one in `items_kept`.
3. **"Can keep" in place of "keeps"** (round 43 note), where it says a time-series collection keeps more than one document under an `_id`.
4. **The new count bullet** (QA note). Say "the first list in step 5", and use the singular "that `_id`" where there is one.

List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, if any. Do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `lint:docs` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed;
- the live results for item 1;
- the commits;
- each check, with its result.
