---
changes:
  - id: single-row-mutations-require-unique-filter
    summary: ORM delete() and update() now require a where() on the primary key or a unique field; switch other filters to deleteAll()/updateAll().
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".delete()"
        - ".update("
      anyMatch: true
---

# `delete()` / `update()` require a unique filter (Postgres, SQLite)

The single-row ORM terminals `db.orm.<ns>.<Model>.where(...).delete()` and `.where(...).update(data)` now type-check only after a shorthand `.where({ ... })` that binds every column of the primary key, or of one unique constraint, to a non-null value. Before, any filter compiled and the terminal changed whichever matching row the database returned first. Mongo is unchanged.

Run the project's typecheck. Each call it rejects fails with `The 'this' context ... is not assignable to method's 'this' of type 'never'` on `.delete()`, or `Argument of type ... is not assignable to parameter of type 'never'` on `.update(...)`. For each one, decide what the code means and rewrite it:

- **It should change every matching row** (the common case: `.where({ userId }).delete()` in cleanup or account-deletion code). Use `deleteAll()` / `updateAll(data)` and await the result, or `deleteAndCount()` / `updateAndCount(data)` when only the count is used. A call site that read the `Row | null` result must now handle `Row[]` or a number.
- **It targets one row through a callback on the key**, such as `.where((u) => u.id.eq(id))`. Rewrite it as the shorthand `.where({ id })`. A callback filter is never treated as unique.
- **The key value can be `undefined` or `null`**, such as `.where({ id: maybeId })`. Narrow the value first, because the filter drops `undefined` and turns `null` into `IS NULL`.
- **It targets one row by a composite key**. Include every column of the key: `.where({ tenantId, id })`.
- **It deliberately changed one arbitrary row of many**. Read that row's key with `.first()` and then `.where({ id: row.id }).delete()`. Better still, use the SQL builder with an explicit `ORDER BY ... LIMIT 1` when the choice of row matters.

Do not cast around the error: a cast restores the old behaviour of changing one arbitrary row.
