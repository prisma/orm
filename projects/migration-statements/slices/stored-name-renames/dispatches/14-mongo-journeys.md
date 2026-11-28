# Dispatch 14 (MongoDB 5): CLI journeys, and the engine-wording assertions removed

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 5 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md`, "Slice-specific done conditions" 1 to 8 (MongoDB) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d5-progress.md`. The rules of dispatch 10 hold unchanged: nothing under `packages/1-framework` except the test file named in part 4; no AI attribution in commits; do not push.

**Running journeys on this machine.** The operator runs many agent sessions on this laptop, and MongoDB journeys start mongodb-memory-server and are slow. Run one journey file per command, from `test/integration`, only files you add or change: `mise exec -- pnpm test test/cli-journeys/<file>`. Never `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:all`, or a directory. Run each file again only after changing it.

The reference is the SQL half's journeys: `table-map-change.e2e.test.ts`, `stored-name-db-update.e2e.test.ts`, `stored-name-chains-and-merges.e2e.test.ts`, `variant-storage-moves.e2e.test.ts` (and their SQLite twins), their helpers `test/utils/stored-name-journeys.ts` and `stored-name-refusal-scenarios.ts`, and the SQL brief `dispatches/05-cli-text-and-journeys.md`. Mirror their coverage for MongoDB, reusing a helper where it fits and copying its shape where it is SQL-specific.

## Part 0: fixes from the step 4 review

The review is `wip/mongo-stored-names/d4-review.md`, probes in `wip/mongo-stored-names/probes/d4.test.ts`. Commit these before parts 1 to 4. Fix the class, not the instance: the last two reviews each found a fix applied to one instance only, so for each item search the whole diff (`git diff $(git merge-base HEAD origin/main) HEAD`) and list every site you checked in your notes.

