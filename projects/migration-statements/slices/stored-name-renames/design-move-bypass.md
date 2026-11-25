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
- **Runner** (`mongo-runner.ts`), a copy its target's validator rejects (error 121): the failure names the target collection, with its database when the `$merge` names one, and calls an `$out` stage what it is. When MongoDB's error names the rejected document (`errInfo.failingDocumentId`), the failure gives its `_id` and a `find` on the copy's source. The runner looks at the operations after the copy, following renames of the target: when one replaces the target's validator, it says to add `bypassDocumentValidation: true`, so that update checks the moved documents; when one removes it, it says to add the option, since the validator the copy would have to fit is then removed; when none changes it, it says to fix the document in its source or the pipeline. For a target in another database it cannot tell, and gives both. It says to run the file with `node` only with the advice that changes `migration.ts`: fixing a document in its source needs only a re-run. Any other error code gets the data-transform text.
- **Runner** (`mongo-runner.ts`), every stop that says what a re-run does (the validator check, a field or key rename collision, a collection rename or a create onto an existing collection, a duplicate key, a unique index that cannot be built, a removed value still held, documents an update did not change, a user who may not skip document validation, a failed update of a dataTransform): when an operation with no check, such as the copy, comes before it (or, for a failed dataTransform update, is that dataTransform), the `why` says that such an operation runs again on a re-run, not that every operation that ran is skipped. One function, `rerunText`, writes that sentence for all of them.

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

The route leaves out every statement the shared-collection rule refuses in the plan, from every collection, and their field rename statements. Every one of them must be left out before any plan is made, so that is the plan the user ends up making: leaving out the statements of one collection would leave the others in, refused again for the same reason, and the first collection's move would never be printed again. The text names each statement as the CLI takes it (a field statement names its model as the destination contract does, `--rename Member.name:Member.fullName`), and gives one move for each source and destination. The first of those statements prints the route; the refusals of the others name it by that statement, so the user reads the route once. A field statement whose model rename statement this rule refuses says so and points straight at the refusal that prints the route, instead of asking for the model statement the user already gave. A field statement given without its model statement does not ask for that statement when the rule would refuse it: it says so, and says to leave the field statement out too. When every model leaves the source, the plan without the statements drops the source and asks about the moving models; the route says to answer with the `--delete` it offers, since the copies run before the drop and keep the documents. When a group's documents cannot be moved by a planned migration (a merge, or a variant that leaves its base collection), the route is the hand-written migration for all of them. Both routes say what the plan without the statements does to each group, from the same text: a root model that leaves a collection other models keep is removed with no question, and its documents stay where those models read them; the models of a merge, of a variant that leaves, and of a source every model leaves are asked about, since that plan drops their documents. With several groups of one kind, one paragraph says it for all of them. The source collection can be renamed in the plan the route describes: once the statements are left out, the moving model is removed, and the models left in the source can all move to one new collection. The move then reads the source under its new name, after its rename. A planner test shows it. The route's facts come from the plan the route tells the user to make: the planner's own `plan()` run on the same contracts and options without those statements. The placement, bypass, copies and dropped fields are read from that plan's collection renames and schema. When that plan is refused, by a rename or by a cast, fill, removal or any other later check, the route gives no move and says so, since its facts would describe a plan the user cannot make. It quotes those refusals, and the plan lists them after its own, so the user sees what to change first in the same run. That plan is made once per plan, lazily, and both the route text and the list of its refusals read the same result, so neither depends on the other having run. It has no statement the shared-collection rule refuses, so it builds no route of its own: there is one level of re-planning, and its cost does not grow with the number of refused statements.

**Variant route.** The route's first plan keeps the variant as it is and moves the documents. `documentMoveOrder` is computed for that first plan: the destination contract with the variant kept. If that contract is not available where the route is built, the text tells the user to write that first contract as this one with the variant kept, so its plan changes collection "to" as the steps expect, and a test shows it (D04).

### 4. The text

`documentMoveSteps` reads only `documentMoveOrder`'s result.

The placement:

- after `createCollection`: right after the creation of collection "to", and before the plan's own operations on collection "from";
- after `renameCollection`: right after the rename of collection "from-of-rename" to "to" (and of the source, when the plan renames it), and before the plan's own operations on the source;
- otherwise: at the start of the operations, before the plan's own operations on collection "from".

A `dataTransform`'s `run` returns one query plan, so each copy is the `run` of its own `dataTransform`, and the `deleteDocuments` after them is an operation of its own. The text is short paragraphs: for each move, the placement with one `dataTransform` for each copy, then the delete after them, then the filter, the fields the copy drops and their values, and why the copy skips validation; then, once, how to apply (several `dataTransform`s, counted by copies, go in the one `migration.ts` and one apply) and what to do when the apply stops. Each call is printed on lines of its own after the sentence that introduces it, one stage to a line.

The example pipeline is `[{ $match: … }, …fieldStages, { $merge: { into: "to" } }]`, each stage printed with `jsonToTsSource`, the printer of the `migration.ts` the user pastes it into, with its layout line breaks joined so a long stage stays on one line; `jsonToTsSource` escapes the line breaks inside strings, so only layout is joined. A route with several moves starts each move's steps with the models that move. With the bypass, the call ends with `, { bypassDocumentValidation: true }`, and one sentence says why:

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
- **Planner, the shared-collection route**: refused statements out of two collections give one route with both moves, and the plan without them is made; eight refused statements plan in well under a second; every model leaving the source gives the `--delete` answer; a stage over 80 characters prints on one line and evaluates to the same pipeline; a field statement is named as the CLI takes it and points at the refusal that prints the route; the refusals of the plan without the statements are listed.
- **Runner, end to end**: the route where every model leaves the source, followed to the end; a copy into a new collection whose validator rejects a document names its `_id`; the validator check's stop after a copy says the copy runs again.
- **Planner, groups of different kinds and several copies**: a model left behind beside a merge, and beside a variant that leaves, is said to be removed with no question while the other is asked about, matching what the plan without the statements asks; a hand-written route lists that plan's refusals; a move with two copies gives each its own `dataTransform` and counts three with a second move; groups in two source collections share one short paragraph.
- **Runner, end to end**: a move with two copies and a second move, written as the route gives them, keeps every document.
- **Runner, unit**: a field rename collision and a collection rename onto an existing collection, after a copy, say the copy runs again.
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
