# MongoDB code map for stored-name renames (TML-3840)

Read-only investigation of `main` at 540820453c (branch `tml-3840-mongo-stored-name-renames`). Paths are relative to the repository root. `M/` below means `packages/3-targets/mongo/1-target/src/core/migrations/`, and `MT/` means `packages/3-targets/mongo/1-target/test/`.

Sources read: `projects/migration-statements/slices/stored-name-renames/spec.md` in full, ADR 324 (MongoDB parts), the Migration System subsystem doc lines 209–291, the SQL commit 3672ac7c66 (stat, description, framework diff, `storage-renames.ts` header), and the MongoDB target planner sources below.

## 1. Where MongoDB rename planning lives today

All of it is in the MongoDB target, not the MongoDB family. The family supplies contract helpers from `packages/2-mongo-family/1-foundation/mongo-contract/src` (`collectionOfModel` and `embeddingModelOf` in `model-collections.ts`, `otherModelsReached` in `model-documents.ts`, stored-name helpers in `stored-names.ts`).

### The entry point: `M/mongo-planner.ts`

- `MongoMigrationPlanner.plan` (lines 598–1072) runs the whole pipeline in this order:
  1. `planStatements` (628) for model and field `--rename` statements. Result: a working schema with renamed collections, `collectionRenames`, `fieldRenames`, `callOfStatement`.
  2. `planStoredKeyRewrites` (637) for value object and embedded model fields.
  3. `planEnumValueRewrites` (646) for enum stored values.
  4. `renamedTo` map (655) built from statement collection renames only, then `ModelMatchInput` (656–664) with `collectionAfterRenames`.
  5. Field fills (666), variant rewrites (676), field removals (693), type changes (705), `--convert`/`--backfill` transforms (724), stored-key fills (752).
  6. `rewriteRefusals` (802) per rewrite, then `overlapRefusal` (975) over all ordered rewrites.
  7. `planCalls` (502–596): the collection diff; calls are ordered collection renames first (570), then creates, index drops, rewrites, index creates, validators, options, collection drops.
  8. `appliedStatements` (1048) from `callsOf`, a map from statement to calls (810–834). A call with no statement is not reported there.
- `collectionDrops` (294–326) turns every `DropCollectionCall` into a data-loss question. When the model keeps its name and its new collection is created by the plan, it attaches `keepDataAdvice: keepCollectionByHandAdvice(...)` (317). This is what a `@@map` change produces today: create the new collection, drop the old one, ask with by-hand advice.

### Statements: `M/mongo-statement-planning.ts`

- `refused` (214–226): builds `kind: 'statementRefused'` with `refusedStatement`. Every refusal in this file goes through it, so every one says "this statement".
- `planStatements` (235–301): loops over `ResolvedRenameStatement[]`. Namespace statements are refused (252–260); enum value and value object field statements pass through as `unchanged` (261–262) and are handled elsewhere; models go to `planModelStatement`, fields to `planFieldStatement`.
- `planModelStatement` (354–421): refuses embedded models, models with no collection, non-`managed` policy (`controlPolicyRefusal`, 335–352), a source collection absent from the working schema (395–400), time-series (401–406), invalid names (407–413), and a target name already in the working schema (414–419). Otherwise `new RenameCollectionCall(from, to)`.
  - No shared-storage check. `collectionOfModel` returns the base's collection for a variant, so `--rename Bug:Defect` where `Bug` is a variant and `Defect` gets its own `@@map` would rename the base's collection with every variant's documents. This is the MongoDB form of the defect the spec fixes for SQL. A root model that shares its collection with another root model has the same exposure. Not probed; a planner test should confirm it before the fix.
