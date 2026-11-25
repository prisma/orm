# Design: the document move skips validation when the target's validator changes later

Will approved the direction on 2026-11-25. An architect and a principal engineer reviewed the first draft (`reviews/move-bypass-design/`); this version answers their findings (D01 to D09, P01 to P08).

## The problem

Two refusals print a hand-written route that moves one model's documents out of a collection it shares with other models:

- the shared-collection `--rename` route (`mongo-statement-planning.ts`);
- the variant route (`mongo-variant-planning.ts`).

Both build their text with `documentMoveSteps` in `mongo-plan-text.ts`. The user adds a `dataTransform` to `migration.ts` whose `run` is `rawAggregate(from, [{ $match }, { $merge: { into: to } }])`, followed by `deleteDocuments(from, filter)`.

The planner orders operations by kind, not by collection (`planCalls` in `mongo-planner.ts`): collection renames, collection creates, index drops, document rewrites, index creates, validator updates, option changes, collection drops. Within one collection this order holds the real dependencies:

- the collection exists before it is written;
- document rewrites skip validation, because the old validator rejects the new shape;
- the validator update then checks that every document fits (`collMod` with `checkDocuments`).

The move reads the source collection and writes the target. It must come after the target exists and before every operation on the source. When the plan also updates the target's validator, the order by kind puts that update after the source's rewrites. So the move runs under the target's old validator, which rejects the moved documents, and no position works.

Manual QA found this when the target already existed with a validator. The round 10 review found the same problem when the plan renames another collection to the target's name (for example `guests` to `members`): with the move first, `$merge` creates `members`, and the rename then stops.

## The decision

The move skips document validation only when the target has a validator when the copy runs and a later operation in the plan replaces or removes it. It then follows the same rule as every other document write in a MongoDB plan: write under the old validator, skipping validation, and let the validator update check every document afterwards.

The rule in one sentence: **a write skips validation only when a later operation in the same plan replaces the validator it skips.**

### Dependencies of the move

A future model of operation dependencies needs these edges for the move:

1. after the operation that brings the target into being: its `createCollection`, or the `renameCollection` of another collection to its name; and after the `renameCollection` of the source, when the plan renames it;
2. before every other operation on the source collection, because the source's rewrites change the documents the move reads;
3. before the target's validator update, which checks the moved documents;
4. before the target's rewrites. A rewrite of another model's documents must not reach the moved documents, and the rewrite check refuses one that would: every rewrite counts the models the destination stores in the collection, field renames included (ADR 324), and the moving model is one of them. A rewrite of the moving model's own documents in the target must reach them, and does, because it runs after the move.

### Accepted gaps on a re-run

The move is a `dataTransform` with no checks, so it runs again on every apply. `$merge` matches on `_id` and writes the same values again, and after the delete has run, `$match` selects nothing. Two gaps follow, both of the kind the planner's own rewrites already have:

- documents of the moving model written to the source between a stop and the re-run are copied without validation, and a validator update already skipped on the re-run never checks them;
- a moving document with the same `_id` as a document already in the target is merged into it. With ObjectIds this does not happen in practice.

## Changes

### 1. `bypassDocumentValidation` on `rawAggregate`

This mirrors `rawUpdateMany` layer by layer:

- **MongoDB family query AST** (`packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`): `RawAggregateCommand` takes an optional `RawAggregateOptions { bypassDocumentValidation?: boolean }`, stored only when defined, like `RawUpdateManyCommand`.
- **Lowering draft** (`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts`) and **wire command** (`packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`): `AggregateWireCommand` stores `bypassDocumentValidation` only when it is `true`. Every aggregate the runtime ORM sends uses this wire command, and `computeMongoContentHash` hashes its fields. The cache middleware keys on that hash, so a field present on every aggregate would change every cache key (D07).
- **Adapter** (`packages/3-targets/mongo/2-adapter/src/mongo-adapter.ts`): carries the option from the AST node to the draft, and from the draft to the wire command.
- **Driver** (`packages/3-targets/mongo/3-driver/src/mongo-driver.ts`): `executeAggregateCommand` passes `{ bypassDocumentValidation: true }` to `collection.aggregate` when it is set. MongoDB honours it for `$out` and `$merge`, and Node driver 7.5.0 passes it through.
- **Migration factory** (`migration-factories.ts`): `rawAggregate(collection, pipeline, options?)`, the same shape as `rawUpdateMany`. Its doc comment says it is a read for a check and can also be a write through `$merge` or `$out`.
- **Ops serializer** (`mongo-ops-serializer.ts`): `RawAggregateJson` gets `'bypassDocumentValidation?': 'boolean'`, read with `ifDefined`. An `ops.json` without the key reads and serializes as before.
- **Runner** (`mongo-runner.ts`): `bypassValidationRefusal` also covers a `RawAggregateCommand` with the option set, so a database user without the `bypassDocumentValidation` action gets the same clear failure the rewrites give. Its `why` covers a copy as well as a rewrite.

