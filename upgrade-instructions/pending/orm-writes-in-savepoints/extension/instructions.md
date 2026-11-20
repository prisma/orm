---
changes:
  - id: activity-handle-transaction-and-in-transaction-required
    summary: |
      An activity handle, the `ActivityHandle` from `startActivityOn` or `startActivity` in `@prisma/orm-family-sql/runtime`, always has `transaction(fn, options)` and a new `inTransaction()` member. On a handle opened inside a transaction, or on a connection whose transaction is open, `transaction(fn)` runs `fn` in a savepoint, and `transaction(fn, options)` rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`. An object built by hand and typed as `ActivityHandle` must have both members, and a wrapper that copies a handle member by member must forward them. The detection matches TypeScript sources that name the type or call an optional `transaction` member.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ActivityHandle(?![\w$])'
        - '\.transaction\?\.\('
  - id: activity-route-transaction-always-defined
    summary: |
      `ActivityRoute.transaction`, from `@prisma/orm-family-sql/runtime`, is always a function; its type no longer includes `undefined`. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ActivityRoute(?![\w$])'
  - id: orm-write-inside-transaction-suspends-tx
    summary: |
      An ORM write of more than one statement inside a transaction runs in a savepoint. While it runs, other work sent on the same transaction rejects with `RUNTIME.TRANSACTION_SUSPENDED`. The detection matches TypeScript sources that call `transaction` and `Promise.all` or `Promise.allSettled`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\.transaction\s*\()[\s\S]*Promise\.all'
---

# An activity handle always has `transaction` and `inTransaction`

Drop the optional call on a handle's `transaction`: write `handle.transaction(fn)` in place of `handle.transaction?.(fn)`. Code that tested for the member, such as `'transaction' in handle` or `handle.transaction === undefined`, to learn whether the handle was opened inside a transaction calls `handle.inTransaction()` instead. Inside a transaction, call `handle.transaction(fn)` without options.

An object built by hand and typed as `ActivityHandle`, such as a stub in a test, gains both members:

```ts
const handle: ActivityHandle<'my-call'> = {
  ...members,
  transaction: (fn, options) => inner.transaction(fn, options),
  inTransaction: () => inner.inTransaction(),
};
```

A wrapper that copies a handle's members by name, for example to record the statements it sends, forwards `inTransaction` too. Without it the ORM treats the handle as outside a transaction and passes its implicit transaction options, and on a facade that sets them, such as MySQL's, a write of several statements inside a transaction rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`.

# `ActivityRoute.transaction` is always defined

A `SqlRuntimeBase` subclass that builds an `ActivityRoute` sets `transaction` to a function; `transaction: undefined` no longer typechecks. Remove checks of the member for `undefined`.

# Concurrent work on a transaction during an ORM write

Where code runs an ORM write of several statements, such as a create with a nested relation, at the same time as other work on the same transaction, for example in `Promise.all`, await the write before sending the other work:

```ts
await tx.orm.Post.create({ title, author: (author) => author.create(user) });
await tx.execute(plan);
```
