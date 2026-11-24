---
changes:
  - id: mysql-reemit-contract
    summary: |
      On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, and the target has new codecs for them. The emitted `contract.d.ts` gains aggregate result types for the new codecs. Re-emit the contract; `contract.json` and its hashes do not change, so the database needs no migration and no new signature.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '[''"]@prisma/orm-(?:mysql|mariadb)/config[''"]'
---

# MySQL and MariaDB scalars get convenience types

On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL, SQLite and MongoDB. Each chooses one explicit type named after the MySQL column type that stores it: `Int` is `Int4`, `BigInt` is `Int8BigInt`, `BigInt(as: number)` is `Int8Number`, `Float` is `Float8` (a `double`), `Decimal` is `NumericString(65, 30)`, `String` is `Varchar(191)` and `String(storage: text)` is `Text`, `Boolean` is `Bool` (a `tinyint(1)`), `Bytes` is `Longblob` and `Json` is `PlainJson`. A field written `Int`, `BigInt` or `String` gives the same codec as before, so no schema needs a change.

## `mysql-reemit-contract`

In each matched project, emit the contract again:

```bash
pnpm prisma contract emit
```

The generated `contract.d.ts` gains entries under `AggregateTypes` for the new codecs, such as `sum` over `mysql/decimal@1` and `avg` over `mysql/double@1`. `contract.json` does not change, so its hashes and the database's signature stay as they are, and no migration is needed. Leave the `contract.d.ts` copy inside each migration snapshot under `migrations/snapshots/` as it is.
