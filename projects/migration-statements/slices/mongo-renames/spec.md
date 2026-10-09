# Slice 4a — Renames and deletes on MongoDB

**Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Branch:** `tml-3478-mongo-renames` · **Builds on:** slice 2 (merged) · **Project:** [`../../spec.md`](../../spec.md)

## In one example

A MongoDB user renames model `Profile` to `User`, renames field `name` to `fullName`, and removes field `nickname`.

```text
$ prisma migration plan --name tidy --rename Profile:User --rename User.name:User.fullName --delete User.nickname
✔ Planned 6 operation(s)
  Rename collection "profiles" to "users"                      widening
  Drop index users.name_1                                      widening
  Rename field "name" to "fullName" in collection "users"      widening
  Remove field "nickname" from collection "users"              destructive
  Create index users.fullName_1                                additive
  Update validator on users                                    widening
```

`db update` with the same flags does the same against the live database.

Without `--delete User.nickname`, both commands refuse, as they do on SQL:

```text
✖ [CLI.CONSENT_REQUIRED] 1 subject needs a statement, and the session is not interactive.
  why: Remove field "nickname" from collection "users" would lose the data of field "User.nickname".
→ Pass --rename 'User.nickname:<new name>'
→ Pass --delete User.nickname
```

## What changes for users

| Change in the schema | Today | After this slice |
| --- | --- | --- |
| Model renamed, `--rename` given | Refused, with steps to run by hand in `mongosh` | Collection renamed; documents, indexes and validator kept |
| Field renamed, `--rename` given | Refused, with steps to run by hand | Every document's field renamed; indexes moved to the new name |
| Field removed | Validator updated, nothing asked. Every document that still holds the field then fails each update | Asked about. `--delete` removes the field from every document; `--rename` keeps its values |
| Model removed | Asked about; `--delete` drops the collection | Same, and `--rename` is offered too |

## Decisions (settled with Will, 2026-10-09)

1. **Removing a field is data loss.** It is asked about, and `--delete` removes it from every document. Today it is silent, and MongoDB's validator then rejects every update to a document that still holds the field.
2. **Fields are named by their contract key, as on SQL.** MongoDB's contract keys fields by their stored name, so `id @map("_id")` is `User._id` in a statement. Naming the schema field instead would need MongoDB's contract to keep a field-to-stored-name map, as SQL's does. That is outside this project.
3. **Rewrites are classed by what they do to data, as on SQL.** A field rename is `widening`, like a column rename. A field removal is `destructive`, like a column drop. The planner writes a `data` operation only as a placeholder scaffold. So `db update` runs these rewrites, as it runs SQL renames. ADR 188 changes one sentence: today it says every MongoDB data transform is `data`.
4. **Without the old contract, a removed field is named `<collection>.<field>`,** for example `users.nickname`. SQL uses `<schema>.<table>.<column>`, or `<table>.<column>` on SQLite.
5. **A variant's field rename touches only that variant's documents.** The rewrite filters on the variant's discriminator value, so another variant in the same collection that stores a field with the same name keeps it. This differs from SQL single-table storage, where a rename renames the shared column for every row.

## How it works

**Collection rename**
- A new `renameCollection` operation.
- Before: the source exists and the target does not. After: the target exists.
- The rename happens before the diff, so MongoDB keeps the indexes and validator, and nothing is dropped and recreated.

**Field rename**
- One `updateMany` with `$rename`, written as `renameField(...)` in `migration.ts`.
- Touches only documents that hold the old field. For a variant's field, only documents with that variant's discriminator value.
- Before: no document already holds the new name, which `$rename` would overwrite. After: no document holds the old name, so a re-run skips it.

**Field removal**
- One `updateMany` with `$unset`, written as `unsetField(...)`.
- No unset when the whole collection is dropped.

**Order in a plan**

1. Collection renames
2. Collection creates
3. Index drops
4. Document rewrites (renames and removals)
5. Index creates
6. Validator changes
7. Option changes
8. Collection drops

- Rewrites run after index drops, so a unique index on the old field doesn't fail once documents lose the field.
- They run before index creates, so a unique index on the new field sees the moved values.
- Rewrites skip validation. The old validator requires the old field, and the new one may require a field the same plan adds.
- Plans with no statements and no removed fields come out exactly as today.

**Refused, with the reason named**
- Renaming `_id`.
- Renaming a collection onto one that already exists.
- Renaming a field that is stored on only one side.
- Any statement when the model's control policy is not `managed`, as on SQL.

**The temporary refusal goes.** MongoDB's `renameStatements: { refused: true, keepDataByHand }` setting, and all the code that reads it, is deleted.

## Why one pull request

It is one database learning two flags the SQL targets already support. It adds one new operation and one new rewrite. The collection rename touches six packages, but the change is the same in each and copies the existing collection operations.

## Scope

**In**
- Model rename, field rename (including a variant's field), field removal.
- Both commands.
- Deleting `renameStatements` and `keepDataByHand`. The unrelated `renameStatements()` helper in `statement-text.ts` stays.
- ADR amendments:
  - ADR 188: planner-written rewrites carry the class of their effect.
  - ADR 264: MongoDB now has a collection rename.
- Docs: Migration System § Statements, the error reference, the CLI README, `skills/prisma-8/references/migrations.md`.
- Upgrade fragments:
  - App: renames work; removing a field now asks.
  - Extension: the capability member is gone. It shipped in 8.0.0-rc.17.

**Out**
- Renaming a field inside a value object. It needs statement support that slice 3b builds. Moved to 4b.
- `--convert`, `--backfill`, and the validator problem when a field becomes required: slice 4b.
- Batching rewrites on large collections.

## Edge cases already known

| Case | Handling |
| --- | --- |
| A unique index on the old field fails the rewrite once two documents lose it (slice 1 QA, F3) | Index drops run before the rewrite |
| A unique index on the new field fails if created before the rewrite | Index creates run after it |
| The old validator requires the old field and forbids the new one | The rewrite skips validation |
| Two variants in one collection store a field with the same name | The rewrite filters on the discriminator value |
| MongoDB migrations are not transactional | The after-check lets a re-run skip a finished rewrite |
| Skipping validation needs a privilege on hosted clusters | The failure names the privilege |
| TML-2447 (open): variants that share a collection get their own collection and an incomplete validator | The first dispatch checks how variants are stored today, before building on it |

## Done when

- On collections with documents, through `migration plan` then `migrate` and through `db update`: a model rename, a field rename with a unique index, and a field removal with `--delete`. Afterwards:
  - the documents are under the new names;
  - the removed field is gone from every document;
  - every document accepts an update;
  - a further plan is empty;
  - `db verify --schema-only` is clean.
- `git grep -n "keepDataByHand"` finds nothing.

## Implementation notes

- `renameCollection` goes through the stack like the other collection operations: query AST command and visitor, wire command and lowering, driver, operation serializer, preview text, factory, call class.
- The raw update command gains `bypassDocumentValidation`, through its wire form and the driver.
- The runner and the operation serializer tell a rewrite from a DDL command by its shape (`run` against `execute`), not by `operationClass === 'data'`.
- Removed fields are reported as `field` subjects in `dataLoss`.
- Code to delete: the member in `control-migration-types.ts`; MongoDB's setting in `control-target.ts`; `keepDataByHand` and `keepTheData` in `mongo-planner.ts`; `keepDataByHandFor` and its parameter in `plan-questions.ts`; the reads in `db-run.ts` and `migration-plan.ts`; the paragraph in the Migration System doc.
- Grounding report (local, gitignored): `wip/grounding-4a.md`.