The runtime ORM and query builder construct `RawAggregateCommand` without options, and their wire commands and hashes stay the same. Nothing under `packages/1-framework` changes.

### 2. One owner for what the plan does to a collection

The first draft worked out "the plan creates the target" and "the plan changes its validator" from the contracts, separately from the planner. That copy ignored the control policy: for an `external` or `observed` target, or a `tolerated` one that exists, `planCalls` plans nothing, yet the copy would have added a bypass that nothing checks later (D01, P02).

So the body of the per-collection loop in `planCalls` (`planCollectionDiff` plus the `plansChangesTo` policy check) becomes one exported function. It returns the calls the plan writes for one collection, or that the policy suppresses them. `planCalls` and the move both use it. `planCreatesCollection` becomes a reader of the same function. The implementer names it after what it returns, in words the planner already uses.

### 3. `documentMoveOrder`

A new module, `mongo-document-moves.ts`, holds the `DocumentMove` type (moved from `mongo-plan-text.ts`) and `documentMoveOrder`. Both routes call it. Its inputs are the origin and destination contracts, the source and target collection names, and the plan's collection renames. `documentMoveOf` builds the `DocumentMove`: its `from` (the name of the source collection when the move runs), its `to`, its order and its copies. The plan without the statements can rename the source, when the models left in it all move to one new collection; the move then reads the source under its new name, right after that rename. The order, from `documentMoveOrder`, holds only where the move goes and whether its copy skips validation:

- `after`: the operation the move comes after. One of `{ kind: 'createCollection' }`, `{ kind: 'renameCollection'; from: string }`, or `undefined` when nothing in the plan has to come first. `undefined` covers a target that exists, and a new target that no `createCollection` creates, such as one with indexes and no validator.
- `bypassDocumentValidation`: true when the target's collection at copy time (the target itself, or the collection renamed to its name) has a validator, and the plan replaces or removes it.
- `validatorChange`: `'replaced' | 'removed' | undefined`, so the text says what happens to the moved documents afterwards.

