---
changes:
  - id: re-emit-for-subquery-reads-written-table
    summary: |
      The PostgreSQL, SQLite and MariaDB adapters report a new capability in the `sql` group, `subqueryReadsWrittenTable`: a subquery of an `UPDATE` or a `DELETE` may read the table the statement writes. The MySQL adapter does not report it. Run `prisma contract emit` to record it in `contract.json` and `contract.d.ts`. A contract that is not re-emitted keeps working, because the runtime merges the adapter's capabilities over the contract's, and the profile hash does not change, so no database needs signing again. The contract snapshots under `migrations/snapshots/` need no change.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"targetFamily"\s*:\s*"sql")(?![\s\S]*"target"\s*:\s*"mysql")(?![\s\S]*"subqueryReadsWrittenTable")'
  - id: adapters-report-subquery-reads-written-table
    summary: |
      Where the contract's `sql` group does not report `subqueryReadsWrittenTable`, the ORM client rewrites the `WHERE` of an `UPDATE` or `DELETE` whose subquery reads the written table: it selects the keys of the matching rows in a derived table and writes the rows with those keys. An SQL adapter must report the capability where its database runs such a statement as written.
---

# Re-emit SQL contracts for `subqueryReadsWrittenTable`

Run `prisma contract emit` for every PostgreSQL, SQLite and MariaDB contract. The emitted `capabilities.sql` gains the new key:

```json
"sql": {
  "subqueryReadsWrittenTable": true
}
```

A MySQL contract does not change: the MySQL adapter does not report the capability.

# Report `subqueryReadsWrittenTable` from an SQL adapter

Add the key to your adapter's `sql` capability group, set to `true`, if your database runs an `UPDATE` or a `DELETE` that has a subquery reading the table the statement writes, and the subquery reads the rows as they were before the statement:

```ts
export const myAdapterCapabilities = {
  sql: {
    subqueryReadsWrittenTable: true,
  },
};
```

If your database refuses such a statement, as MySQL does with error 1093, leave the key out or set it to `false`. The ORM client then sends, for a write whose filter reads the written table, `key IN (SELECT matching_keys.key FROM (SELECT key FROM table WHERE filter) AS matching_keys)`, so your renderer must lower a derived table in a subquery and, for a key of several columns, a list of columns on the left of `IN`. Such a write on a table with no primary key, and no unique constraint whose columns are all `NOT NULL`, is refused with `ORM.CAPABILITY_MISSING`.
