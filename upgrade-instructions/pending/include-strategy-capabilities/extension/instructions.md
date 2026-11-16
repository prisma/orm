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
  - id: adapters-report-include-capabilities
    summary: |
      The ORM loads includes with the one-query include only when the contract's `sql` group reports `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`. An SQL adapter must report each of them where it is true of its database. An adapter that reports none of them gets one query per relation: its users' paged and `distinct` includes need window functions, `prepared.all()`, `prepared.first()` and `prepared.firstOrThrow()` with includes throw `ORM.CAPABILITY_MISSING`, and a read with includes runs several statements.
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

# Report the include capabilities from an SQL adapter

Add the three keys to your adapter's `sql` capability group, each set to `true` only where your database meets it:

- `jsonAgg`: the database aggregates rows into a JSON array.
- `outerReferencesInDerivedTables`: a subquery in a `FROM` clause can refer to a column of the outer query.
- `jsonAggWithoutTruncation`: a JSON aggregate never truncates its result, whatever the server's settings.

```ts
export const myAdapterCapabilities = {
  sql: {
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
  },
};
```

If your database lacks any of them, leave that key out or set it to `false`. The ORM then loads each include with one query per relation, and your users meet these differences:

- A paged include (`limit` or `offset`) and a `distinct()` include are numbered with `ROW_NUMBER()`, so the database needs window functions.
- `prepared.all()`, `prepared.first()` and `prepared.firstOrThrow()` with includes throw `ORM.CAPABILITY_MISSING`, because a prepared read is one statement.
- A read with includes sends one statement for its rows and one for each included relation, outside a transaction.
