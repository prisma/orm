# Dispatch 11 (MongoDB 2): review fixes for step 1, and the refusals

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 2 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md`, section "Refused in this slice" (MongoDB column) · **Review to fix:** `wip/mongo-stored-names/d1-review.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d2-progress.md`. The rules of dispatch 10 (`dispatches/10-mongo-collection-and-field-renames.md` § Rules) hold unchanged, above all: run only the test files you add or change, one file per command; nothing under `packages/1-framework`; no AI attribution in commits.

Fix the class, not the instance: for each finding, look for the same defect everywhere in `git diff $(git merge-base HEAD origin/main) HEAD`.

## Part A: review fixes

Fix every finding in `wip/mongo-stored-names/d1-review.md` that the orchestrator marked "fix" below, and apply the verdicts on the six differences from SQL as listed below.

- **Finding 1, fix first.** Root models that share a collection with no discriminator: when the destination removes one and moves another, the removed model's documents can be neither selected nor asked about, so a rename would silently read them as the other model's. In `sharedCollection`, a removed origin model in the old collection that is not a variant blocks the rename (it counts as a split). Then the plan with no statement is today's drop with its question, and `--rename User:Member` in the same situation is refused with the shared-storage text. Regression tests for both, red before the fix. A removed variant still does not block, since its documents are selected by discriminator and asked about.
- **Finding 2, fix.** A merge with no statement attaches sharing advice to the drop, in MongoDB words, mirroring SQL's `sharedStorageAdvice` (`packages/2-sql-family/9-family/src/core/migrations/operation-subjects.ts`): the storage of the models is being merged, and keeping the documents is a data migration, with the hand-written route.
- **Finding 3, fix in Part B.** The swap, chain and takeover check compares against the schema before any rename is applied, as SQL does, so the result does not depend on the order models are declared in. A test declares the chain in both orders and gets the same refusal.
- **Finding 4, fix.** A test passes `--delete User.name` on a model whose collection is renamed and asserts the statement is applied and the unset is on the new collection.
- **Finding 5, fix the import cycle** by moving `modelCoordinates` and `sameModel` to one module both files import. The policy-violation text: leave as is.
- **Differences 1, 2, 3, 5, 6: keep.** Add to the time-series refusal text the route "remove the model in one change and add it back in a second", as the reviewer suggests.
- **Difference 4:** fixed by finding 2 for merges. For a split, record in `projects/migration-statements/deferred.md` that the moving model's documents stay in the old collection and are read as the other model's, that this predates this work, and give file and line.
- **Also record in `deferred.md`:** SQL has no "Add --rename A:B" hint for a field statement whose model's name and table both change; MongoDB has one.
- **Also from the step 1 report:** `mongo-variant-planning.ts` (around line 266) says "leave out this statement" in a case reachable with no variant statement (an enum rename moves the discriminator). Make that text true in both cases.

## Part B: the refusals

The reference is the SQL family's one check over all renames: `tableRenameConflict` and `columnRenameConflict` in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts`, with `freeName`, `tableRoute`, `columnRoute`, `unusedTableName`. Mirror their cases, their order of checks and their texts, with MongoDB's words (collection, field, document, key).

1. **Collections.** One check runs over all collection renames of a plan, those from statements and those with none, before any is applied. A rename with no statement is refused when:
   - its new name is held in the origin by a collection that is renamed in the same plan (swap or chain);
   - its new name is held in the origin by a collection nothing renames (takeover), with the two-plan route that names the model to remove first, or a collection name nothing uses;
   - another rename that a statement asks for takes its old name, or the reverse (chain with a statement, both directions).
   A statement rename and a model that keeps its name moving into one new collection is a merge: the statement is refused, as the SQL text does. Statement renames among themselves behave as today. Each refusal is `unsupportedOperation` with no `refusedStatement`, names the contract change, says what the plan would misread (the documents of one collection as documents of another model), and gives the two-plan route through a name nothing uses. Leave the `db update` "the database has both collections" case to dispatch 13: until then, when the working schema has the new name and the origin contract does not, plan no rename for that pair, as today.
2. **Fields.** A swap, a chain, and a takeover of a removed field's key are refused. Check whether the overlap check (`mongo-rewrite-overlaps.ts`, `overlapRefusal`) already refuses each one with no statement. Where it does, make its advice the followable two-plan route the SQL column refusal gives, with MongoDB's words. Where it does not, add the refusal. An old key reused by a new required field (the fill writes a key the rename empties) is refused by the overlap check; make sure its advice works.
3. **Embed relation.** A same-name embed relation whose stored name changes (possible only through the TypeScript contract builder) is refused, as a statement on an embed relation is refused today, with text that names no statement. Today it may plan nothing; show what it does first.
4. **Advice is checked by following it.** For each refusal, follow its route against the planner in a test: plan the first step, apply it to the working schema as the next origin, plan the second step, and assert both plans and that no document of another model is moved. Record in your notes, per refusal, the route and the test that follows it.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in the MongoDB target package.
- `mise exec -- pnpm lint:deps` and `mise exec -- pnpm lint:ratchets` pass.
- Tests exist and pass, each run by file: every review fix (red before the fix); collection swap, chain, takeover, merge with a statement, chain with a statement in both directions; field swap, chain, takeover; old key reused by a new required field; embed relation stored-name change; each route followed to its end.
- No refusal reachable without a statement carries `refusedStatement` or says "this statement" (a test asserts it for each new refusal).
- `git diff --stat origin/main -- packages/1-framework` is empty.

## Report

Plain English, short: per review finding, what changed and the test that was red first; the refusals with their routes and the tests that follow them; any difference from SQL with its reason; commits; checks with results.
