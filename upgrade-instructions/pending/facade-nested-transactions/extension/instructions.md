---
changes:
  - id: facade-transaction-contexts-have-transaction
    summary: |
      `MysqlTransactionContext` (`@prisma/orm-mysql/runtime`), `MariadbTransactionContext` (`@prisma/orm-mariadb/runtime`) and `SqliteTransactionContext` (`@prisma/orm-sqlite/runtime`) declare their own `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type, not the runtime's `TransactionContext`. A context an extension builds for its own transactions and types as one of them must have the member. The detection matches TypeScript sources that name one of the types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Mysql|Mariadb|Sqlite)TransactionContext(?![\w$])'
  - id: supabase-transaction-context-is-postgres-transaction-context
    summary: |
      `SupabaseTransactionContext`, from `@prisma/orm-extension-supabase/runtime`, is `PostgresTransactionContext` again: its `transaction(fn)` passes `fn` a `SupabaseTransactionContext`, not the runtime's `TransactionContext`. Code that typed the nested callback's parameter as `TransactionContext` can use the facade's members on it. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])SupabaseTransactionContext(?![\w$])'
---

# `MysqlTransactionContext`, `MariadbTransactionContext` and `SqliteTransactionContext` have their own `transaction`

Where an extension builds the context of its own transactions with `withTransactionMembers(txCtx, members)` and gives it one of these types, add a `transaction` member that calls the runtime context's `transaction` and builds the extension's context for the nested one. Build the context in a function that calls itself for the nested context, so each nested context has the member too:

```ts
function buildTransactionContext(txCtx: TransactionContext): MysqlTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...members(txCtx),
    transaction: <R>(
      fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  });
}

return withTransaction(runtime, (txCtx) => fn(buildTransactionContext(txCtx)), options);
```

Code that only receives `tx` from `db.transaction(...)` needs no change: the callback of `tx.transaction(...)` now receives the same type as `tx`, which has every member the runtime's `TransactionContext` has.

# `SupabaseTransactionContext` is `PostgresTransactionContext`

Where code compares `SupabaseTransactionContext` with `Omit<PostgresTransactionContext, 'transaction'>`, or types the parameter of the callback passed to `tx.transaction(...)` as `TransactionContext`, use `PostgresTransactionContext` or `SupabaseTransactionContext` instead. A context an extension builds and types as `SupabaseTransactionContext` must have a `transaction` member built as in the example above.
