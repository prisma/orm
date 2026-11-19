---
changes:
  - id: postgres-transaction-context-has-transaction
    summary: |
      `PostgresTransactionContext`, from `@prisma/orm-postgres/runtime`, has a required `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type. A context an extension builds for its own transactions and types as `PostgresTransactionContext` must have the member, or be typed without it. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PostgresTransactionContext(?![\w$])'
  - id: transaction-context-has-transaction
    summary: |
      `TransactionContext`, from `@prisma/orm-family-sql/runtime`, has a required `transaction(fn)` member: it runs `fn` in a savepoint and passes it the savepoint's `TransactionContext`. An object an extension builds by hand and types as `TransactionContext` must have the member. A context type that extends `TransactionContext` has the member too, with a callback that receives the runtime's context, unless the extension declares its own. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])TransactionContext(?![\w$])'
---

# `PostgresTransactionContext` has `transaction`

Where an extension builds the context of its own transactions with `withTransactionMembers(txCtx, members)` and gives it the type `PostgresTransactionContext`, or a type that aliases it, do one of the following.

To offer nested transactions, add a `transaction` member that calls the runtime context's `transaction` and builds the extension's context for the nested one. Build the context in a function that calls itself for the nested context, so each nested context has the member too:

```ts
function buildTransactionContext(txCtx: TransactionContext): PostgresTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...members(txCtx),
    transaction: <R>(
      fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  });
}

return withTransaction(runtime, (txCtx) => fn(buildTransactionContext(txCtx)), options);
```

To keep the context without nested transactions, type it without the member:

```ts
export type MyTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = Omit<PostgresTransactionContext<TContract, TCollections>, 'transaction'>;
```

# `TransactionContext` has `transaction`

An object built by hand and typed as `TransactionContext`, such as a stub in a test, gains a `transaction` member. Delegate it to the context the object wraps, or reject when the object has none:

```ts
const ctx: TransactionContext = {
  invalidated: false,
  query: (plan) => inner.query(plan),
  execute: (plan) => inner.execute(plan),
  transaction: (fn) => inner.transaction(fn),
};
```

A context type that extends `TransactionContext` and builds its object with `withTransactionMembers` now has `transaction` in its type and at run time, and the callback receives the runtime's `TransactionContext`, without the extension's members. To pass the extension's context instead, declare `transaction` on the type and add the member as in the Postgres example above. To hide it, type the context with `Omit<…, 'transaction'>`.
