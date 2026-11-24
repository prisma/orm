# Dispatch 22 (MongoDB): fixes from the whole-branch drive code review, round 6, and from manual QA round 1

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-6/code-review.md` (F01, F02) and `system-design-review.md` (A27, A28); probes in `wip/mongo-stored-names/probes/cr6.test.ts` · **QA report:** `projects/migration-statements/manual-qa-reports/2026-11-24-qa-stored-names-mongo-round-1.md` (scratch projects in `wip/qa-mongo/`) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d13-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. List every site checked.

## Why

Root models with no discriminator that share a collection all read every document in it, and a root model that moves out of such a collection leaves its documents behind (a known gap in `deferred.md`). So which models an operation's documents belong to depends on what the operation does:

- A **rename** of a field or key, or a stored value replacement for an enum, rewrites documents in the way the models that stay read them. For these, the destination's definition (dispatch 21) is right: the other models are those the destination stores in the collection.
- A **variant delete or discriminator replacement** deletes or rewrites documents by their discriminator value. A model that moves out left its documents in the collection, so they can match that filter. For these, a model the destination keeps counts wherever the destination stores it, as dispatch 20 had it. `origin/main` refused this plan; dispatch 21 made it delete another model's documents with no question (round 6 F01).

## Fix

1. **F01.** Variant deletes and discriminator replacements count every origin model the destination keeps, wherever it is stored (dispatch 20's rule), and a model the destination removes does not count. Field renames, key renames and value replacements keep dispatch 21's rule. Name the two rules apart in the code so the difference reads on purpose (one sentence in ADR 324's MongoDB section and in the Migration System doc says why). Round 6 probes become refusal tests: the variant delete and the `--convert` replacement with `Admin` moved to its own collection are refused. The refusal's advice no longer suggests moving the models apart in the same plan; it says the documents of a model that moves out stay in the collection, so the variant change must wait until they are moved by a hand-written migration (for `migration plan`) or by hand, and planned again.
2. **F02.** Whether a holder of a taken name is "removed" is decided on the holder's root model, and the text names that root model. Round 6 probe for `Boss`, a variant of removed `Admin`, becomes a test of the text and of the route followed to the end.
3. **A27.** ADR 324's MongoDB section records which models count as sharing a collection for each kind of operation (renames and value replacements: the destination's; variant deletes and replacements: models the destination keeps; takeovers: every origin model, since a removed model's keys still hold data).
4. **A28.** The upgrade note's takeover route matches the planner: for a field held by another root model in the same collection, removing the model does not free the name; keep the model and remove its field first, or keep the stored name.
5. **QA findings.** No blockers. Per finding:
   - **QA 1.** The hand-written route for `--rename` on a shared collection (`prisma migration new`, then move the documents "with the other operations") cannot be followed: the scaffold has no operations and nothing says how. Replace it with the route the QA runner found works: plan without the statement, then add the move of the documents to that `migration.ts` before the validator change, with a `dataTransform` whose `check` is the right way round. Give that route only where it works, test it by following it, and keep it for `migration plan` only.
   - **QA 2.** Identical-shape swaps on `migration plan`: known framework gap, already documented. No change.
   - **QA 3.** Swap routes say "the field name" where they mean the stored name: say "the stored name (`@map`)" so a reader does not rename the field in the schema. Check every route text for the same word.
   - **QA 4.** `CLI.CONSENT_UNUSED` for a `--delete` that no question needs: if the text is in `packages/1-framework/3-tooling/cli`, make it say plainly that the plan no longer asks about that subject (for example because the change is now planned with no question) before the spelling hint, family-blind. If the text is in the CLI engine (another repository), leave it and record it in `deferred.md`.
   - **QA 5.** The enum swap refusal: rewrite the hard-to-read sentence; temporary values that cannot be confused (for example `prisma_swap_1`, `prisma_swap_2`); chain routes move only the members that need a temporary value, if that is a contained change (else record it).
   - **QA 6.** The no-origin-snapshot advice for `db update`: say which ref name to give `--advance-ref` (`db`), and that once the snapshot is stored a `@@map`-only change needs no statement. Only if the text is in `3-tooling/cli` and family-blind; else record it.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; sites checked; commits; checks with results.
