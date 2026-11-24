# Dispatch 19 (MongoDB): pairing by storage as on main, with no rename derived from it for root models

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` (tip `da3aff9660`) · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d10-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push.

## Why

Dispatch 18 restricted pairing by storage to variants (decision 3). That changed what `origin/main` does for a base renamed with no statement (prisma/orm#31061's tests): `main` pairs it by storage and then refuses with advice naming `--rename Task:Ticket`, or deletes a removed variant's documents with a question. After dispatch 18 the same user error gives an empty plan or a validator stop with no advice. That is a regression this work was not asked to make.

The defect the round 3 reviewer found (A17) was narrower: on this branch, a root model paired only by storage got its same-name fields' stored-key changes planned as renames with no question. ADR 324's rule is about the same coordinate; a root model paired by storage does not have the same coordinate, and the operator decided on 2026-11-19 that a removed model whose storage a new one takes is asked about, not guessed.

## Outcome

1. Pairing of models is what `origin/main` does: a statement; else the same coordinate; else pairing by storage as prisma/orm#31061 built it, for root models and variants alike. Restore the three tests dispatch 18 changed in `mongo-planner.variants.test.ts` and `mongo-planner.variants.discriminator-renames.test.ts` to what `origin/main` asserts, and remove the dispatch 18 pairing test that pins the restriction.
2. A rename with no statement (collection, field, embedded key) is derived only from a pair with the same coordinate, or a pair a statement made, or — following ADR 324 — a variant paired by storage. A **root** model paired only by storage gets no rename with no statement: its fields are planned as `origin/main` plans them (a field whose stored name changes is unset and asked about). The round 3 probe (`User` removed and `Member` added in one collection, a field `n` changing `@map`) becomes a test: no `Rename field`, an unset with a question, as on `main`.
3. ADR 324's pairing table and the Migration System doc say this in one sentence each: pairing by storage of a root model gives questions and refusals as before, never a rename with no question. Remove the `deferred.md` text dispatch 18 added about losing the advice; keep the 2026-11-19 entry about asking about the removed model.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in the MongoDB target.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs` pass.
- The changed test files pass, each run on its own; the variant statements journey passes.
- `git diff origin/main...HEAD -- packages/3-targets/mongo/1-target/test/mongo-planner.variants.test.ts packages/3-targets/mongo/1-target/test/mongo-planner.variants.discriminator-renames.test.ts` shows no change to the three tests from prisma/orm#31061.

## Report

Plain English, short: what changed; the tests restored and added; commits; checks with results.
