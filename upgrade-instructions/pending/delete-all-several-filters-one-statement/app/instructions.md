---
changes:
  - id: delete-all-includes-without-row-identity-refused
    summary: |
      `deleteAll()` that returns its rows with `include(...)`, on a table with no primary key and no unique constraint whose columns are all `NOT NULL`, is now refused with `ORM.ROW_IDENTITY_MISSING`, as `updateAll()` already was. Drop the include, or give the table a primary key or such a unique constraint.
---

# `deleteAll()` with includes on a table with no row identity

## `delete-all-includes-without-row-identity-refused`

`deleteAll()` that returns its rows and loads includes reads the rows first, then deletes them. It limits the `DELETE` to the keys of the rows it read. A table with no primary key, and no unique constraint whose columns are all `NOT NULL`, gives the rows no key to do that by. The previous release ran such a call anyway when the includes loaded in the same query: it deleted by the filter alone and returned the rows it had read, so it could report a row as deleted that was still in the table. The call is now refused before any statement runs, with the error `updateAll()` already raised:

```text
Cannot load include "author" of model "Log": table "Log" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.
```

Find each `deleteAll()` on such a model that has an `include(...)`, whether or not the code uses its result: the call is refused when it is made. Do one of these:

- Drop the include from the `deleteAll()`. If the code needs the related rows, read them with the same filter before the delete, in the same `db.transaction(...)`.
- Give the table a primary key, or a unique constraint whose columns are all `NOT NULL`, in the contract and in the database.

A `deleteAll()` without includes, and `deleteAndCount()`, are not affected.
