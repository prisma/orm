---
changes:
  - id: include-expr-join-column-lists
    summary: |
      `IncludeExpr.localColumn` and `IncludeExpr.targetColumn` are now `localColumns` and
      `targetColumns`: ordered string arrays paired by index, with one entry per column of the
      relation's key.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.(?:localColumn|targetColumn)\b'
---

## `include-expr-join-column-lists`

An ORM include now joins the related rows on every column of the relation's key, not only the first. So `IncludeExpr` (exported from `@prisma/orm-family-sql/orm-client`, and the element type of `Collection.state.includes`) carries the key as two lists instead of two strings:

- `localColumn: string` is now `localColumns: readonly string[]`, the key columns in the parent table.
- `targetColumn: string` is now `targetColumns: readonly string[]`, the matching columns in the related table.

Both lists have the same length, and `localColumns[i]` joins to `targetColumns[i]`. A single-column relation has one entry in each list.

Update code that reads these fields to use the whole lists and pair them by index. Code that builds an `IncludeExpr` by hand passes arrays, for example `{ localColumns: ['id'], targetColumns: ['user_id'] }` instead of `{ localColumn: 'id', targetColumn: 'user_id' }`. Do not keep only the first entry of each list: for a composite key that matches every related row that shares the first key column, which is the bug this change fixes.
