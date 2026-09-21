---
changes:
  - id: single-row-mutations-require-unique-filter
    summary: SQL ORM delete() and update() are gated on CollectionTypeState.hasUniqueFilter; use a unique shorthand where() or the bulk terminals.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".delete()"
        - ".update("
        - "hasUniqueFilter"
      anyMatch: true
---

# SQL ORM `delete()` / `update()` require `hasUniqueFilter`

The SQL ORM `Collection`'s single-row `delete()` and `update(data)` terminals are now gated on `CollectionTypeState['hasUniqueFilter']` instead of `hasWhere`. Only a shorthand `where({ ... })` that binds every column of the primary key, or of one unique constraint, to a non-null value sets that flag. Callback filters, raw `WhereArg` expressions, and partial keys set only `hasWhere`.

Run the typecheck and fix each rejected call:

- Where extension code calls `delete()` / `update(...)` after a non-unique or callback filter, use `deleteAll()` / `updateAll(...)` (awaited) or `deleteAndCount()` / `updateAndCount(...)` if it means every matching row. If it means one row, rewrite the filter as a shorthand object on the key.
- Where extension code or its type tests spell out a collection state literal (`{ hasOrderBy; hasWhere; hasUniqueFilter; variantName; nsId }`) for a receiver that calls `delete()` / `update(...)`, set `hasUniqueFilter: true`.

Do not cast around the error. A cast restores the old behaviour of changing whichever matching row the database returns first.