- `planFieldStatement` (423–546): refuses embedded-model mismatches, embed relations (450–455, "Renaming an embedded relation is not supported"), relations on one side, `_id`, unrewritable names (`unrewritableFieldNameReason`), a changed collection with no statement that renames it (494–498, uses `collectionChangeAdvice`), time-series, non-`managed` policy, and a field that other models store in the same collection (519–531, `otherModelsReached`, with `renamedTogether` letting every root model of a shared collection rename together). Produces `RenameFieldCall` with a variant or "none of" discriminator filter.
- `collectionChangeAdvice` (548–557) and `renameCollectionByHandSteps` (559–561): the by-hand route for a field statement whose model's `@@map` changed. Reached only from `planFieldStatement` line 497.
- `keepCollectionByHandAdvice` (567–573): reached only from `mongo-planner.ts` line 317.
- Pairing of models, the rule of prisma/orm#31061: `destinationModelOf` (604–626): a model statement, else the same name, else the only new model stored alike (`storedAlike`, 641–658: neither embedded, same collection after renames via `collectionAfterRenames`, same variant value) that no statement names and no other unmatched origin model is stored like. `originModelOf` (673–681) is the reverse. `ModelMatchInput` (665–670) carries `statements` and `collectionAfterRenames`.
- Pairing of fields: `destinationFieldOf` (688–697), `originFieldOf` (700–709), `renamedByStatement` (715–722), `storedNameMoves` (790–812), `storedFieldsKeptOf` (815–820), `storedNamesRenamedInto` (827–832). All read field rename statements directly from `input.statements`; there is no list of field pairs.
- `planFieldRemovals` (842–896): a field whose stored name the destination model does not store is unset and asked about. This is what a field `@map` change produces today: `UnsetFieldCall` on the old key, a question by the field's name (test `MT/mongo-planner.statements.fields.test.ts:84`), and, for a new required key, a fill from `M/mongo-field-fills.ts`.

### Embedded model and value object fields: `M/mongo-stored-key-planning.ts`

- `KeyChange` (48–58) already has `statement: ... | undefined` and `to: string | undefined`. Today "no statement" always means "removal" (`to: undefined`).
- `valueObjectChanges` (89–130): value object fields take no `@map`, so there is no stored-name-only case here. Nothing to build.
- `embeddedModelChanges` (140–185): an embedded model's field whose stored name the destination no longer has, and no statement renames, becomes `{ to: undefined, statement: undefined }` (180–182), a removal that is asked about. This is today's behaviour for an embedded field `@map` change.
- `refused` (199–218): statement-less means `kind: 'fieldRemovalRefused'` with "Cannot remove ..." and "keep the field in the contract". A statement-less rename needs a third wording.
- `planStoredKeyRewrites` (339–434): finds every place the type is stored (`storedPlacesOf` in `M/mongo-stored-places.ts`), refuses unlisted or self-containing places, unrewritable keys, non-`managed` policy for statements (380–383), and calls `rewriteRefusals`. Produces `RenameStoredKeyCall` or `RemoveStoredKeyCall`, outer keys first.

### Enum stored values: `M/mongo-enum-value-planning.ts`

- `EnumValueRewrite.statement` (58) is already optional. `EnumValueReplacement` (76–78) extends it, so a replacement with no statement is already representable.
- `valueChanges` (222–242): a member with the same name and a different value gives `{ from, to, statement: undefined }` (231–235). Today `planEnum` turns it into a removal, not a replacement.
- `planEnum` (479–628): `stillStoredRefusal` (344–357) and `mergingRefusal` (391–408) apply only to statements (513–523). Then, for each change, a statement with a `to` becomes a `ReplaceStoredValueCall` (588–599); everything else becomes a `RemoveStoredValueCall` with `keepDataEdit` (614–620, the "edit migration.ts" route), or `keepDataAdvice` from `twoMigrationsAdvice` (271–283, swaps and chains, via `overlappingChanges`, 249–259) or `takenValueAdvice` (362–389).
- `refused` (309–329): statement-less means "Cannot remove enum value ...". Needs a rename wording for a same-name change.

### The overlap check: `M/mongo-rewrite-overlaps.ts`

- `overlapRefusal` (440–498) runs once over all ordered rewrites (field renames, key renames, value replacements, fills, unsets, removals, deletes, casts, transforms). It refuses any write to a place another rewrite empties (`overlapsOf`, 350–363) and any filter-order conflict (`filterConflictOf`, 396–404).
- `refusal` (406–422) already handles "no statement": when none of the involved rewrites carries a statement it returns `kind: 'unsupportedOperation'` with "Cannot plan the migration: ...", and no `refusedStatement`. A statement-less rename feeds into it with no change to this file, except advice wording (`adviceOf`, 365–380, `RENAME_ADVICE`, `FILL_ADVICE`).
- It does not see `RenameCollectionCall`. Collection swaps, chains and takeovers need their own check.

### Is there a list of renames that could carry "a statement or none"?

