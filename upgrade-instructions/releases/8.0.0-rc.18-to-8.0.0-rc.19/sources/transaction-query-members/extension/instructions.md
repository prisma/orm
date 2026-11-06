---
changes:
  - id: transaction-query-members
    summary: |
      Additive for code that only uses these types: a transaction now offers the client's query members (`sql`, `orm`, `raw`, `prepare`, `query`, `execute`) on every SQL client, a Supabase role-bound client gains `prepare`, and SQLite's `db.orm` gains `fragment`. Code that builds its own object of one of the changed types must add the new members. Changed: `PostgresTransactionContext` (adds `raw` and `prepare`), `SqliteTransactionContext` (adds `raw` and `prepare`; `orm` is now `SqliteOrm`), `RoleBoundDb` (adds `prepare`; `transaction` passes a `SupabaseTransactionContext`). New: `PostgresQueryMembers` and `SqliteQueryMembers` (the query members a client and its transactions share), `SupabaseTransactionContext`, `SqliteOrm`, and from the ORM client `OrmClientRootMembers` and `PrepareMember`. The detection matches a file that names one of these types, or `SqliteClient`, whose `orm` changed.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$])(?:PostgresTransactionContext|SqliteTransactionContext|SqliteClient|RoleBoundDb|SupabaseTransactionContext|PostgresQueryMembers|SqliteQueryMembers|SqliteOrm|OrmClientRootMembers)(?![\w$])'
---

# A transaction offers the client's query members

Inside `db.transaction(async (tx) => …)`, `tx` now has the client's query members with the same types: `sql`, `orm` (with the client's custom collection classes), `raw`, `prepare`, `query` and `execute`. This holds for `postgres()`, every serverless connection, `sqlite()` and every Supabase role-bound client. A prepared statement runs on whatever it is given, so `ps.query(tx, params)` runs inside the transaction; `tx.prepare` lets code inside a transaction prepare without the outer client.

Code that only reads these types needs no change. Code that creates an object of one of them, for example a test double typed `PostgresTransactionContext<Contract>`, must add the new members:

| Type | New or changed members |
| --- | --- |
| `PostgresTransactionContext` (`@prisma/orm-postgres/runtime`) | `raw`, `prepare`; it extends the new `PostgresQueryMembers`, which `PostgresClient` and `PostgresServerlessConnection` also extend |
| `SqliteTransactionContext` (`@prisma/orm-sqlite/runtime`) | `raw`, `prepare`; `orm` is `SqliteOrm`, the namespace's models plus `fragment`; it extends the new `SqliteQueryMembers`, which `SqliteClient` also extends |
| `SqliteClient['orm']` | `SqliteOrm`, which adds `fragment` |
| `RoleBoundDb` (`@prisma/orm-extension-supabase/runtime`) | `prepare`, and the two prepared-statement entry points a statement's `query` and `execute` call; it extends `PostgresQueryMembers`; `transaction` passes a `SupabaseTransactionContext` instead of a plain `TransactionContext` |
| `OrmClientRootMembers` (ORM client) | newly exported: the members of the ORM client beside its namespaces, today `fragment` |
| `PrepareMember` (ORM client) | newly exported: the `prepare` member a client and its transactions offer |

A hand-built `RoleBoundDb`, such as a test double, must also implement the two prepared-statement entry points, keyed by the symbols `preparedStatementQuery` and `preparedStatementExecute`. Import them from `@prisma/orm-postgres/family-runtime/internal/prepared-query` (or `@prisma/orm-family-sql/runtime/internal/prepared-query`). Like every `internal/` entry, it can change without notice.

A callback typed to take a plain `TransactionContext` still compiles where a transaction context is passed, because each new context type extends it.
