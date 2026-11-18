---
changes:
  - id: postgres-transaction-context-has-transaction
    summary: |
      `PostgresTransactionContext`, from `@prisma/orm-postgres/runtime`, has a required `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type. A context an extension builds for its own transactions and types as `PostgresTransactionContext` must have the member, or be typed without it. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PostgresTransactionContext(?![\w$])'
---

# `PostgresTransactionContext` has `transaction`

Where an extension builds the context of its own transactions with `withTransactionMembers(txCtx, members)` and gives it the type `PostgresTransactionContext`, or a type that aliases it, do one of the following.

To offer nested transactions, add a `transaction` member built with `withSavepoint` from `@prisma/orm-family-sql/runtime`. Build the context in a function that passes itself to `withSavepoint`, so each nested context has the member too:

```ts
function buildTransactionContext(txCtx: TransactionContext): PostgresTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...members(txCtx),
    transaction: (fn) => withSavepoint(txCtx, fn, buildTransactionContext),
  });
}

return withTransaction(runtime, (txCtx) => fn(buildTransactionContext(txCtx)), options);
```

`withSavepoint` takes only the context that `withTransaction` or `withSavepoint` passed to its callback; any other object is rejected with `RUNTIME.UNKNOWN_TRANSACTION_CONTEXT`.

To keep the context without nested transactions, type it without the member:

```ts
export type MyTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = Omit<PostgresTransactionContext<TContract, TCollections>, 'transaction'>;
```