Not for models and fields. `planStatements` iterates statements; `ModelMatchInput.statements` is the statement list, and about a dozen helpers in seven files (`mongo-statement-planning.ts`, `mongo-field-fills.ts`, `mongo-type-changes.ts`, `mongo-variant-planning.ts`, `mongo-unanswered-changes.ts`, `mongo-documents-not-rewritten.ts`, `mongo-data-transforms.ts`) read field renames from it. Embedded keys (`KeyChange`) and enum values (`ComparedChange`, `ValueChange`, `EnumValueRewrite`) already carry an optional statement. The SQL equivalent to copy is `ModelRename` and `FieldRename` in `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts` (lines 33–49), plus `TableChange`/`ColumnChange`, the `StorageRenames` class (183) and `plannedStorageRenames` (850).

## 2. What the SQL half changed, and what MongoDB can reuse

The SQL commit touched 125 files: about 25 source files across `packages/2-sql-family/9-family` (the bulk: `storage-renames.ts` new at 917 lines, `statement-planning.ts` +459/−, `enum-value-planning.ts` ±206, `operation-subjects.ts`, `model-storage.ts` new), the PostgreSQL and SQLite planners (small), and about 100 test, journey, fixture, doc and project files.

Already done and family-blind (MongoDB reuses as is):

- `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts`: `STORED_NAME_ONLY` (line 167) now reads "A model or field that keeps its name needs no statement when only its stored name changes (@map or @@map)." The enum swap hint now says a member that keeps its name needs no statement and stored values that trade places take two plans. Both are true for MongoDB once it is built. The CLI `README.md` statements paragraph also changed.
- ADR 324 exists and already describes the MongoDB rule. Its status line (line 3), the consequence at line 157 ("The MongoDB target still does until it implements this rule") and line 159 ("Until the target implements the rule, a stored-name change on MongoDB is planned as a removal and asked about") need updating in the MongoDB pull request.
- The journey helpers `test/integration/test/utils/stored-name-journeys.ts` (284 lines) and `stored-name-refusal-scenarios.ts` (114 lines) are SQL-shaped (tables, rows). Patterns can be copied; probably not reusable directly.

MongoDB must build itself (nothing in the SQL family is importable into the MongoDB target, by layering):

- A list of model and field pairs with an optional statement, the shared-storage condition, the one rename check, the refusal function without a statement, and the `db update` handling of a database that does not match the origin. SQL's `storage-renames.ts` is the design to mirror.
- Its own wording for refusals and advice.
- Removal of `keepCollectionByHandAdvice` and `collectionChangeAdvice`, and of the enum `keepDataEdit` for a same-name member.

Framework CLI code the spec says to delete "in the second pull request" if nothing reaches it: `twoRuns` (`packages/1-framework/3-tooling/cli/src/utils/keep-data-edit-advice.ts:66`), `keepsDataByCommand` and `sharesValueWithKeptMember` (`packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts:643`, `:666`, used at 886, 895, 1278). After MongoDB stops emitting enum keep-data edits at plan time, the implementer must check whether the apply-time removal paths still reach them: the MongoDB runner still builds a `keepDataEdit` at `M/mongo-runner.ts:1601` (`keepRemovedValueEdit`), and the PostgreSQL and SQLite runners do too (`packages/3-targets/postgres/1-target/src/core/migrations/runner.ts:535`, `sqlite/.../runner.ts:519`, through `packages/2-sql-family/9-family/src/core/migrations/rows-holding-value.ts:148`). `KeepDataEdit.swapsValues` (`packages/1-framework/1-core/framework-components/src/control/migration-statements.ts:196`) stays, per the spec.

## 3. Each deliverable: what exists on main and what is missing

`projects/migration-statements/plan.md` is stale: it lists 4b (MongoDB value object renames, `--convert`, `--backfill`) as "Not started" and stored-name renames PR 1 as "in review". Both are merged: 4b in prisma/orm#31061 (9a152adec7, value objects, embedded models, enum values, variants) and #30970; 4a in #30691; 4p (TypeScript validator) in #30733 and #30773; PR 1 in #31088.

