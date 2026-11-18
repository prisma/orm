---
changes:
  - id: sql-builder-insert-required-columns
    summary: |
      A SQL builder insert, `db.sql.<namespace>.<table>.insert(rows)`, must now include every column that is not nullable and has no default. Leaving one out is a type error that names the column, and so is a value typed `T | undefined` for such a column. Add a real value, narrowed to `T`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.insert\('
---

# Inserts must include the columns the database requires

The SQL builder's `insert` now requires every column that is not nullable and has no default. A column is still optional when it is nullable, has a default (`@default(...)`, including `now()` and `autoincrement()`), or is generated on create (`@onCreate(...)` or a preset that generates on create).

For each insert in your extension's code that stops compiling, add a real value for each column the error names. Do not cast the row. A required property does not accept `undefined`, so a value typed `T | undefined` for one of these columns must be checked before the insert.
