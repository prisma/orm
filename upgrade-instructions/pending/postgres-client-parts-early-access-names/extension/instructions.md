---
changes:
  - id: postgres-client-parts-early-access-names
    summary: |
      The PostgreSQL facade's `internal/options`, `internal/static-context`, `internal/transaction-members` and `internal/validate-contract` entries are removed. The parts of `postgres()` they exported have Early Access names on existing entries, and `PostgresRuntimeImpl` is renamed. Import `ea_connectWithBinding`, `ea_resolveOptionalPostgresBinding`, `Ea_PostgresBindingRules`, `ea_validateTransactionOptions`, `ea_validateCursorOptions`, `ea_toDriverCursorOptions`, `ea_buildPostgresQueryMembers` and `Ea_PostgresRuntimeImpl` from `@prisma/orm-postgres/runtime`, and `ea_buildPostgresStaticContext` and `ea_validatePostgresContract` from `@prisma/orm-postgres/static`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-postgres/internal/'
        - '@internal/postgres/internal/'
        - '(?<![\w$])PostgresRuntimeImpl(?![\w$])'
  - id: sql-prepared-query-early-access-names
    summary: |
      The `runtime/internal/prepared-query` entry of `@prisma/orm-family-sql` is removed, and so is `family-runtime/internal/prepared-query` on `@prisma/orm-postgres`, `@prisma/orm-mysql`, `@prisma/orm-mariadb` and `@prisma/orm-sqlite`. Import `ea_preparedStatementQuery`, `ea_preparedStatementExecute`, `ea_transactionStart`, `ea_createTransactionStart`, `Ea_PreparedStatementQueryTarget`, `Ea_PreparedStatementExecuteTarget` and `Ea_TransactionStartTarget` from `@prisma/orm-family-sql/runtime` (or a facade's `family-runtime` entry). The entry's other names are no longer exported.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'runtime/internal/prepared-query'
---

# The parts of the PostgreSQL client have Early Access names

An extension that builds a client from the same parts as `postgres()` imported them from entries named `internal`. Those entries are removed. Each name is now exported from an entry any user can import, with the Early Access prefix: `ea_` on a function or constant, `Ea_` on a type or class. An Early Access name may change in any release.

Change each import and each use of the name. The values and types are the same; only their names and import paths change.

| Before | After |
| --- | --- |
| `connectWithBinding`, `resolveOptionalPostgresBinding`, `PostgresBindingRules`, `validateTransactionOptions`, `validateCursorOptions`, `toDriverCursorOptions` from `@prisma/orm-postgres/internal/options` | `ea_connectWithBinding`, `ea_resolveOptionalPostgresBinding`, `Ea_PostgresBindingRules`, `ea_validateTransactionOptions`, `ea_validateCursorOptions`, `ea_toDriverCursorOptions` from `@prisma/orm-postgres/runtime` |
| `buildPostgresQueryMembers` from `@prisma/orm-postgres/internal/transaction-members` | `ea_buildPostgresQueryMembers` from `@prisma/orm-postgres/runtime` |
| `PostgresRuntimeImpl` from `@prisma/orm-postgres/runtime` | `Ea_PostgresRuntimeImpl` from `@prisma/orm-postgres/runtime` |
| `buildPostgresStaticContext` from `@prisma/orm-postgres/internal/static-context` | `ea_buildPostgresStaticContext` from `@prisma/orm-postgres/static` |
| `PostgresStaticContext` from `@prisma/orm-postgres/internal/static-context` | `PostgresStaticContext` from `@prisma/orm-postgres/static` |
| `validatePostgresContract` from `@prisma/orm-postgres/internal/validate-contract` | `ea_validatePostgresContract` from `@prisma/orm-postgres/static` |
| `preparedStatementQuery`, `preparedStatementExecute`, `transactionStart`, `createTransactionStart`, `PreparedStatementQueryTarget`, `PreparedStatementExecuteTarget`, `TransactionStartTarget` from `@prisma/orm-family-sql/runtime/internal/prepared-query` | `ea_preparedStatementQuery`, `ea_preparedStatementExecute`, `ea_transactionStart`, `ea_createTransactionStart`, `Ea_PreparedStatementQueryTarget`, `Ea_PreparedStatementExecuteTarget`, `Ea_TransactionStartTarget` from `@prisma/orm-family-sql/runtime` |

Through a facade, the prepared-query names come from its `family-runtime` entry, for example `@prisma/orm-postgres/family-runtime`, in place of `family-runtime/internal/prepared-query`.

The prepared-query entry's other names (`settlementOf`, `transactionSettlement`, `wasRefusedBeforeBegin`, `SettledTransactionTarget`, `TransactionSettlementState`, `TransactionStart`) are no longer exported, and have no replacement.

The upgrade to 8.0.0-rc.25 described two uses of them: forwarding the settlement member of a transaction an extension wraps, and building a `TransactionSettlementState` object by hand. The runtime finds the settlement member by looking it up on the transaction object, and no exported type requires it. So a wrapper that keeps the wrapped transaction as its prototype (`Object.create(transaction)`), or copies the wrapped transaction's own properties onto itself (`Object.assign(wrapper, transaction)`), still forwards the member without naming it. A wrapper that forwards it by name (`[transactionSettlement]: transaction[transactionSettlement]`), or code that builds or types a `TransactionSettlementState`, has nothing left to import. If your extension needs one of these names, open an issue at https://github.com/prisma/orm/issues and say what it uses the name for.
