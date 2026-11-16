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
