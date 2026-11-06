# Slice 4b — `--convert`, `--backfill`, value objects, enum values and variants on MongoDB

**Linear:** [TML-3538](https://linear.app/prisma-company/issue/TML-3538) · **Builds on:** slices 3a, 3b and 4a (merged) · **Project:** [`../../spec.md`](../../spec.md)

## In one example

A MongoDB schema changes `User.age` from `String` to `Int`, adds a required `User.plan`, and renames `Address.street` to `Address.line1` inside a value object that `User.addresses` holds as a list.

```text
$ prisma migration plan --name tidy --convert User.age --rename Address.street:Address.line1
⚠ migration.ts has a placeholder: replace it with the conversion, then run the file to re-emit.
```

`migration.ts` has one slot to fill. The planner writes the filter and the check, because it knows which documents still need converting. Only the update is left to the user. (The shape is fixed here; the factory names are settled in PR 1.)

```ts
dataTransform('User.age', {
  check: { source: () => rawAggregate('users', [{ $match: AGE_NOT_INT }, { $limit: 1 }]) },
  run: () => rawUpdateMany('users', AGE_NOT_INT, placeholder('User.age:update'), { bypassDocumentValidation: true }),
}),
renameStoredKey({ collection: 'users', field: 'addresses', path: '$[*].street', to: 'line1' }),
fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
setValidation({ collection: 'users', ..., checkDocuments: true }),
```

Without `--convert User.age`, both commands refuse and print `--convert User.age` and `--delete User.age`, as they do on SQL.

## What changes for users

Today every row of this table is planned as a validator change and nothing else. Documents keep their old shape, and the strict validator then rejects every later update to them.

| Change in the schema | After this slice | Proven by |
| --- | --- | --- |
| Field type change that MongoDB's cast keeps every value of (`Int` to `Float`, `Int` to `Int64`) | The values are cast with `$convert`, nothing asked, as SQL plans `int4` to `int8` | `convert-backfill.mongo.e2e.test.ts` C4 |
| Field type change to `Bson`, or to `Json` from a type `Json` holds (string, number, boolean, list, object) | Validator only; the new validator accepts every old value | C5 |
| Any other field type change | Asked. `--convert User.age` writes a data transform with a placeholder (`migration plan` only). `--delete User.age` casts the values with `$convert`; a value MongoDB cannot cast fails the apply and the advice points to `--convert`. Both commands, optional and required fields | C1 to C3 |
| Required field added | Filled with a temporary value where documents lack it or hold `null`, nothing asked. A type with no temporary value is left to the document check (next row). `--backfill User.plan` writes a slot to fill instead | B1, B2 |
| Optional field made required, or a required field with no temporary value | The document check fails the apply while documents lack the field, naming the count and one `_id`. `--backfill` writes a slot to fill instead | B3, B4 |
| Field inside a value object or an embedded model renamed or removed | Asked. `--rename Address.street:Address.line1` rewrites the key wherever an `Address` is stored, through nesting, lists and embedded models. `--delete Address.street` removes it | `value-object-statements.mongo.e2e.test.ts` O1 to O5 |
| Required field added inside a value object or an embedded model | As for a top-level field: a temporary value, or `--backfill Address.zip` | `value-object-backfill.mongo.e2e.test.ts` |
| Enum value renamed (stored value changes) | Asked. `--rename Status.A:Status.B` updates every field the enum types: scalar, list, inside value objects and embedded models. Values that trade places go through a temporary value, as on SQL | `enum-value-statements.mongo.e2e.test.ts` E1, E2 |
| Enum value removed | Asked, with `--rename` offered first. `--delete Status.A` unsets it where the field is optional and pulls it from lists. Where a required field holds it, the apply stops, counts the documents and says how to keep them | E3, E4 |
| Variant's discriminator value changed | Asked. `--convert Bug` updates the documents to the new value. A `--rename Bug:Defect` that also changes the value does the same; today it is refused | `variant-statements.mongo.e2e.test.ts` V1, V2 |
| Variant removed | Asked as a model. `--delete Bug` deletes the documents with its discriminator value. Today they stay, matched by no model | V3, V4 |
| A value object field changes type, a field moves to another value object, or a field gains an enum | Not a statement, as on SQL. The plan warns, naming the field and saying to add a `dataTransform` before the validator change. The document check fails the apply until the documents fit | W1 |

## Decisions to check

1. **A validator change checks the documents first** (agreed with Will, 2026-11-06). `setValidation` takes a new option, `checkDocuments`. When it is `true`, the operation gets a precheck: an aggregate that matches the documents the new validator rejects (`$nor: [{ $jsonSchema }]`) with `$limit: 1`. When one matches, the apply fails with a typed error: the count, one `_id`, the `mongosh` query that finds the rest, and the fields this change requires or retypes, named as what the change touches, not as the cause. The option is optional and leaving it out keeps today's behaviour, so existing `migration.ts` files re-emit the same `ops.json`. The planner always writes `checkDocuments: true` for a validator add or update. A user adopting a database whose documents do not fit sets it to `false` in `migration.ts`; `db update` writes no file, so there the check always applies. This is the MongoDB form of the Postgres `SET NOT NULL` failure (TML-3517) and of ADR 309's derived checks. ADR 188 gets a paragraph on it.

   Manual QA showed that a check only at the end can leave a failed apply with documents the current validator rejects, for example a fill that ran before the check stopped on another field. So the planner also writes an early check, `checkDocuments({ collection, validator, rewrittenFields, renamedFields })`, before a collection's first rewrite or index create. It tests the new validator with every field the plan rewrites relaxed, so it stops, before anything changes, on problems no operation of the plan fixes. Applying the validator over documents that do not fit then takes two edits in `migration.ts`: remove the early check call and set `checkDocuments: false` on the validator change. **Costs:**
   - One read of the collection per changed validator, stopping at the first document that does not fit.
   - A database imported from Prisma 6 or 7 has no validator, and Prisma 8's is closed. Today the first plan adds it and the documents fail later. After this slice that first apply fails until every collection fits. The upgrade fragment and the Prisma 6 guide say what to do.
   - The operations before it (index drops, rewrites, index creates) have already run when it fails. A re-run skips them through their own postchecks, so the message says what ran, not "nothing changed".
   - It is not atomic with the validator change: a document written between the two is not checked. A known limit.
2. **A type change follows Will's 3a ruling: `--delete` runs the database's cast.** MongoDB's cast is `$convert`, in an update pipeline. `--delete` sets the field to `$convert` of itself, with no `onError`, filtered on documents whose value the new validator does not accept. A value MongoDB cannot cast fails the update, and the advice points to `--convert`. It works for required fields and on `db update`. The statement is reported as "accept lossy type change of field". Manual QA showed that some casts `$convert` accepts change what values mean (every non-empty string becomes `true`). So `--delete` casts only the pairs on an explicit list in the target (`bson-convert.ts`): numbers between numeric types, values to strings, numeric strings to numbers, ISO strings to dates, hex strings to ObjectIds, numbers to booleans. Any other pair offers `--convert` only. A short list of casts that keep every value (`int` to `long`, `double` or `decimal`; `long` to `decimal`) is planned as the same rewrite with nothing asked, classed `widening`. Where `$convert` has no conversion between the two types, only `--convert` is offered.
3. **Type changes are found from the contracts when the origin contract is known**, per model, per variant and per embedded model, from each codec's BSON types, as 4a finds removals. Without it, from the two validators: `null` removed from both sets, an empty set read as any value, list element types compared through `items`. A field gaining an enum, or a value object field changing type, is not a type change by these rules; row W1 covers it.
4. **The planner writes the check and the filter of each data transform it scaffolds.** The check is an aggregate with `$match` and `$limit: 1`, since the runner accepts only aggregate checks. The run is a raw `updateMany` with the planner's filter and `bypassDocumentValidation`, because the old validator is strict and would reject the user's update. Only the update is a placeholder. Its call returns an unfilled placeholder operation, as SQL's does, so the other operations of the plan still list. A hand-written `run` must skip validation too; the docs say so, and the missing-privilege failure from 4a covers it.
5. **Temporary values come from the codec, as typed expressions.** `ops.json` is plain JSON, and a plain `0` is stored as an `int`, which a `long` validator rejects. So each value is a pipeline expression that keeps its type. A fill writes where the field is missing or `null`. It is `widening`, so `db update` runs it, and it is reported in `temporaryValues`, as on SQL.

   | Codec | BSON type | Temporary value |
   | --- | --- | --- |
   | `mongo/string` | `string` | `{ $literal: '' }` |
   | `mongo/int32` | `int` | `0` |
   | `mongo/int64` | `long` | `{ $toLong: 0 }` |
   | `mongo/double` | `double` | `{ $toDouble: 0 }` |
   | `mongo/decimal128` | `decimal` | `{ $toDecimal: '0' }` |
   | `mongo/bool` | `bool` | `false` |
   | list of any type | `array` | `[]` |
   | date, ObjectId, binary, `Json`, `Bson`, vector, enum, value object, embedded model | — | none; the document check applies |

   PR 1 confirms each codec's id against `packages/3-targets/mongo/1-target/src/core/data-types.ts`. A field under a unique index gets no temporary value, as SQL refuses unique columns.
6. **Rewrites inside a field's value use update pipelines,** built from one path walk that also builds every filter, precheck and postcheck:
   - The walk goes over value object fields, embed relations (a list step for one-to-many) and variant branches. SQL has no embedded models; MongoDB's are covered the same way as value objects.
   - Every step guards on `$type`: a missing or `null` value, or a non-object where an object is expected, is left as it is. `$map` runs only over arrays, so a missing list is not turned into `null`.
   - List steps in filters use `$expr` with `$map` and `$anyElementTrue`, not dot paths: a dot path matches across different elements, and `{ 'a.b': null }` also matches a missing `a`.
   - Every constant is wrapped in `$literal`, so a value starting with `$` is not read as a field path.
   - Pipelines are used rather than `arrayFilters` because `$rename` takes no positional operators and one pipeline expresses a conditional rename, fill or removal per element at any depth.
   - Refused, naming the field: a path that enters a recursive group (a value object or embedded model reachable from itself), since the validator checks nothing below it (`recursiveGroupsOf`); a key containing `.` or `$`, as 4a refuses such field names; dictionaries and unions, which no MongoDB authoring surface produces.
7. **Every new rewrite gets 4a's refusals and filters.** A rewrite in a time-series collection is refused. A rewrite of one root model's documents in a collection another root model shares, with no discriminator to tell them apart, is refused. A variant's rewrite filters on its discriminator value. The selected variant is carried as a typed value, which pays the `deferred.md` debt on `otherModelsReached`.
8. **Enum values** (agreed with Will, 2026-11-06, although the project plan listed 4b without them): `string`, `int` and `bool` values are matched by equality; `double` values are written with `$toDouble`; enums of `object` or `array` values are refused in this slice, since equality on them depends on key order or matches containing lists. Values that trade places go through a temporary value, as SQL does (`enum-value-planning.ts`). Without an origin contract nothing is asked or rewritten, and the document check fails the apply while documents hold a removed value.
9. **Operation names follow one rule.** Root fields keep 4a's `renameField` and `unsetField`. Keys inside a field's value use SQL's names and shape, with the root field in the column's place: `renameStoredKey`, `removeStoredKey`, `fillStoredKey`, `replaceStoredValue`, `removeStoredValue`, taking `{ collection, field, path, … }`, and `path` in SQL's JSONPath grammar (`$[*].street`). Two new operations have no SQL counterpart (named by Will, 2026-11-06): `fillField` writes a temporary value into a root field where it is missing or `null`, beside `renameField` and `unsetField`; `deleteDocuments({ collection, filter })` deletes documents, as SQL's `deleteRows` deletes rows, and is what `--delete Bug` plans for a removed variant.
10. **No framework change.** The statement kinds (`convert`, `backfill`, variant `convert`), the subjects (`valueObjectField`, `enumValue`), the `typeChange` loss and `temporaryValues` already exist, and SQL uses them. The variant lookup stays in the MongoDB target. If the build finds a framework change is needed, it stops and tells you.

## Order inside the rewrite step

4a's plan order stays: renames, creates, index drops, rewrites, index creates, validator changes, option changes, drops. Inside the rewrite step:

1. Field and key renames
2. Variant document deletes, so a freed discriminator value can be taken
3. Discriminator value and enum value replacements
4. Casts and scaffolded conversions
5. Fills and scaffolded backfills
6. Removals of keys and enum values

Then, per collection, the validator change with its document check. All rewrites skip document validation, as 4a's do. Classes: renames, casts that keep every value, replacements and fills are `widening`; removals, document deletes and `--delete` casts are `destructive`; scaffolds are `data`. So `db update` runs all but the scaffolds, which it refuses with `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`. Every operation is something a user could write in `migration.ts`, and re-running the file reproduces `ops.json`.

## Pull requests

| PR | Contents |
| --- | --- |
| 1 | Top-level fields: `checkDocuments` on `setValidation` (decision 1), type changes with casts, `--convert` and `--delete`, `--backfill`, temporary values, the scaffolded data transform call, and the W1 warning |
| 2 | The path walk, then value object and embedded model keys (rename, delete, fill, backfill), enum values, variants. Removes MongoDB's refusals of `enumValue`, `valueObjectField` and discriminator value changes. If the diff grows past one review, variants move to a third pull request; they need only PR 1 |

PR 1 changes what every MongoDB validator change does, so it is reviewed alone. Between the two, a value object or enum change that only PR 2 can answer fails at the document check; the W1 warning names the hand-written route.

## Scope

**In:** everything above; fixing 4a's `collectionOf`, which uses a model's name as its collection when it has none, so a statement on an embedded model may target a collection that does not exist; the error reference, Migration System § Statements and its MongoDB part, the CLI README, `skills/prisma-8/references/migrations.md`; ADR 188; an app upgrade fragment for decision 1 and the new questions, and a note in the Prisma 6 upgrade guide; correcting the 3b spec's claim that slice 4p refused self-containing value objects (the validator accepts them and checks nothing below the point where they refer to themselves).

**Out:**
- Namespaces on MongoDB. The refusal stays.
- A value object rename as a whole, `--convert` of a value object field, and a field gaining an enum: not statements on any family (`deferred.md`).
- Enums whose values are objects or arrays (decision 8).
- Batching rewrites on large collections.
- Sharing the variant lookup with SQL.

## Edge cases already known

| Case | Handling |
| --- | --- |
| A rename's new key already in the same element | The precheck, built per element, refuses it with its own failure message |
| A partial apply, then a re-run | Each rewrite's postcheck lets the re-run skip it; the document check runs again |
| An empty collection | Every rewrite matches nothing and passes; the document check passes |
| A document the old validator already rejects (drift) | The document check fails on it; the message names the changed fields only as what the change touches |
| `Int` to `Int64` | A cast that keeps every value, nothing asked (decision 2) |
| No origin contract (`db update` without a snapshot) | Type changes come from the validators and are named `<collection>.<field>`, with the type change wording, not "would lose the data"; every convert and rename fails, as on SQL; `--delete` works |

## Done when

- Every journey named above passes through `migration plan` then `migrate`, and through `db update` where the statement is allowed there, on collections with documents. Afterwards every document accepts an update, a further plan is empty, and `db verify --schema-only` is clean.
- The tests cover: numeric temporary values for `Int`, `Int64`, `Float` and `Boolean`; a nullable value object holding `null`, a missing one, a list with a `null` element, an empty list, an element with both keys; a key inside an embedded model and inside a list of embedded models; a shared collection refusal; a re-run after a partial apply; an empty collection.
- Re-running every `migration.ts` the tests write reproduces its `ops.json`.
- `git grep -n "MongoDB does not rename value object fields\|MongoDB does not rename enum values\|MongoDB does not apply"` finds nothing.

## Implementation notes

- Planner: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-planner.ts` refuses every statement whose kind is not `rename` (514-520) and plans validator changes in `planValidatorDiffCall` (627-665). `mongo-statement-planning.ts` refuses `enumValue` and `valueObjectField` (365-394) and a discriminator value change (`discriminatorValueChange`, 478).
- A collection validator change is a DDL operation whose checks can only list collections and indexes today (`packages/2-mongo-family/4-query/query-ast/src/migration-operation-types.ts` 10-17), evaluated through the runner's inspection executor (`mongo-runner.ts` 604). Decision 1 extends that check type, in the MongoDB family, to take a document aggregate. Its failure is a typed runner failure, like `renameOverwriteRefusal`, since a failed precheck reports only "failed during precheck" today. The runner skips a DDL operation whose postcheck passes (`mongo-runner.ts` 302-309), so a re-run after the validator was set does not check again; that is intended.
- `dataTransform` is in `migration-factories.ts` (69-114) and calls `run()` at once; its call class must return an unfilled placeholder operation instead of throwing for the whole plan.
- The runner accepts only `aggregate` and `rawAggregate` checks (`mongo-runner.ts` 54, 559-572). `noDocumentHolds` (`migration-factories.ts` 166-183) is the pattern for a check.
- Validator derivation: `packages/2-mongo-family/1-foundation/mongo-contract/src/derive-json-schema.ts` and `recursive-groups.ts`.
- SQL pieces to copy the shape of, not import: `value-object-field-planning.ts`, `value-object-field-fills.ts`, `enum-value-planning.ts`, `variant-planning.ts` in `packages/2-sql-family/9-family/src/core/migrations/`; `operations/stored-keys.ts` in the Postgres target.
- `deferred.md` line 133 cites an old path for `mongo-statement-planning.ts`; fix it on the way.
- Reviews of this spec (gitignored): `reviews/architect.md`, `reviews/principal-engineer.md`.
- `--backfill` is allowed on a field with a default, unlike SQL. A MongoDB default is an execution default: the ORM applies it when it creates a document, and nothing writes it into existing documents, so they still need the backfill (decided during PR 1, dispatch 3).
