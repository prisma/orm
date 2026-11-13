---
changes:
  - id: create-all-skip-refuses-rows-without-conflict-key
    summary: |
      `createAll(rows, { onConflict: 'skip' })` and `createAndCount(rows, { onConflict: 'skip' })` now refuse, before any statement runs, a row that gives no value for any key the option watches, with `ORM.ARGUMENT_INVALID`. Such a row was inserted before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])onConflict\s*:\s*[\x27"]skip[\x27"]'
---

# `onConflict: 'skip'` refuses rows that cannot conflict

## `create-all-skip-refuses-rows-without-conflict-key`

With `onConflict: 'skip'`, `createAll` and `createAndCount` watch the `conflictOn` columns when given, and otherwise every primary key and unique constraint of the table. A row can conflict when it gives a non-null value for every column of at least one of those keys. Values count when the row gives them or when the ORM fills them in from a create default such as `uuid()`, `cuid()` or `now()`. A column the database fills in (auto-increment, a database default) and `null` do not count.

A call with a row that cannot conflict now throws `ORM.ARGUMENT_INVALID` before any statement runs, and inserts no row. The error's `meta` gives the method, the model, the row's `index` and the `conflictKeys` (the column sets watched). Before, such a row was always inserted, since nothing could collide with it.

For each call that throws:

1. If the row should be skipped when a matching row exists, give it a value for the `conflictOn` columns, or name in `conflictOn` columns the row gives.
2. If the row should always be inserted, insert it with a separate `createAll(rows)` or `createAndCount(rows)` call without `onConflict`.