| Deliverable | Operation on main | Statement path on main | What the work is |
| --- | --- | --- | --- |
| Changed `@@map` plans `renameCollection` | Yes: `renameCollection` factory (`M/migration-factories.ts:1394`), `RenameCollectionCall`, runner test `test/integration/test/mongo/target-runner/runner-rename-collection.test.ts` | Yes: `planModelStatement` | A second source of pairs: same coordinate, both collections `managed`. Feed the rename into `renamedTo`/`collectionAfterRenames` so storage pairing, removals, fills and type changes see it. Remove the drop/create and `keepCollectionByHandAdvice`. |
| Changed field `@map` plans `$rename` | Yes: `renameField` (`M/migration-factories.ts:293`), `RenameFieldCall` | Yes: `planFieldStatement` | Second source of pairs. Every helper that reads field statements (section 1) must read the pair list instead, or the old key is still unset and the new one filled. |
| Changed `@map` inside an embedded model, wherever the type is stored | Yes: `renameStoredKey` (`M/migration-factories.ts:627`), places via `storedPlacesOf` | Yes, merged in #31061 | Smallest change: in `embeddedModelChanges` (140–185), a same-name field with a new stored name gets `to` set and no statement. New refusal wording for that case. Value objects take no `@map`, so nothing for them. |
| Changed enum stored value plans a replacement | Yes: `replaceStoredValue` (`M/migration-factories.ts:944`), `ReplaceStoredValueCall` | Yes, merged in #31061 | In `planEnum`, a same-name change with a `to` becomes a replacement, not a removal with `keepDataEdit`. `stillStoredRefusal` must not apply to it (freed and reused is planned). Remove `takenValueAdvice` and the swap `keepDataAdvice` where unreachable. |
| Collection renamed only when every model stored there moves; `--rename` on a shared collection refused | No helper lists the models stored in a collection for this purpose. `modelStoredIn` (`mongo-planner.ts:273`) picks one; `otherModelsReached` is per field | `planModelStatement` has no shared-storage check (likely defect, section 1) | New: a MongoDB "models storing a collection" helper and the two-part condition, applied to statement and same-coordinate pairs. |
| Refusals: swaps, chains, takeovers, merges with a statement | Field, key and value swaps/chains/takeovers are already refused by `overlapRefusal` with no statement and `unsupportedOperation` | Collection statements are refused only when the new name is already in the working schema (414–419), with statement text | New for collections: one check over all collection renames (swap, chain, takeover, merge with a statement, chain with a statement in both directions). For fields and keys: confirm `overlapRefusal` catches each case; rewrite its advice so it is followable. |
| Enum swaps and chains refused (overlap check) | `overlapRefusal` covers replacements that read what others write | Statement cycles and chains refused today | Same-name replacements feed into it. Advice: `twoMigrationsAdvice` and `enumTwoMigrationsAdvice` exist and are close to what is needed. |
| Old key reused by a new required field | Fill plus rename overlap is refused by `overlapRefusal` (`FILL_ADVICE`) | Yes | Mostly a test that the statement-less rename reaches it. |
| Changed embed relation stored name | `ownEmbedStoredNamesOf` exists; today a same-name change may plan nothing (`planFieldRemovals` iterates fields only) | Statements on embed relations refused (450–455) | New refusal for the same-coordinate case, worded without "this statement". |
| `db update` with the collection already renamed | `planModelStatement` refuses a missing source (395–400) | No | New: old absent and new present plans no operation but records the mapping (so `collectionAfterRenames` and field renames work against the new name); old and new both present is refused with its own text. A re-run after a stop between `renameCollection` and `$rename` must finish: `renameCollection` postcheck already makes it a no-op on re-run, and `$rename` touches only documents that hold the old key. |
| Docs, error reference, upgrade instruction | | | ADR 324 status and lines 157 and 159; Migration System doc lines 209, 231–239, 250–253, 264; `docs/reference/error-reference.md` (planning-failed entry); `skills/prisma-8/references/migrations.md`; a new `upgrade-instructions/pending/mongo-stored-name-renames/` (app and extension), modelled on `sql-stored-name-renames`. |

What the spec assumes that does not exist on main:

- A MongoDB list of model and field renames with an optional statement. Embedded keys and enum values already have one; models and fields do not.
- A shared-collection condition for model renames, including for statements.
- A collection-level swap, chain and takeover check. The overlap check only sees document rewrites.
- `db update` handling of "already renamed" and "both present" for collections.
- A refusal wording for a statement-less rename in `mongo-statement-planning.ts`, `mongo-stored-key-planning.ts` and `mongo-enum-value-planning.ts` (each has only "statement" or "removal" today).

