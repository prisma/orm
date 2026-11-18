---
changes:
  - id: activity-handle-transaction-takes-callback
    summary: |
      An activity handle's `transaction` member, from `startActivityOn` or `startActivity` in `@prisma/orm-family-sql/runtime`, takes a callback: `handle.transaction(fn, options)` runs `fn` in a transaction through `withTransaction` and resolves with its result. It no longer returns a `RuntimeTransaction` for the caller to commit or roll back. The detection matches TypeScript sources that call an optional `transaction` member.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.transaction\?\.\('
  - id: sql-runtime-base-own-transaction-removed
    summary: |
      `SqlRuntimeBase.ownTransaction` is removed, and `ActivityRoute.transaction` is now `(parent) => ConnectionProvider`: it returns the connections `withTransaction` runs a transaction beneath `parent` on, instead of beginning the transaction itself. The detection matches TypeScript sources that call `ownTransaction` or build an `ActivityRoute`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ownTransaction\s*\('
        - '(?<![\w$])ActivityRoute(?![\w$])'
  - id: orm-runtime-queryable-transaction-removed
    summary: |
      The ORM client's `RuntimeQueryable` type, from `@prisma/orm-family-sql/orm-client`, no longer has an optional `transaction` member. The ORM runs a write of several statements in a transaction of the call's own activity handle and never calls `transaction` on the queryable it is given. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])RuntimeQueryable(?![\w$])'
  - id: rollback-after-commit-rejects
    summary: |
      `rollback()` on a runtime transaction or savepoint whose `commit()` the database applied rejects with `RUNTIME.TRANSACTION_CLOSED` and sends nothing; it used to resolve. This includes a `commit()` that rejected because an `activityEnded` hook threw after the `COMMIT`. The detection matches TypeScript sources that call `rollback()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.rollback\s*\(\s*\)'
---

# An activity handle runs `transaction(fn)` through `withTransaction`

## `handle.transaction` takes a callback

Where code calls `transaction` on an activity handle, pass the work as a callback and drop the `commit()` and `rollback()` calls. The callback receives the same context `withTransaction` passes to its callback. `withTransaction` commits when the callback resolves, rolls back when it throws, and gives the connection back. A failed `COMMIT` rejects with `RUNTIME.TRANSACTION_COMMIT_FAILED` and a failed `ROLLBACK` after a callback error with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, each with the original error as `cause`. Code that matched on the driver's error from those calls matches on these codes instead. Leave calls on a connection, `connection.transaction(options)`, as they are; only the handle's member changed.

Before:

```ts
const tx = await handle.transaction?.(options);
if (tx) {
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
```

After:

```ts
if (handle.transaction) {
  return handle.transaction((tx) => work(tx), options);
}
```

A handle opened on a connection the caller holds runs the transaction on that connection and leaves it held after a commit or a rollback. After a failed `BEGIN`, a failed `ROLLBACK` or a timeout the connection is destroyed, and a later `release()` by its holder rejects.

## `ownTransaction` and `ActivityRoute.transaction`

A `SqlRuntimeBase` subclass that built an `ActivityRoute` with `transaction: (parent, options) => ...` and began the transaction through `this.ownTransaction(...)` now returns a `ConnectionProvider` from `transaction: (parent) => ...`. Its `connection()` opens the connection the transaction runs on, and that connection's `transaction(options)` calls `beginTransactionOn(connection, owner, parent, options)` with the route's `parent`. Delete the method that called `ownTransaction`.

Before:

```ts
transaction: (parent, options) => runtime().beginRoleTransaction(binding, parent, options),

private async beginRoleTransaction(binding, parent, options) {
  const { conn, session } = await this.openRoleConnection(binding, { activityParent: parent });
  return this.ownTransaction(session, () => this.beginTransactionOn(conn, session, parent, options));
}
```

After:

```ts
transaction: (parent) => ({
  connection: async () =>
    (await runtime().openRoleConnection(binding, { activityParent: parent })).session,
}),
```

In the method that builds the session, take `const parent = options?.activityParent;` and pass `parent` in place of `undefined` to `beginTransactionOn` in the session's `transaction(options)`.

## The ORM's `RuntimeQueryable` has no `transaction`

Remove any `transaction` member written only so the ORM could open a transaction on a queryable typed `RuntimeQueryable`; the ORM no longer reads it. Code that called `transaction` through a value typed `RuntimeQueryable` types the value as the runtime type it holds, such as `Runtime`, `RuntimeConnection` or an activity handle.

## `rollback()` after a commit rejects

Remove a `rollback()` call that runs after `commit()` resolved, such as one in a `finally` block or in a `catch` that also handles a hook error thrown from `commit()`. Where `commit()` can reject, call `rollback()` only when the transaction did not commit, or wrap the work in `withTransaction`, which decides this itself.
