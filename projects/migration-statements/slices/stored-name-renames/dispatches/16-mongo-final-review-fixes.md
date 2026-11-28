# Dispatch 16 (MongoDB): fixes from the whole-branch drive code review, round 1

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-1/code-review.md` (findings F01 to F06) and `system-design-review.md` (A01 to A10), both gitignored; probes in `wip/mongo-stored-names/probes/cr1.test.ts` · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d7-progress.md`. The rules of dispatch 10 hold: run only test files you add or change, one per command (journeys one file per command from `test/integration`); nothing under `packages/1-framework`; no AI attribution in commits; do not push.

Fix the class, not the instance. Three review rounds have each found a fix applied at one site and missed at another. For every item, search the whole diff (`git diff origin/main...HEAD`) for the same class and list each site checked in your notes. Each behaviour change gets a test that is red before the fix.

## Code review findings

1. **F01. A root model that leaves a shared collection is asked about.** Root models with no discriminator that share a collection all read every document in it. When one of them moves to its own collection (by `@@map` or by a statement), its documents cannot be told apart and stay behind, so the moving model starts with no documents: that is data loss for the moving model. Plan the storage diff as today, plus a data-loss question about the moving model, carrying the split advice (moving the documents is a data migration, with the hand-written route). `--delete <Model>` answers it. Fix the `--rename` shared-collection refusal text so it says what the plan without the statement actually does, and the upgrade instruction's matching sentence. Fix journey C1 to seed documents of the moving model and assert the question and what happens to them; fix the planner test that asserts `dataLoss: []` for this case.
2. **F02. The boolean swap route works in every environment.** Under `migration plan`, the swap is written into the `migration.ts` of the plan that applies it, as a `dataTransform` (or the target's own operation, if one fits), so every database that applies the migrations gets it; a hand step in mongosh in one database is not acceptable there. Under `db update`, the mongosh route stays, since `db update` changes one database. Test the `migration plan` route by planning, applying the written `migration.ts` to a live database, and reading the values back, with a null, a missing field and a non-boolean value present.
3. **F03. A plan that reuses a collection name it frees.** A rename of `users` to `app_users` followed, in the same plan, by a create of a new collection `users` cannot finish when run again after a stop: the rename's checks then fail on every re-run, and the runner's advice would suggest dropping `app_users`. Refuse this case with a two-plan route (first the rename, then the new model), as MongoDB already refuses other plans a re-run cannot finish. Apply the same reasoning to a field key or embedded key freed by a rename and taken by a new field in the same plan: check by test whether a re-run after a stop finishes; refuse with a two-plan route where it does not. Record the difference from SQL (which plans freed-and-reused in one transaction) in ADR 324's MongoDB section.
4. **F04.** A field rename onto the stored name of a removed embedded relation is refused as a takeover: names already taken include embedded relation stored names. Probe P2 becomes a test.
5. **F05.** The field `@map` change on a shared root collection with no statement (`mongo-statement-planning.ts` around line 869) offers keeping the stored name in the contract, and points at no `migration.ts` that is never written. Search again for every refusal reachable with no statement that names `migration.ts`; for each, confirm the refused command writes one, or replace the advice.
6. **F06.** Add journeys, following each printed route to the end, for: a field taking a removed field's key; a new required field under a renamed field's old key; the embedded relation stored-name change; a collection chain with no statement; the boolean route through the CLI on both commands. Keep files under 500 lines.

## System design findings

7. **A01. One owner for model pairing.** Collection renames (`modelRenamesOf`) and field pairing, removals, variants and questions (`destinationModelOf`) must pair models the same way. First write a test for the reviewer's case (`--rename User:Account` while the origin also has `Account`) and see what happens. Then make `destinationModelOf`/`originModelOf` read the rename list for statement and same-coordinate pairs, keeping pairing by storage (prisma/orm#31061) as the last rule, as SQL reads its rename list.
8. **A02.** Embedded key changes get their own type, not `FieldChange` with a made-up pair and an optional `embeddedIn`. No refusal can print `"Address.street" is renamed to "Address.street"`.
9. **A03.** Key and value rewrite refusals are built through `renameRefused`, in one step.
10. **A04.** ADR 324: asking about every model of a dropped shared collection is not presented as a MongoDB difference; it is a gap in the SQL family (already in `deferred.md`; say so). The rule sentence names collections and keys, not only tables and columns.
11. **A05, A06, A09.** Match the SQL module where it is cheap: text helpers in the module the SQL family keeps them in; one text function per kind; the same names for matching types (`objects`/`rename` as SQL has them, or the reverse in SQL's favour; follow SQL). One function decides "managed in both contracts"; remove `declaredControlPolicy` if it duplicates `collectionControlPolicy`. Rename `PlannedRewrite.keep` to `keepAdvice`.
12. **A07.** Each message uses one noun for one stored place: the label's noun, in the route too.
13. **A10.** Split the MongoDB journey files as the SQL ones are split (renames, refusals, chains and merges, db update, shared storage), each under 500 lines.
14. **Deferred, record only:** in `deferred.md`, the route and refusal text code copied between the SQL family and the MongoDB target (cannot be shared: the only layer both may import is the framework), with the function names; and A08, that `renameRefused` also builds convert and overlap refusals, so it may be renamed in both families later.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, including `test/integration`.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `check:error-reference`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you add or change passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per finding, what changed and the test red first; the sites checked for each class; what the A01 test showed before the fix; journeys added; commits; checks with results.
