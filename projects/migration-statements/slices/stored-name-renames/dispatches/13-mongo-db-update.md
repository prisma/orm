# Dispatch 13 (MongoDB 4): `db update` against a database that does not match the origin

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 4 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md`, section "`db update` and a database that does not match the origin", and "Failure states" · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d4-progress.md`. The rules of dispatch 10 hold unchanged: run only the test files you add or change, one file per command; nothing under `packages/1-framework`; no AI attribution in commits; do not push.

The reference is Part B of the SQL half's `dispatches/02-review-fixes-and-db-update.md`, and the SQL code it produced: `foundTables`/`foundColumns` (`FoundUnder`) in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, and the "the database has both tables" refusal in `tableRenameConflict`. Match its cases and its texts with MongoDB's words.

## Part 0: fixes from the step 3 review

The review is `wip/mongo-stored-names/d3-review.md`, probes in `wip/mongo-stored-names/probes/d3.test.ts`. Commit these fixes before the outcome below. Fix the class, not the instance.

1. **Finding 1, regression.** In `fieldRenameConflict` (`mongo-rename-conflicts.ts`), `others` holds only changes whose documents the rename reaches (the same set `originFieldsStoring` builds). Probe V1 becomes a test: `Bug.a` moving `x` to `y` with no statement and `--rename Epic.c:Epic.d` moving `z` to `x` in the same collection is planned.
2. **Finding 2, the boolean swap route.** Follow it by hand and make it safe: filter on `{ field: { $type: "bool" } }` (or `$cond`) so `null`, missing and non-boolean values are untouched; use `$map` for a list; say how to apply it (`migration apply` on the written `migration.ts`). For `db update`, say plainly that the command cannot make this change and the route is a migration project's `migration plan`, or a rewrite in mongosh followed by `db update`, whichever is actually followable to the end; test the route you give.
3. **Finding 3, shared fields of an enum.** When root models share a collection with no discriminator and type the same field by the same enum, a changed stored value is replaced once in every document, as stored-key planning does with `storedKey.together`. Probe E1 becomes a test. Every enum refusal's advice is followable: the enum `unlistedRefusal` also offers "keep its stored value in the contract", and no advice tells a user to edit a `migration.ts` that a refused command never writes.
4. **Finding 4, embedded keys in a collection that is not `managed`.** Match SQL and the other MongoDB paths: no refusal; the change is left out, with the same planner warning top-level fields get (`controlPolicySuppressedCall`). Add a test. (This reverses item 1 of the step 3 brief, on purpose: the operator asked for consistency with SQL.) Add a test for a no-statement enum change in a collection that is not `managed`.
5. **Finding 5.** An enum swap, chain or merge is refused only when a `managed` place stores the enum. Otherwise nothing is planned, as SQL skips an enum no managed column uses.
6. **Verdict 3.** An embedded key takeover gives the named two-plan route that top-level renames give (`fieldRoute`): it names the fields and a temporary stored name. Probe K1 becomes a test that follows the route.
7. **Minor.** The cycle route text separates its items with semicolons. Plan tests assert the whole operation list, not only labels or rendered calls. The discriminator test's title says what it asserts.

## Outcome

When the working schema is the live database (`db update`), a collection rename that no statement asks for follows this table, such that a database whose rename was already done is treated as renamed for the rest of the plan, and no operation is planned on a collection that is not there.

| Live database | Result |
| --- | --- |
| Old present, new absent | Planned (already true) |
| Old absent, new present | No operation. The planner records that the origin model is now in the new collection, exactly as a planned rename does: field renames on it (statement or not), questions about its fields named by the origin model and field, and `--delete User.field` answers all work against the new collection. This is the state of every user who followed today's by-hand advice, and of a `db update` that stopped after `renameCollection`. |
| Old absent, new absent | No operation, nothing recorded; the collection diff creates it, as today. |
| Old present, new present, and the origin contract does not have the new name | Refused with its own text, following SQL's "the database has both tables" text in MongoDB words: the two possible causes (the rename was half done by hand or the application wrote to the new collection before `db update` ran; or the old collection was renamed by hand and its name then used for another collection), each with its fix and which collection holds the model's documents. No `refusedStatement`, never "statement". When the origin contract has the new name too, the swap and takeover refusals apply as on `migration plan`. |

Keys and stored values are not in the schema the planner reads, so for them the protection is at apply time: `$rename` has the precheck that no document holds both keys and touches only documents that hold the old key, and a value replacement touches only matching values. Show by test that this holds.

**A stopped run finishes when run again.** A `db update` that renames a collection and a field and stops after `renameCollection` (simulate it by applying only the first operation to a live database) plans, on the next run, no collection rename and the field rename against the new collection, and the documents end under the right names. The same for a stop after some `renameStoredKey` or `replaceStoredValue` operations of a plan.

## Tests

Against a live MongoDB (mongodb-memory-server; see how `test/integration/test/mongo/target-runner/` and `db-update-statements.test.ts` do it), each run by file:

- each row of the table;
- a collection renamed by hand combined, in the same `db update`, with a field `@map` change; with a removed field answered with `--delete User.field`; with a field rename statement;
- the stopped-run cases above, asserting the documents after the second run;
- the "both present" refusal, whole conflict asserted, and each of its two fixes followed to the end.

Rewrite the planner tests that currently encode the "old absent" case as a plain create-and-drop.

## Not in this dispatch

CLI journeys and docs (next dispatches). If a journey outside the package would fail, list it from reading.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package.
- `mise exec -- pnpm lint:deps` and `mise exec -- pnpm lint:ratchets` pass.
- The tests above exist and pass, each run by file; behaviour changes red before the change.
- `git diff --stat origin/main -- packages/1-framework` is empty.

## Report

Plain English, short: per step 3 review fix, what changed and the test red first; per row of the table, its tests; the stopped-run results; journeys that will fail and why; any difference from SQL with its reason; commits; checks with results.
