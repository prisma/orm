# Dispatch 10 (MongoDB 1): collection and field renames planned from the contracts

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 1 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (read all of it first; the MongoDB column is the scope) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Work only inside the worktree. Keep notes in `wip/mongo-stored-names/d1-progress.md` and update them as you go, so a stopped run can be picked up.

## Why this exists

On MongoDB today, a user keeps `model User` and changes only `@@map("users")` to `@@map("app_users")`. The plan drops `users`, creates `app_users` and asks the user to allow the data loss. PostgreSQL and SQLite already rename the table and ask nothing (prisma/orm#31088). The decision behind both is ADR 324: an object with the same name in the origin and the destination contract is the same object, so a changed stored name is a rename.

The operator approved this build with one instruction: "behavior should be as consistent with the existing reference implementations as possible, while remaining idiomatic for MongoDB". The reference implementation is the SQL family's `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts` and its callers and tests. Read it before designing. Plan the same cases, refuse the same cases, keep the same order, and follow its refusal and advice texts with MongoDB's words (collection, field, document). Differ only where MongoDB itself differs and the spec says so. If you find a difference the spec does not list, do not decide it: put it in your report.

## Inputs

- The spec sections "The rule", "Storage is renamed only when all of it moves", "What a pair with the same coordinate plans", "Where the rule does not apply", "Order".
- `docs/architecture docs/adrs/ADR 324 - The same coordinate is the same object.md`.
- `projects/migration-statements/handover-notes/mongo-code-map.md`, sections 1, 3 and 6. It was made eight commits ago and is a lead; read the code.
- The SQL half's brief for the same step: `dispatches/01-table-and-column-renames.md`, and the SQL source and tests it produced.
- `docs/architecture docs/subsystems/7. Migration System.md` § Statements; ADR 188 (MongoDB operation model, the overlap check); ADR 224 (control policy).
- `drive/calibration/failure-modes.md` F5, F13, F26, F45, F49.

## Outcome

On the MongoDB target, when the plan is built from an origin contract and a destination contract (the `migration plan` path), a model or field with the same coordinate in both contracts whose collection or stored key differs is planned as a rename, with no question, such that the planner pairs objects only on what the two contracts state and never moves documents that belong to a model outside the pair.

In detail:

1. **Confirm the suspected defect first.** Write a planner test showing what `--rename Bug:Defect` does today when `Bug` is a variant stored in its base's collection and `Defect` gets its own `@@map`, and the same for one of two root models that share a collection. Record what you see in your notes. If the whole collection is renamed, the test becomes the regression test for item 4.
2. **Representation.** Inside the MongoDB target, rename planning takes model renames and field renames that each carry the statement that asked for it, or none. Mirror the SQL family's `ModelRename` and `FieldRename`. Do not build a `Resolved*Statement` object for a pair with the same coordinate. One function builds a refusal: with a statement it is today's `statementRefused` conflict, unchanged; without one it is a conflict of kind `unsupportedOperation` with no `refusedStatement`, and text that names the contract change and never says "statement". Every existing site that sets `refusedStatement` or prints "this statement" either goes through it or cannot be reached without a statement; list each site and which it is in your notes. Do not invent a noun for the new kind of pair in type names or messages; use the code's existing words (rename, origin, destination).
3. **Pairs.** Models: a model rename statement; else the same coordinate; else the pairing by storage that prisma/orm#31061 added, unchanged, which compares collections after renames, now counting these renames too. Fields: a field rename statement; else the same field name within a paired model, whichever way the model was paired. **Every helper that reads field renames from the statement list must read the rename list** (the code map names about a dozen across `mongo-statement-planning.ts`, `mongo-field-fills.ts`, `mongo-type-changes.ts`, `mongo-variant-planning.ts`, `mongo-unanswered-changes.ts`, `mongo-documents-not-rewritten.ts`, `mongo-data-transforms.ts`). Find them all with a search, not from the list; one missed leaves an unset or a fill next to the rename. List each in your notes.
4. **All of it moves.** A collection is renamed only when every origin model stored in the old collection that the destination keeps is paired with a destination model stored in the new collection, and every destination model stored in the new collection is new or paired with an origin model stored in the old one. One `renameCollection` per collection. This covers variants in their base's collection, variants with their own `@@map`, and root models that share a collection. When the condition fails for a pair with the same coordinate, no rename is planned and the plan is today's. When it fails for a statement, the statement is refused, following the SQL text.
5. **Managed on both sides.** A pair with the same coordinate is made only when the control policy is `managed` for the old collection under the origin contract and for the new collection under the destination contract. Otherwise no rename, and the plan is today's.
6. **Order.** Collection renames without a statement; the user's statements in the order given; field renames without a statement.
7. **After the rename.** A field statement on a model whose `@@map` changed is planned (today it is refused): the collection rename runs first. A changed type on a renamed field plans as today's type change on the new key. `--delete User.name` on a model whose collection was renamed answers the unset. Questions are named by the origin model and field. The rename does not appear in `appliedStatements`. `migration.ts` renders the same facade calls a statement renders, and running it again writes the same `ops.json`.
8. **Shared collections and field renames.** A field `@map` change on root models that share a collection is refused as a field statement on a shared collection is today, with text that names no statement.
9. **Removed.** `collectionChangeAdvice`, and `keepCollectionByHandAdvice` where no plan reaches it (the unmanaged case may still need it; decide from the code). Tests that assert the old drop, create and by-hand advice for a stored-name-only change are rewritten to show the plan.

## Not in this dispatch

- The check over all collection renames for swaps, chains and takeovers, and the embed relation refusal (next dispatch). Do not make them worse: if a swap plans something unsafe after your change that it did not before, say so in your report.
- Embedded model fields and enum stored values (a later dispatch).
- The live-database rows of the spec's `db update` table (a later dispatch). Do not break `db update`: when the working schema lacks the old collection, plan no rename for that pair, so today's behaviour holds.
- CLI text, CLI journeys, docs, the ADR, the upgrade instruction. If a journey or test outside the MongoDB target package would fail because of your change, list it in your report by reading it; do not run or rewrite it.

## Rules

- Tests first: each behaviour has a test that fails before the change. A test of a refusal asserts the whole conflict (kind, summary, why, and that `refusedStatement` is absent). A test of a plan asserts the whole list of operations.
- **Tests on this machine.** The operator runs many agent sessions on this laptop. Run only the test files you add or change, one file per command (`mise exec -- pnpm exec vitest run test/<file>` inside the package). Never run a whole package's tests, never `pnpm test` with no file, never coverage on a package, never `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. CI runs everything else. `mise exec -- pnpm build` (the full build) is allowed; never build one package.
- Change nothing in `packages/1-framework`. If the design needs it, stop and report.
- Do not branch on the target.
- Use `mise exec --` for node and pnpm. A shell hook rejects any command that contains the bare name of the other Node package manager, or a direct `biome` call. Never write outside the worktree, never to `/tmp`. Never bare `git stash`. No destructive git (no reset, rebase, amend, checkout of files you did not change, clean).
- No comments where the code can say it. No bare `as` in production code (`blindCast`/`castAs`, see the `no-bare-casts` skill). No `any`. No file extensions in imports. Never hard-wrap Markdown prose. Test names omit "should".
- Do not write guards or tests for inputs the public API cannot produce.
- Commit as you go with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Message form: `TML-3840: <sentence saying what is now true>`. No AI attribution lines of any kind (no Co-Authored-By, no "Generated with"). Stage files explicitly. Do not push. Do not stage anything under `wip/`.

## Done when

- `mise exec -- pnpm build` is clean, and typecheck and lint pass in the MongoDB target package (and the MongoDB contract package if you touched it).
- `mise exec -- pnpm lint:deps` and `mise exec -- pnpm lint:ratchets` pass.
- Tests exist and pass, each run by file, for: a model `@@map` change; a field `@map` change; both together; a `@@map` change with a field rename statement; with a type change; with `--delete` of a field; with a new required field; a model renamed by statement whose field changes `@map` only; the base of variants changing `@@map` with the variants following (one rename); a variant gaining and losing its own `@@map` (no rename, no document of another model moves); one of two root models sharing a collection moving (no rename); all root models of a shared collection moving together (one rename); `--rename Bug:Defect` on a shared collection (refused); a name freed by a rename and taken by a new model (planned); a collection not `managed` on either side (today's plan); no origin contract (today's plan); the pairing by storage of #31061 still pairing after a rename.
- `git diff --stat origin/main -- packages/1-framework` is empty.

## Report

Plain English, short: what is now true; the tests that were red first; what the defect probe in item 1 showed; every `refusedStatement` site and every field-rename reader with its disposition; tests and journeys outside the package that will now fail and why (from reading, not running); any difference from the SQL behaviour, with the reason; anything in the spec the code made you doubt; the commits; the checks you ran with their results.
