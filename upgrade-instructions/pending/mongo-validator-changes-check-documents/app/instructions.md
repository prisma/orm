---
changes:
  - id: mongo-validator-change-checks-documents
    summary: |
      A MongoDB validator change that `migration plan` or `db update` writes now checks the documents first, and the apply stops while a document does not fit the new validator. Existing `migration.ts` files are unchanged.
  - id: mongo-type-change-is-asked
    summary: |
      A MongoDB field type change that can lose values is now a question, answered with `--convert` or `--delete`, as on SQL. A cast that keeps every value, such as `Int` to `Int64`, is planned with nothing asked.
  - id: mongo-new-required-field-gets-temporary-value
    summary: |
      A new required MongoDB field is now filled with a temporary value in the documents that lack it, as on SQL, unless `--backfill` names it.
  - id: planner-warnings-json-field
    summary: |
      In `--json` output, `db update` and `db init` list the planner's warnings under `plannerWarnings` instead of `warnings`, as `migration plan` does.
---

# MongoDB plans rewrite the documents a schema change touches

## `mongo-validator-change-checks-documents`

Every validator change a new plan writes is `collMod(..., { ..., checkDocuments: true })`: as its own precheck, after the plan's rewrites, it checks that every document fits the new validator. When `db migrate` or `db update` stops with `MIGRATION.PRECHECK_FAILED` because documents do not fit:

Operations of the migration that ran before the validator change stay applied; a re-run skips them.

1. Find them with the `mongosh` query the error prints, and change them so they fit the new validator. The old validator is still in place and may reject a document changed to the new shape, so an update that fixes one can skip document validation: write a `dataTransform` in `migration.ts`, or in `mongosh` run an update command with `bypassDocumentValidation: true`, such as `db.runCommand({ update: "users", updates: [{ q: { _id: … }, u: { $set: { … } } }], bypassDocumentValidation: true })`. Run the command again. For a field the change makes required, `migration plan --backfill Model.field` writes a step to fill it instead.
2. Or, under `db migrate`, apply the validator over them as before: set `checkDocuments` to `false` on that `collMod` in the migration's `migration.ts`, run the file with `node`, and run `db migrate` again. Those documents then fail their next update until they fit. `db update` writes no `migration.ts`, so there the documents must be fixed first.

A database adopted from Prisma 6 has no validator, so its first plan adds one and checks every collection.

## `mongo-type-change-is-asked`

Where a plan now asks about a field, answer with `--delete Model.field`, which casts the values with `$convert` and fails on a value it cannot cast (a change such as `String` to `Boolean`, where `$convert` would turn `"false"` into `true`, has no cast and offers `--convert` only), or plan it with `migration plan --convert Model.field` and write the update in the `placeholder('Model.field:update')` slot of the data transform it writes.

## `mongo-new-required-field-gets-temporary-value`

To write your own value instead of the temporary one, plan the change with `migration plan --backfill Model.field` and write the update in the `placeholder('Model.field:update')` slot of the data transform it writes. A new required field under a unique index gets no temporary value, since every document would get the same one: on a collection with documents, the validator change's document check stops the apply until they have values, so plan it with `--backfill`.

## `planner-warnings-json-field`

A script that reads the planner's warnings from the `--json` result of `db update` or `db init` reads `plannerWarnings` instead of `warnings`. Each entry is unchanged: `kind`, `summary` and `why`. `migration plan --json` lists them under `plannerWarnings` too, and its `warnings` keeps its own messages, such as a default origin that forks the migration graph.
