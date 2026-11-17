---
changes:
  - id: re-emit-mysql-contract-for-aggregates
    summary: |
      The MySQL target now contributes the ORM's aggregates, so `include('posts', (p) => p.count())`, `combine()` and `aggregate()` run on MySQL and MariaDB. Run `prisma contract emit` so `contract.d.ts` carries the aggregate types; until then TypeScript does not offer `count()`, `sum()`, `avg()`, `min()` and `max()`. `contract.json` and the contract hashes do not change.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '(?<![\s\S])(?=[\s\S]*readonly target: .(?:mysql|mariadb).)[\s\S]*AggregateTypes = Record<string, never>'
---

# Re-emit MySQL and MariaDB contracts for the ORM's aggregates

Run `prisma contract emit` for every MySQL or MariaDB contract. The emitted `contract.d.ts` replaces `export type AggregateTypes = Record<string, never>;` with the aggregate overloads the MySQL target contributes. Nothing else changes, and no database needs migrating or signing again.

On MySQL and MariaDB, `count` and `sum` over integers read as a JavaScript `number`, and fail with `RUNTIME.DECODE_FAILED` rather than round a value outside ±(2^53 − 1); `countBigInt` and `sumBigInt` read as a `bigint`. `avg` over an integer reads the exact mean as a `number`.
