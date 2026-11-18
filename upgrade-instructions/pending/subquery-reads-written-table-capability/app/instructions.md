---
changes:
  - id: re-emit-for-subquery-reads-written-table
    summary: |
      The PostgreSQL, SQLite and MariaDB adapters report a new capability in the `sql` group, `subqueryReadsWrittenTable`: a subquery of an `UPDATE` or a `DELETE` may read the table the statement writes. The MySQL adapter does not report it. Run `prisma contract emit` to record it in `contract.json` and `contract.d.ts`. A contract that is not re-emitted keeps working, because the runtime merges the adapter's capabilities over the contract's, and the profile hash does not change, so no database needs signing again. The contract snapshots under `migrations/snapshots/` need no change.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"targetFamily"\s*:\s*"sql")(?![\s\S]*"target"\s*:\s*"mysql")(?![\s\S]*"subqueryReadsWrittenTable")'
---

# Re-emit SQL contracts for `subqueryReadsWrittenTable`

Run `prisma contract emit` for every PostgreSQL, SQLite and MariaDB contract. The emitted `capabilities.sql` gains the new key:

```json
"sql": {
  "subqueryReadsWrittenTable": true
}
```

A MySQL contract does not change: MySQL refuses, with error 1093, an `UPDATE` or `DELETE` that has a subquery reading the table the statement writes, so its adapter does not report the capability.

On MySQL, the ORM client now runs the writes that MySQL refused before: `updateAll`, `deleteAll` and nested writes filtered by a self-relation, and writes on a variant stored in its own table. It selects the keys of the matching rows in a derived table and writes the rows that have those keys. Such a write on a table with no primary key, and no unique constraint whose columns are all `NOT NULL`, is refused with `ORM.CAPABILITY_MISSING`.
