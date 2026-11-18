---
changes:
  - id: re-emit-for-include-capabilities
    summary: |
      SQL adapters report two new capabilities in the `sql` group, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`, which together with `sql.jsonAgg` decide whether the ORM loads includes with the one-query include or with one query per relation. The PostgreSQL and MySQL adapters now also report `sql.jsonAgg`. Run `prisma contract emit` to record them in `contract.json` and `contract.d.ts`. A contract that is not re-emitted keeps working, because the runtime merges the adapter's capabilities over the contract's, and the profile hash does not change, so no database needs signing again. The contract snapshots under `migrations/snapshots/` need no change.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"targetFamily"\s*:\s*"sql")(?![\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAggWithoutTruncation")'
        - '(?<![\s\S])(?=[\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAgg")'
  - id: nullable-unique-key-is-no-row-identity
    summary: |
      A unique key with a nullable column no longer identifies a row: two rows may both hold NULL in it. A table whose only unique key has a nullable column now has no row identity, on every database, and the ORM refuses the calls that need one with `ORM.ROW_IDENTITY_MISSING`. Give such a table a primary key, or make the unique key's columns `NOT NULL`.
---

# Re-emit SQL contracts for the include capabilities

Run `prisma contract emit` for every SQL contract. The emitted `capabilities.sql` gains the new keys the adapter reports:

```json
"sql": {
  "jsonAgg": true,
  "jsonAggWithoutTruncation": true,
  "outerReferencesInDerivedTables": true
}
```

A MariaDB contract gains only `"jsonAgg": true`: MariaDB does not report the other two, and the emitter leaves out a capability that is `false`. Without them the ORM loads includes on MariaDB with one query per relation.

# A unique key with a nullable column is no row identity

The ORM matches rows by their primary key, or else by a unique key. It now skips a unique key that has a nullable column, because two rows can both hold `NULL` in it. If such a key is the only one a table has, the table has no row identity, and these calls fail with `ORM.ROW_IDENTITY_MISSING`:

- `update()` and `delete()`, on every database.
- `create()`, `createAll()`, `update()`, `updateAll()` and `upsert()` after `.include(...)`, on every database.
- On a database without `RETURNING`: `create()`, `createAll()` and `updateAll()` that return rows, since they read their rows back by key.
- On a database whose adapter does not report `sql.jsonAgg`, `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`: any read with an include of that table, at any level, and `deleteAll()` after `.include(...)`, since the included rows are matched to their parents by key.

`deleteAll()` on such a table, where it must read the rows before deleting them, deletes by the caller's condition, as it does on any table with no primary key or unique constraint.

Find each model whose table has no `@id` and whose `@unique` or `@@unique` fields include an optional one. Then do one of these:

- Add a primary key to the table (`@id` or `@@id`), and create a migration for it.
- Make the unique key's fields required, so its columns are `NOT NULL`, and create a migration for it.