The copies are a fact of each moving model, not of the order. Each moving model gives its stored-name changes (the plan's field renames, its stated field renames, and the fields its destination model names alike) and, when it is a variant in the target, its discriminator value. Models whose documents change alike share one copy; otherwise each gets its own, with its own filter. A field rename on a model that moves out without a collection rename is neither planned nor refused (`planFieldRename` returns unchanged), so the copy must write it. The copy also removes the fields the destination model does not store, since every validator a contract generates is closed and would stop the apply on them; the route text names those fields, since their values are lost. New required fields are not filled. Each copy needs its own filter, which tells its models' documents apart from those of the other moving models and from the documents that stay.

The renames come from `CollectionRenames.changes`, worked out from both contracts before the statement loop starts, minus the change this refusal drops. They do not come from the map the loop fills, which lacks the stated renames not yet planned (D03).

The rewrites on the target are known only after statement planning. The route text is therefore built once those facts are known. If building it later is not a contained change, the implementer reports that before building something else.

The route leaves out every statement of the change: each model rename statement of the models that move together, and their field rename statements. Leaving out one would leave the others in, refused again for the same reason. The text names each statement. The source collection can be renamed in the plan the route describes: once the statements are left out, the moving model is removed, and the models left in the source can all move to one new collection. The move then reads the source under its new name, after its rename. A planner test shows it. When the plan without the statement is refused as well, the route gives no move and says so, since its facts would describe a plan the user cannot make.

**Variant route.** The route's first plan keeps the variant as it is and moves the documents. `documentMoveOrder` is computed for that first plan: the destination contract with the variant kept. If that contract is not available where the route is built, the text tells the user to write that first contract as this one with the variant kept, so its plan changes collection "to" as the steps expect, and a test shows it (D04).

### 4. The text

`documentMoveSteps` reads only `documentMoveOrder`'s result.

The placement:

- after `createCollection`: right after the creation of collection "to", and before any other operation on collection "from";
- after `renameCollection`: right after the rename of collection "from-of-rename" to "to" (and of the source, when the plan renames it), and before any other operation on the source;
- otherwise: at the start of the operations, before any other operation on collection "from".

The example pipeline is `[{ $match: … }, …fieldStages, { $merge: { into: "to" } }]`. With the bypass, the call ends with `, { bypassDocumentValidation: true }`, and one sentence says why:

- replaced: the copy skips document validation because collection "to" still has its old validator; the later validator update on "to" checks the moved documents. If that check stops the apply, the moved documents are in collection "to": fix them there and run `db migrate` again;
- removed: the copy skips document validation because collection "to" still has its old validator, which the plan then removes.

When the moving models' copies differ, the text gives one `rawAggregate` per copy, each with a filter that selects only its models' documents, and one `deleteDocuments` for all of them.

## Docs

- **ADR 188.** One paragraph:
  - the order of operation kinds, and that it stands in for dependencies the plan does not model;
  - the rule that a write skips validation only when a later operation in the same plan replaces the validator it skips;
  - the move's four dependencies.

  The `rawAggregate` paragraph says that it takes `bypassDocumentValidation` like `rawUpdateMany`.
- **MongoDB Family subsystem doc**, where it lists the raw factories' options.
- **Upgrade note** (`upgrade-instructions/pending/mongo-stored-name-renames/`): one line that `rawAggregate` takes the option. The change is additive.

## Tests (red before the fix)

- **Driver**, against a real server, beside `skips validation when bypassDocumentValidation is set` in `mongo-driver.test.ts`: a `$merge` into a collection with a closed validator is rejected without the option and succeeds with it.
- **Wire and hash**: an aggregate without the option has the same wire fields and the same content hash as before.
- **AST, adapter, serializer**: the option round-trips, and an `ops.json` without it still reads.
- **Runner unit**: error 13 on a `RawAggregateCommand` with the option gives the refusal, beside the mocked case in `mongo-runner.test.ts`.
- **`documentMoveOrder` unit tests**: each `after` case; bypass for a replaced validator, none for an added one, the removal sentence for a removed one; no bypass for an `external` target; a source the plan renames.
- **Copy unit tests**: stages for one renamed field; one copy for models whose documents change alike, one each when they differ or converge on one stored name; the discriminator value of a model that becomes a variant; the fields the destination model does not store, removed.
- **Planner tests for the target's rewrites**: a rewrite of another model on the target that would reach the moved documents is refused in the plan the route describes, one test per rewrite kind (field rename, cast, conversion, fill, backfill, removal, enum value replacement, key rename inside an embedded model); a rewrite that cannot reach them leaves the move in the same plan; the moving model's own rewrite is planned after the move.
- **One planner text test per route.** Both use the same function, so one test per route is enough.
- **Runner, end to end**: the case QA found. The operations come from the planner's plan, with the move inserted where the text says, not from a hand-ordered list. The target exists with a validator that rejects the moving model, and the plan widens it and renames a field of the model that stays in the source. Run it to the end and read back both collections. Then stop at `deleteDocuments` and run it again, and stop at the target's validator update and run it again (throw from `callbacks.onOperationStart`). Read back both collections after each re-run.
- **Runner, end to end**: the rename case (`guests` renamed to `members`).
- **Runner, end to end**: a copy that removes a field the moving model no longer stores, into a target with a closed validator.

## Alternatives considered

- **Order the plan by collection.** This does not fix the move: the target's block would have to come before the source's block, and the planner cannot know that without modelling the dependency. It also changes the order of every MongoDB plan.
- **Tell the user to move the target's validator update before the source's rewrites.** This breaks when the target has rewrites of its own, which must come before its validator update.
- **The two-plan route in every case.** It always works, but it costs the user an extra contract edit and migration for every move.
- **The two-plan route when the plan rewrites the target.** An earlier version of this design used it. It counted only field renames, sent the user to two plans for a rename that could not reach the moved documents, and ended in a refusal when it could. The rewrite check already refuses every rewrite of another model that would reach them, once field renames count the destination's models as ADR 324 says, so the extra route protects nothing.
- **Always skip validation.** After a create, or when the policy leaves the target alone, nothing would check the moved documents.
- **Predict the plan from the contracts in the text code.** This was the first draft. It misses the control policy and drifts from the planner.
