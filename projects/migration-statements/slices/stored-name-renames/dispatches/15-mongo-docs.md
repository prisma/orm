# Dispatch 15 (MongoDB 6): docs, upgrade instruction and cleanup

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 6 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md`, "Architecture record", "Upgrade notes the fragments must carry", "Text and code that goes away or changes", done condition 8 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d6-progress.md`. The rules of dispatch 10 hold: run only test files you add or change, one per command; no AI attribution in commits; do not push. Write docs in plain English, one paragraph per line (never hard-wrap Markdown prose), describing the end state, not the history. The model for every doc change is what the SQL half did in prisma/orm#31088 (`git show 3672ac7c66 --stat`, then the doc files in it).

## 1. Docs to the end state

Every doc must say what is now true on MongoDB. Done condition 8: no test, journey, doc or message in the repository still says a stored-name change on MongoDB is a drop and create, a removal, or needs by-hand steps. Find them with searches (for example "does not implement", "does not yet rename", "by hand", "keepCollectionByHandAdvice", "two runs", "keep-data edit"), not only from this list.

- `docs/architecture docs/adrs/ADR 324 - The same coordinate is the same object.md`: the status line (built on PostgreSQL, SQLite and MongoDB); the consequence about `KeepDataEdit` ("The MongoDB target still does…"); the MongoDB consequence ("Until the target implements the rule…"). Add what MongoDB does differently and why, briefly: enum chains refused (no transaction); a dropped shared collection asks about every model whose documents it loses; root models sharing a collection with no discriminator, where a removed one blocks a rename; the boolean swap route. And correct the "Old absent, new present … cannot lose data" sentence: once the rename is found, field renames, value replacements and `--delete` answers act on the found collection or table, so a collection with that name that was never the old one renamed would be rewritten. This holds for SQL too; say it once for both.
- `projects/migration-statements/slices/stored-name-renames/spec.md` line about "cannot lose data": the same correction.
- `docs/architecture docs/subsystems/7. Migration System.md`: the MongoDB paragraphs under Statements and "Stored-name changes" (today lines around 211, 233, 238, 239, 252, 255, 266; find them) rewritten to the end state: what is renamed with no question, the refusals and their routes, the `db update` table, and that `keepDataAdvice` on MongoDB is now only for storage not `managed` on both sides and for splits and merges.
- `docs/reference/error-reference.md`: the planning-failed entry, if it describes MongoDB stored-name behaviour or the new refusals.
- `skills/prisma-8/references/migrations.md` and the CLI `README.md` statements paragraph, if they say anything MongoDB-specific about stored names.
- `projects/migration-statements/storage-naming.md` and `design-notes.md`: only if they say MongoDB still drops; the SQL half already reworded the principle.
- `projects/migration-statements/deferred.md`: entries the implementer added are already there; check that each MongoDB gap the earlier steps reported is recorded (identical-shape swaps on `migration plan` keep the storage hash; `--rename` on a shared collection's route is a data migration; the order in which `db update` lists a field statement and a `@map` rename after a hand rename), each with what happens, why, and file and line.
- `projects/migration-statements/plan.md`: its table to the true state. Every slice is merged except this pull request and the close-out; the merged rows are #30638, #30648, #30695, #30691, #30733 and #30773, #30823, #30849, #30869, #30929, #30970 and #31061, #31088, #31179. Read `projects/migration-statements/handover.md` § "Where it stands" for the full list.

## 2. Upgrade instruction

Add `upgrade-instructions/pending/mongo-stored-name-renames/app/instructions.md` and `extension/instructions.md`, modelled on `upgrade-instructions/releases/8.0.0-rc.24-to-8.0.0-rc.25/sources/sql-stored-name-renames/`. Carry the spec's five notes for MongoDB (a stored-name change no longer asks; a `--delete` a script passed for the old drop is now `CLI.CONSENT_UNUSED`; to get an empty collection, remove the model in one change and add it back in a second; swaps, chains and takeovers are refused; the lowering note only if it applies to MongoDB, else leave it out), plus: `--rename` on a model whose collection is shared with another model is now refused, where it used to take the other models' documents with it; and enum stored-value swaps and chains, which used to be asked about with two-migrations advice, are now refused with a two-plan route. Check with `mise exec -- pnpm check:upgrade-coverage --mode pr`.

## 3. Framework CLI code no target reaches

The step 3 report found, by reading: `twoRuns` (`packages/1-framework/3-tooling/cli/src/utils/keep-data-edit-advice.ts`) and `sharesValueWithKeptMember` (`plan-questions.ts`) are reached by no target now; `keepsDataByCommand` is reached only by its branch for edits from the runners' apply-time `keepDataEdit`, and its branch for "a member the destination keeps" is not. Confirm each by reading every caller and every producer of the data it reads (including `swapsValues`). Delete what no path reaches, with the tests that only test it. This is the one permitted change under `packages/1-framework`: code and tests in `3-tooling/cli` only, family-blind. Leave `KeepDataEdit.swapsValues` in `framework-components` and add a `deferred.md` entry that nothing sets it now. If a deletion turns out to need any other framework change, stop and report.

## 4. Remove the handover

Delete `projects/migration-statements/handover.md` and `projects/migration-statements/handover-notes/` (the handover says to delete them in the pull request that finishes this work). Before deleting, move anything in them still needed into `plan.md` or `deferred.md`: the close-out steps and the four open questions recorded for the operator in the handover.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package.
- `mise exec -- pnpm lint:docs`, `mise exec -- pnpm check:error-reference`, `mise exec -- pnpm check:upgrade-coverage --mode pr`, `mise exec -- pnpm lint:deps` and `mise exec -- pnpm lint:ratchets` pass.
- The CLI test files you change pass, each run by file.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.
- Searches for the old MongoDB behaviour find nothing outside `deferred.md`, release notes of past releases and `upgrade-instructions/releases/`.

## Report

Plain English, short: each doc changed and what it now says in one line; the upgrade instruction's notes; what was deleted from the CLI and how you confirmed nothing reaches it; what moved out of the handover; commits; checks with results.
