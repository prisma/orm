---
changes:
  - id: mongo-nested-removals-are-asked
    summary: |
      A MongoDB plan now asks about a field a value object or an embedded model loses, a stored value an enum loses, and a variant the contract removes or whose discriminator value changes, where it planned only a validator change before. `--delete` removes the key or the value from the documents, or deletes the variant's documents.
  - id: mongo-nested-statements-are-planned
    summary: |
      `--rename` of a value object field, of an embedded model's field, of an enum value, and of a variant whose discriminator value changes, `--convert` of a variant, and `--backfill` of a field inside a value object or an embedded model now plan rewrites of the documents on MongoDB instead of failing with `MIGRATION.PLANNING_FAILED`.
  - id: mongo-nested-required-field-gets-temporary-value
    summary: |
      A required field new inside a MongoDB value object or embedded model is now filled with a temporary value in the objects that lack it, as at the top level, unless `--backfill` names it.
---

# MongoDB plans rewrite value objects, embedded models, enum values and variants

## `mongo-nested-removals-are-asked`

Where `migration plan` or `db update` now stops with a question, or with `CLI.CONSENT_REQUIRED` when nobody can answer, give the statement that says what the change means:

- A field a value object or an embedded model loses: `--rename Address.street:Address.line1` if it was renamed, or `--delete Address.street` to remove the key from every object (`removeStoredKey`).
- A stored value an enum loses: `--rename Status.ARCHIVED:Status.<new name>` to keep the documents under another member, or `--delete Status.ARCHIVED` to unset it in optional fields and take it out of lists (`removeStoredValue`). Where a required field holds it, the apply stops with `MIGRATION.PRECHECK_FAILED`, counts the documents and gives the edit that keeps them.
- A variant whose discriminator value changes, or that the contract removes: `--convert Bug` to rewrite the value, or `--delete Bug` to delete its documents (`deleteDocuments`).

A script that runs these commands with `--yes` and no statements now fails with `CLI.CONSENT_REQUIRED`; add the statements it lists.

## `mongo-nested-statements-are-planned`

A script or test that expects these statements to fail with `MIGRATION.PLANNING_FAILED` on MongoDB now gets a plan. A plan in which one operation writes a field, key or value that another operation of the same plan reads is still refused, with advice to make the change in two migrations: field, key and enum value renames that trade names or values or form a chain, a new required field under the name a rename moves away, and variant changes where one variant takes a discriminator value another frees. MongoDB applies operations one at a time, so the later operation would act on what the earlier one wrote, or a re-run after a later operation stops would rewrite those documents twice. A statement on a field of a variant of an embedded model is refused, since the plan cannot rewrite only that variant's elements.

If you rewrote such documents by hand in `mongosh` or in a `dataTransform` because the statement was refused, nothing changes for migrations you already applied.

## `mongo-nested-required-field-gets-temporary-value`

To write your own value instead, plan the change with `migration plan --backfill Address.zip` and write an aggregation expression in the `placeholder('Address.zip:value')` slot of each `fillStoredKey` it writes, such as `{ $literal: 'unknown' }`. A field whose type has no temporary value, such as a date, gets none, and the validator change's document check stops the apply while objects lack it; use `--backfill` for it.