Everything else the spec relies on exists: the four operations, value object and embedded model key rewrites, enum value replacements, the overlap check with statement-less refusals, the storage pairing of #31061, and the TypeScript validator (so field stored names are in the storage hash for both authoring forms).

## 4. Tests and journeys that encode today's behaviour

These assert a drop and create with a question, a removal, or by-hand advice for a stored-name-only change, and need rewriting or deleting.

Planner tests in `MT/`:

- `mongo-planner.data-loss.test.ts:161` and `:188`: advise renaming the collection by hand.
- `mongo-planner.statements.refusals.test.ts:202`: field rename refused because "the model's collection changes ... and no statement renames it" (becomes plannable).
- `mongo-planner.statements.fields.test.ts:84`: asks about a field whose stored name changes without a statement.
- `mongo-planner.enum-values.test.ts:290` (offers a keep-data edit for a same-name member), `:315` (asks about a swap with two-migrations advice), `:343` and `:386` (takenValueAdvice), `:400` (boolean swap advice), `:420` (imports `replaceStoredValue` for an edit). These become planned replacements or statement-less refusals.
- `mongo-planner.stored-keys.test.ts:513` ("removes the key of a removed field, as a data loss of the field") and `mongo-planner.embedded-models.test.ts:58`, `:156`: check whether their fixtures change only `@map`; any that do become renames.
- `mongo-planner.stored-key-fills.test.ts` (embedded remove-and-fill cases) and `mongo-planner.fills.test.ts`: check for fixtures where the fill comes from a `@map` change.
- `mongo-planner.statements.test.ts:14` changes the model name too (`Profile` to `User`), so it stays.

CLI journeys in `test/integration/test/cli-journeys/`:

- `keep-documents-advice.mongo.e2e.test.ts` (whole file, 148 lines): follows the by-hand `renameCollection` advice. Delete or rewrite as "planned with no question".
- `delete-statements-migration.mongo.e2e.test.ts` S5 (line 284, follows `collectionChangeAdvice`) and S6 (line 375, `db update` by-hand advice). S6 becomes the "already renamed by hand" `db update` case.
- `enum-value-statements.mongo.e2e.test.ts` E2 (305, swap asked with two-migrations advice), E6 (466, two-run route under `db update`), E7 (541, taken value). E2 and E6 become refusals whose route is followed; E7 becomes a planned replacement or a takeover refusal.
- `variant-statements.mongo.e2e.test.ts` V12 (346) and V4 (374): check; they are about discriminator values, which the rule leaves alone, but V12 includes renames without statements.
- `rename-delete-statements.mongo.e2e.test.ts` R4 (338) and `typescript-field-changes.mongo.e2e.test.ts` T2 (140): check whether their contracts change a stored name with a kept field name.
- `plans-with-no-operations.mongo.e2e.test.ts` N1 (113, "names the changed collection"): check.

## 5. Does the design need a framework change outside the CLI package?

No, as far as the code shows.

