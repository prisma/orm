# Slice spec — MongoDB carries out renames and deletes of models and fields

**Project:** [`projects/migration-statements/`](../../spec.md) · **Slice 4a** · **Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Branch:** `tml-3478-mongo-renames` · **Builds on:** slice 2 (merged).

## At a glance

A MongoDB user renames the `Profile` model to `User` (collection `profiles` to `users`), changes `name` to `fullName`, and removes the `nickname` field:

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

`migration.ts` carries `renameCollection(...)`, `renameField(...)` and `unsetField(...)` calls, and running it reproduces `ops.json`. `prisma db update` with the same statements does the same against the live database. Today MongoDB refuses every `--rename` and prints steps to run by hand in `mongosh`, and removing a field asks nothing, even though every document that still holds the field then fails each later update against the closed validator.

Without `--delete User.nickname`, both commands refuse, as they do on SQL:

```text
✖ [CLI.CONSENT_REQUIRED] 1 subject needs a statement, and the session is not interactive.
  why: Remove field "nickname" from collection "users" would lose the data of field "User.nickname".
→ Pass --rename 'User.nickname:<new name>'
→ Pass --delete User.nickname
```

## Chosen design

### Statements name fields by their contract key

A statement names a field as the contract and the generated client name it: the key in the model's `fields`. On SQL that key is the field name in the schema; on MongoDB the contract keys fields by the stored name (`id @map("_id")` is `User._id`), and the client uses the same name. The resolver already behaves this way, so nothing changes in it. On MongoDB a change to `@map` alone is a field rename in contract terms and is stated with `--rename`; a change to the schema field name alone changes nothing stored and needs no statement. This settles the deferred item "Which field name a MongoDB statement uses" and is recorded in the Migration System doc.

### Collection rename

A new DDL operation, `renameCollection`, added through the MongoDB stack the way the other collection operations are: query AST command and visitor, wire command and lowering, driver, operation serializer, preview text, factory and call class. Precheck: the source collection exists and the target does not. Postcheck: the target exists. Class `widening`. A model rename renames the collection in the working copy of the origin schema before the diff, so the indexes and validator that MongoDB keeps through a rename are not dropped and recreated.

### Field rename and field removal rewrite the documents

- A field rename plans `renameField(collection, from, to, { filter })`: one `updateMany` with `$rename`, run with validation bypassed. Filter: documents that hold the old field, and for a variant's field also the variant's discriminator value. Precheck: no matching document already holds the new field, since `$rename` would overwrite it. Postcheck: no matching document still holds the old field, so a re-run skips it. Class `widening`.
- Removing a field from a model is data loss, matching the spec's rule that dropping a field is destructive. The planner plans `unsetField(collection, field, { filter })`, an `updateMany` with `$unset`, class `destructive`, and reports a `field` subject. The question offers `rename` and `delete`, as on SQL. A field removed together with its collection gets no unset; the collection drop covers it.
- Order within a plan: collection renames, collection creates, index drops, document rewrites (renames and unsets), index creates, validator changes, option changes, collection drops. Rewrites come after index drops so a unique index on the old field does not fail once documents lose it, and before index creates so a unique index on the new field sees the moved values. Validation is bypassed for the rewrite because the origin validator requires the old field and the destination validator may require a field the same plan adds. Plans without statements and without field removals keep their current operations and order.
- The rewrite command gains a `bypassDocumentValidation` option through its wire form and the driver.

### Document rewrites run under `db update`

`db update` allows `additive`, `widening` and `destructive`, not `data`, so a rewrite classed `data` would be refused there. The rewrites above carry the class of what they do to data (`widening` for a rename, `destructive` for an unset), and the MongoDB runner and operation serializer tell a rewrite from a DDL command by its shape, not by `operationClass === 'data'`. `data` stays the class of transforms a user writes or a scaffold produces; `db update` keeps excluding it. Slice 3b's SQL JSON rewrites follow the same rule.

### What is refused

The MongoDB planner refuses, as a `statementRejected` conflict naming the reason: a rename of `_id`; a collection rename whose target exists in the working schema; a rename of a field stored on one side only; and any statement when the control policy is not `managed`, as SQL does. A document that already holds the new name fails at apply time by precheck, before anything is written.

### The temporary refusal goes

`TargetMigrationsCapability.renameStatements` and `keepDataByHand` are deleted: the member in `control-migration-types.ts`, MongoDB's setting in `control-target.ts`, `keepDataByHand` and `keepTheData` in `mongo-planner.ts`, `keepDataByHandFor` and its parameter in `plan-questions.ts`, its reads in `db-run.ts` and `migration-plan.ts`, and the Statements paragraph that describes it in the Migration System doc. The unrelated `renameStatements()` helper in `statement-text.ts` stays. The member shipped in 8.0.0-rc.17, so an extension upgrade fragment tells target authors to remove it.

## Coherence rationale

One reviewer can hold this: it is one family learning the two verbs the SQL targets already carry out, through one new DDL operation and one new rewrite shape, with the refusal member removed as the visible proof. The collection rename's six-package plumbing is mechanical and mirrors existing collection operations.

## Scope

**In:** model rename (collection rename); top-level field rename, including a variant's field; field removal as data loss with `$unset` under `--delete`; both commands; the `bypassDocumentValidation` option; runner and serializer telling rewrites apart by shape; deleting `renameStatements`; docs (Migration System § Statements, error reference, CLI README, `skills/prisma-8/references/migrations.md`); an app upgrade fragment (MongoDB renames work; removing a field now asks) and an extension upgrade fragment (the capability member is gone).

**Deliberately out:**
- Value object field renames on MongoDB. They need the framework's value object statement surface (statement entity, subject kind, grammar, resolver), which slice 3b builds for SQL JSON rewrites, and a recursive update pipeline for lists, dictionaries and unions. Moved to slice 4b.
- `--convert` and `--backfill` on MongoDB, and the required-field validator gap: slice 4b.
- Batching large rewrites. One `updateMany` per field, as today's hand-written transforms do.

## Pre-investigated edge cases

| Case | Handling |
| --- | --- |
| Slice 1 manual QA (F3): a unique index on the old field fails the rewrite once two documents lose it; one on the new field fails if created first | Order above: index drops, rewrite, index creates |
| The origin validator requires the old field and forbids the new one | Rewrite runs with validation bypassed |
| Two variants in one collection store a field with the same name | Rewrite filters on the discriminator value |
| The runner is not transactional | Postcheck makes a re-run skip a finished rewrite |
| `bypassDocumentValidation` needs a privilege on hosted clusters | Runner failure names the privilege |

## Slice-specific done conditions

- The project DoD's MongoDB journey without the value object part: a model rename and a field rename (with a unique index on the field) and a field removal under `--delete`, through `migration plan` then `migrate` and through `db update`, on collections with documents. Afterwards the documents are under the new names, the removed field is gone from every document, every document accepts an update, a further plan is empty, and `db verify --schema-only` is clean.
- `git grep -n "keepDataByHand\|TargetMigrationsCapability\['renameStatements'\]"` finds nothing.

## Open questions

None.

## References

- Grounding report for this slice (local, gitignored): `wip/grounding-4a.md`.
- [`../../deferred.md`](../../deferred.md) — "Which field name a MongoDB statement uses".
- Slice 1 manual QA, F3: [`../../manual-qa-reports/2026-10-07-qa-opus.md`](../../manual-qa-reports/2026-10-07-qa-opus.md).
