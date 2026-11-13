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

With `onConflict: 'skip'`, `createAll` and `createAndCount` watch the fields named in `conflictOn` when given, and otherwise every primary key and unique constraint of the table. A row can conflict when it gives a non-null value for every field of at least one of those keys. Values count when the row gives them or when the ORM fills them in from a create default such as `uuid()`, `cuid()` or `now()`. A column the database fills in (auto-increment, a database default) and `null` do not count.

A call with a row that cannot conflict now throws `ORM.ARGUMENT_INVALID` before any statement runs, and inserts no row. The error's `meta` gives the method, the model, the row's `index` and the `conflictKeys`; the message and `conflictKeys` list each conflict key by its storage columns, such as `invited_by_id` for the field `invitedById`. Before, such a row was always inserted, since nothing could collide with it.

For each call that throws:

1. If the row should be skipped when a matching row exists, give it a value for each field named in `conflictOn`, or name in `conflictOn` fields the row gives values for.
2. If the row should always be inserted, insert it with a separate `createAll(rows)` or `createAndCount(rows)` call without `onConflict`.