- `MigrationPlannerConflict` already has `kind: 'unsupportedOperation'` with no `refusedStatement`, which `overlapRefusal` uses today for a refusal with no statement.
- `ResolvedMigrationStatement`, `MigrationPlannerResult.appliedStatements`, `MigrationDataLoss` and `KeepDataEdit` need no change. A same-coordinate rename simply has no entry in `callsOf` and so none in `appliedStatements`.
- The CLI deletions (`twoRuns`, `keepsDataByCommand`, `sharesValueWithKeptMember`) are in the CLI package and family-blind, and only if nothing reaches them after the MongoDB runner's apply-time `keepDataEdit` is considered.
- One known framework gap stays, as in the SQL half: `migration plan` compares storage hashes in the framework CLI before calling the planner. On MongoDB, two identical collections that swap `@@map`, or an enum whose stored values only trade places (the validator's `enum` list is the same set), may give the same storage hash, so `migration plan` prints "No changes detected" and the swap is not refused; `db update` would refuse it. Fixing that would be a framework change. Leave it, and state it in the ADR and docs as the SQL half did. The implementer should confirm by test whether the MongoDB validator orders the `enum` list, which decides whether an enum swap changes the hash.

## 6. Size estimate and proposed split

Scale: the SQL half added about 14,800 lines in 125 files, roughly 3,000 in source, the rest tests, journeys and docs. MongoDB starts further ahead for embedded keys, enum values and refusals with no statement (the overlap check), and behind for collections (no shared-storage helper, no collection-level check). Expect about 60 to 70 percent of the SQL size: roughly 1,500 to 2,000 source lines in about 12 to 15 source files, and 6,000 to 8,000 lines of tests and journeys.

Proposed dispatches, each with planner tests in `MT/` and, where marked, journeys:

1. **Model and field pairs, with collection and field renames planned (`migration plan`).** Build the MongoDB list of model and field renames with an optional statement (mirroring SQL `ModelRename`/`FieldRename`), the shared-collection condition for both kinds of pair (and the refusal of `--rename` on a shared collection), and route `ModelMatchInput`, removals, fills, type changes, variant rewrites and the unanswered-change text through the list. Remove `keepCollectionByHandAdvice` and `collectionChangeAdvice` where unreachable. Source: `mongo-statement-planning.ts`, `mongo-planner.ts`, `mongo-field-fills.ts`, `mongo-type-changes.ts`, `mongo-variant-planning.ts`, `mongo-unanswered-changes.ts`, `mongo-documents-not-rewritten.ts`, one small helper in `mongo-contract` if needed (about 8 to 9 files). Tests: 4 to 6 planner test files new or rewritten.
2. **Refusals for collections and fields.** One check over all collection renames (swaps, chains, takeovers, merges with a statement, chains with a statement both ways), the statement-less refusal function, the embed relation refusal, and confirmation that field swaps, takeovers and the old-key reuse by a required field reach `overlapRefusal` with followable advice. Source: 3 to 4 files. Tests: 2 to 3 planner test files.
3. **Embedded model keys and enum stored values.** `embeddedModelChanges` pairs by field name; `planEnum` plans same-name replacements, drops `keepDataEdit` and `takenValueAdvice` for them, keeps the overlap refusal for swaps and chains with followable advice. Source: `mongo-stored-key-planning.ts`, `mongo-enum-value-planning.ts`, `mongo-rewrite-overlaps.ts` (advice). Tests: rewrite parts of `mongo-planner.enum-values.test.ts`, `mongo-planner.stored-keys.test.ts`, `mongo-planner.embedded-models.test.ts`, `mongo-planner.rewrite-overlaps.test.ts`.
4. **`db update` against a database that does not match the origin.** Already renamed (no operation, mapping recorded, rest planned against the new name, with a field `@map` change, a removed field answered with `--delete`, and a field statement), both present (refused with its own text), neither present, and the re-run after a stop between `renameCollection` and `$rename`. Source: `mongo-statement-planning.ts`, `mongo-planner.ts`. Tests: a planner test file and target-runner tests under `test/integration/test/mongo/`.
5. **CLI journeys.** New MongoDB journeys mirroring the SQL set (map change, field map change, embedded key, enum stored values, refusals with routes followed to the end, shared collections, `db update`), and rewrites of the journeys in section 4. About 6 to 8 journey files. Run only the touched files locally.
6. **Docs and cleanup.** ADR 324 status and consequences, Migration System doc, error reference, skill reference, upgrade instruction (app and extension), `deferred.md`, `plan.md` correction, and deletion of the CLI enum keep-data code if nothing reaches it.

Review-fix dispatches after 1, 3 and 5 are likely, as in the SQL half (9 dispatches in all there).

Main risks:

- **Field renames are read from the statement list in about a dozen places.** Missing one leaves an unset or a fill next to a rename, which the overlap check would then refuse, or a question by the wrong name. Dispatch 1 is the largest and riskiest.
- **Shared collections are more varied than SQL shared tables**: root models with no discriminator sharing a collection, variants sharing the base's, and variants with their own `@@map`. The condition must cover all, and must not break #31061's storage pairing, which runs after renames.
- **The existing statement defect** (`--rename` on a variant or shared-root collection renames the whole collection) changes behaviour users may rely on; it needs a refusal and an upgrade note.
- **No transaction.** Every planned order must survive a re-run after a stop. The overlap check covers document rewrites, not collection renames mixed with rewrites; dispatch 4 must test the stop and re-run.
- **The storage-hash gap** for swaps on `migration plan`, as on SQL.
- **Journey runtime.** MongoDB journeys use mongodb-memory-server and are slow; the SQL half's journeys were a large share of its diff and its review time.