1. **Finding 1, the boolean route on a shared collection.** The swap route is printed only for places where every root model stored in the collection is covered (`together`); otherwise the shared-collection refusal is given. Probe B1 becomes a test.
2. **Finding 5, the boolean route for value objects and embedded models.** The route must be runnable as printed in every place it is printed. Since step 1 of the route writes a `migration.ts` for `migration plan` users, prefer a `dataTransform` there for the swap, which then applies in every database; for `db update` users give a runnable mongosh update with no placeholder. If a place cannot get a runnable update, refuse without a hand route and say why. Test each printed form against a live MongoDB by running exactly the printed text (not a hand copy), with a non-boolean value and a missing field present.
3. **Finding 2.** No refusal reachable with no statement points at a `migration.ts` that the refused command never writes: the stored-key `unlistedRefusal`, the stored-key fill `unlistedRefusal`, the enum `unsupportedValueRefusal`, `SEPARATE_THE_MODELS` when `keep` is undefined, and any other you find. They offer "keep … in the contract" as the enum fix does.
4. **Finding 3.** An embedded key swap in a collection that is not `managed`, or not live, plans nothing, as top-level fields and enums do. The conflict checks see only changes with a managed place in a live collection. Probe K2 becomes a test.
5. **Finding 6.** A two-item route list reads as two items (semicolons or "and then", whichever is clear); update the test that asserts it.
6. **Verdict 2.** Add one live test with a real stop as the reviewer describes (a document holding both keys stops the run after `renameCollection`; remove the extra key; run again without re-initialising the marker; assert the second run's operations and the documents). Also assert the second run's operations in the key and value stop tests, and add one combined plan (collection, field, stored key, value).
7. **Minor.** Embedded key refusals name the key with its path ("key "lines.x"" or as the code names paths elsewhere). Planner tests assert whole operation lists. Remove the duplicate test in `runner-stored-name-renames.test.ts`.

Finding 4 (the spec's claim that "old absent, new present cannot lose data" no longer holds once field renames act on the found collection) is a docs correction, done in the next dispatch. No code change.

## 1. Journeys rewritten

These encode the old behaviour. Rewrite each to show the new one. Do not weaken one to make it pass; if a journey fails for another reason, report it.

- `keep-documents-advice.mongo.e2e.test.ts`: it follows the by-hand `renameCollection` advice. Rewrite it as the collection rename planned with no question, on both commands, documents read back; or delete it if a new journey covers exactly that, and say which.
- `delete-statements-migration.mongo.e2e.test.ts` S5 (field statement on a model whose `@@map` changed: now planned) and S6 (`db update` after a hand rename: now found, nothing planned for the collection).
- `enum-value-statements.mongo.e2e.test.ts` E2, E6, E7: now refusals whose routes the journey follows to the end.
- Check and fix if needed: `variant-statements.mongo` V4 and V12, `rename-delete-statements.mongo` R4, `typescript-field-changes.mongo` T2, `plans-with-no-operations.mongo` N1, and any other MongoDB journey or fixture under `test/integration` or `test/e2e` that expects a drop, a question or by-hand advice for a stored-name-only change. Find them with a search.
- `test/integration/test/cli-journeys/README.md` rows for all rewritten and new journeys.

## 2. New MongoDB journeys

Keep every file under 500 lines. Each reads the documents back after applying.

1. A `@@map` change: collection renamed with no question, `migration plan` then `migration apply`, and `db update`.
2. A field `@map` change, including on a variant field; an embedded model field `@map` change stored in two places.
3. An enum member that keeps its name and changes its stored value, in a scalar and a list field.
4. A `@@map` change together with a type change, with a field rename statement, and with a removed field answered by `--delete Model.field`.
5. A script that passes `--delete Model` for a `@@map` change, as it had to before: refused as an unused consent (`CLI.CONSENT_UNUSED`).
6. Each refusal, its advice followed to the end, the documents found under the right names afterwards: collection swap; field swap; a chain between a statement and a contract change in both directions; takeover of a removed model's collection; enum value cycle; enum chain; a kept member taking a removed member's value; `--rename` on a shared collection; `db update` when the database has both collections. On both commands where the command can reach it.
7. Shared collections: a variant gains its own `@@map` and loses it; one of two root models sharing a collection moves; two models merge into one new name. No rename is planned, and no document of another model moves.
8. `db update` after a collection renamed by hand, combined with a field `@map` change, a removed field answered with `--delete`, and a field statement.
9. For one refusal from a contract change with no statement, run with JSON error output and assert there is no `refusedStatement` and no "this statement".

Each journey asserts the whole printed output of the step it is about, unless the file has a helper that normalises output; then use it.

## 3. If a journey shows a defect

If a printed advice does not work when followed, or a plan loses or misplaces documents, that is a defect in the earlier steps. Fix it in the MongoDB target, tests first, and say so. If the fix needs a design choice the spec does not make, stop and report.

## 4. Engine wording removed from ORM tests

The first line (`summary`) of `CLI.CONSENT_REQUIRED` is written and tested by `@prisma/cli-engine` in another repository. The operator, 2026-11-23: "why do its tests match on CLI wording? that's fucking pointless". Each engine wording change cost edits across this repository. Delete every assertion that quotes it, `'This command requires explicit consent'` in any form, and keep the assertions on what the ORM supplies: `code`, `why`, the next actions and `meta.unanswered`. Where a test asserted the whole error with `toEqual`, drop only the `summary` key (for example with `expect.objectContaining` minus summary, or by asserting the other fields), so the test still fails if the ORM's parts change. Files today: find them with `grep -rln "requires explicit consent" test packages` (excluding `dist` and `node_modules`); they include `packages/1-framework/3-tooling/cli/test/orm/plan-question-prompt.test.ts` (the one permitted file under `packages/1-framework`, test only) and about a dozen journeys under `test/integration/test/cli-journeys/`, several of them SQL journeys. Run each changed file once, one per command.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, including `test/integration`.
- Every journey file you add or change passes, each run on its own.
- `mise exec -- pnpm lint:deps`, `mise exec -- pnpm lint:ratchets` and `mise exec -- pnpm check:error-reference` pass.
- `grep -rn "requires explicit consent" test packages` finds nothing outside `dist` and `node_modules`.
- `git diff --stat origin/main -- packages/1-framework` lists only `plan-question-prompt.test.ts` (and any other test file under the CLI package that quoted the engine's line).

## Report

Plain English, short: per step 4 review fix, what changed and the test red first; each journey rewritten or added, with the done condition it shows; per refusal, the advice and how the journey followed it; defects found and fixed; anything in done conditions 1 to 8 that no journey shows, and why; the files whose engine-wording assertions were removed; commits; checks with results.
