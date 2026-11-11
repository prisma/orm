# Dispatch 10: fixes to the early document check

**Review:** `../reviews/code-review.md`, dispatch 9 · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-06-qa-4b-pr1.md`, "Re-check after fixes", new problems A and B · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Each fix with a test that fails without it.

1. **Blocker: a discriminator rename breaks the early check.** `relaxedSchema` turns a rewritten field into `{}` and removes it from `required`, under both names for a rename. For a variant discriminator this leaves `required: []`, which MongoDB refuses ("$jsonSchema keyword 'required' cannot be an empty array"), and with the `enum` relaxed, `oneOf` matches several branches. Drop `required` when it would be empty. For a renamed field, give the old name the new name's schema instead of `{}`, so a discriminator's `enum` still applies under either name. Runner test against a real database: renaming the discriminator of a model with two variants whose documents hold only the discriminator applies, and a re-run is clean.
2. **QA B: a new required unique field on a collection with documents fails with a raw duplicate key error.** The unique index is created before any document check, so documents lacking the field collide on `null` and the user sees `CLI.UNEXPECTED: … E11000`. Plan the early check before the first rewrite or index create on the collection, so it names the missing field and the advice first. Also give a failed index build its own typed failure (the index, the duplicate key, what to do) instead of `CLI.UNEXPECTED`. Runner or journey test with two documents.
3. **QA A: `--backfill` advice for a field the planner will not backfill.** The failure suggests `--backfill User.email` when the origin contract already required `email`; the planner then refuses it. Suggest `--backfill` only for a field the planner accepts it for (new, or optional in the origin contract); otherwise give the other routes (fix the documents, a `dataTransform`, or `checkDocuments: false`). Do not say "The old validator rejects…" when the collection has no validator. Test the Prisma 6 adoption shape: origin contract requires the field, the collection has no validator.
4. **Reason by the discriminator.** The per-field reason picks the branch with the fewest problems and ignores `enum`, so a variant document can be compared with the wrong variant. Choose the branch whose discriminator value the document holds; fall back to fewest problems only when none matches. Test.
5. **ADR 188:** say that under `db migrate`, applying the validator over documents that do not fit means removing the early check call and setting `checkDocuments: false` on the validator change, together, and make the failure's advice say both.

## Rules

As in the earlier briefs. Commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Do not change CLI text in `packages/1-framework`.

## Done when

Each fix with a test that was red first; the checks in the plan's "Checks for every dispatch" pass; every MongoDB journey passes.

## Report

Plain English, short sentences: each fix, the new failure texts, the tests that were red first, the checks, and the commits.
