---
changes:
  - id: facade-transaction-contexts-have-transaction
    summary: |
      `MysqlTransactionContext` (`@prisma/orm-mysql/runtime`), `MariadbTransactionContext` (`@prisma/orm-mariadb/runtime`) and `SqliteTransactionContext` (`@prisma/orm-sqlite/runtime`) declare their own `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type, not the runtime's `TransactionContext`. A context an extension builds for its own transactions and types as one of them must have the member. The detection matches TypeScript sources that name one of the types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Mysql|Mariadb|Sqlite)TransactionContext(?![\w$])'
  - id: supabase-transaction-context-has-transaction
    summary: |
      `SupabaseTransactionContext`, from `@prisma/orm-extension-supabase/runtime`, is `PostgresTransactionContext`, so it has a required `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a `SupabaseTransactionContext`. A context an extension builds for its own transactions and types as `SupabaseTransactionContext` must have the member. The detection matches TypeScript sources that name the type.
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

# `SupabaseTransactionContext` has `transaction`

`SupabaseTransactionContext` is `PostgresTransactionContext`. Where an extension builds a context with `withTransactionMembers(txCtx, members)` and types it as `SupabaseTransactionContext`, add a `transaction` member built as in the example above, with `SupabaseTransactionContext` in place of `MysqlTransactionContext`.
