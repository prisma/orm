# ADR 326 — A nested transaction is a savepoint

**Status:** Accepted
**Date:** 2026-11-20
**Domain:** Runtime & Execution
**Related:** [ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md), [ADR 164 — Repository Layer](ADR%20164%20-%20Repository%20Layer.md)

---

## At a glance

Inside `db.transaction(cb)`, the transaction context has a `transaction(cb)` member of its own. It runs its callback in a savepoint of the open transaction:

```ts
await db.transaction(async (tx) => {
  await tx.orm.User.create(a)                      // A

  await tx
    .transaction(async (inner) => {                // SAVEPOINT sp_1
      await inner.orm.Post.create(b)               // B
      throw new Error('nope')                      // ROLLBACK TO SAVEPOINT sp_1, the error is rethrown
    })
    .catch(() => {})                               // tx can be used again

  await tx.orm.Audit.create(c)                     // C
})                                                 // COMMIT: A and C are stored, B is not
```

When the nested callback returns, the savepoint is released (`RELEASE SAVEPOINT sp_1`) and the call resolves with the callback's result. `inner` has the same type and members as `tx`, including `transaction`, so transactions nest to any depth. This holds on every SQL facade: `postgres()`, `mysql()`, `mariadb()`, `sqlite()` and Supabase's role-bound clients.

The same mechanism keeps a single ORM call atomic inside a user's transaction. An ORM write of several statements, such as a create with a related row, runs in a savepoint of its own when a transaction is open, so a failed write leaves none of its rows behind, and the transaction it ran in can go on.

## Context

Two things need a transaction inside a transaction.

The first is composition. A function such as `createUser(db)` opens its own transaction because its writes must be applied together. When another transaction calls it, its writes must still be applied together or not at all, and a failure inside it must not discard the caller's work.

The second is the ORM. A write of several statements runs in a transaction the ORM opens. Inside a user's transaction it cannot open another one, so its statements ran directly in the user's transaction. When one of them failed and the user caught the error, the statements before it stayed in the transaction on MySQL and SQLite and were committed with it. On Postgres the failed statement aborted the transaction, so nothing after it could run.

Postgres, MySQL, MariaDB and SQLite all have savepoints, with the same three statements: `SAVEPOINT name`, `RELEASE SAVEPOINT name` and `ROLLBACK TO SAVEPOINT name`. `ROLLBACK TO` undoes the work since the savepoint and leaves the transaction open, which on Postgres also clears the aborted state a failed statement leaves.

## Decision

### 1. A nested `transaction(cb)` always opens a savepoint

There is no mode in which the nested call joins the outer transaction, and no flag that chooses between joining and a savepoint. A caller that opens a transaction expects its work to be applied together, and a joined transaction gives up that guarantee without saying so: an inner failure that the inner code handles still leaves its earlier writes in the outer transaction.

### 2. A nested call takes no options

`tx.transaction(cb)` has one parameter.

- **No isolation level.** A database fixes the isolation level when the transaction begins and cannot change it for part of the transaction. Accepting the option and ignoring it would give the caller an isolation level other than the one it asked for.
- **No timeout.** A savepoint runs on the outer transaction's connection, so the outer transaction's deadline already covers it. When the deadline passes, `withTransaction` destroys the connection, which ends the whole transaction, and the nested call rejects with `RUNTIME.TRANSACTION_TIMEOUT`. A timeout that rolls back only the savepoint would need every driver to cancel a running statement. A timeout that ends the whole transaction adds nothing to the outer timeout.

Where the runtime has to accept options in the type, it refuses them at run time. An activity handle's `transaction(fn, options)` takes options because on the runtime or on a connection it begins a transaction. On a handle opened inside a transaction it opens a savepoint, and when it is given anything other than `undefined` as options it rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`, without starting an activity or sending anything.

### 3. One recursive transaction type in the driver

The driver interface has one transaction type, and a savepoint has the same type (`packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts`):

```ts
export interface SqlTransaction extends SqlQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<SqlTransaction>;
}
```

| Call | On a transaction | On a savepoint `name` |
|---|---|---|
| `savepoint(n)` | `SAVEPOINT n`, returns savepoint `n` | `SAVEPOINT n`, returns savepoint `n` above this one |
| `commit()` | `COMMIT` | `RELEASE SAVEPOINT name` |
| `rollback()` | `ROLLBACK` | `ROLLBACK TO SAVEPOINT name` |
| `query`, `execute` | on the transaction's connection | on the same connection |

The method is required. Every SQL target has savepoints, so there is no capability flag for them. The driver sends the three statements the way it sends `BEGIN`, `COMMIT` and `ROLLBACK`: the Postgres driver takes its per-client query lock for each, and MySQL runs them under its connection lock. The driver does not check the name; the runtime generates it. Settling a savepoint does not change the connection's transaction state in the driver: the connection is still in a transaction until the outer `COMMIT` or `ROLLBACK`.

Because a transaction and a savepoint have one type, the runtime writes its settle logic once, against that type, and uses it at every level.

### 4. `transaction()` on every runtime scope

Every runtime scope that can open a transaction does it with a member named `transaction`, and what it opens depends on the scope:

| Scope | `transaction` | Opens |
|---|---|---|
| `RuntimeConnection` | `transaction(options?)` | a transaction (`BEGIN`) |
| `RuntimeTransaction`, a transaction or a savepoint | `transaction()` | a savepoint of it |
| `TransactionContext`, the `tx` of `withTransaction` and every nested context | `transaction(fn)` | a savepoint, settled when `fn` settles |
| `ActivityHandle` on the runtime, or on a held connection with no open transaction | `transaction(fn, options?)` | a transaction beneath the handle's activity |
| `ActivityHandle` on a transaction, a savepoint, a `withTransaction` context, a handle nested in one of those, or a held connection whose transaction was open when the handle started | `transaction(fn, options?)` | a savepoint beneath the handle's activity; options are refused (§ 2) |

`ActivityHandle.inTransaction()` returns whether a transaction activity is among the handle's ancestors, so a client can tell which row applies before it passes options.

A `RuntimeTransaction` and a savepoint are two classes on one base (`packages/2-sql-family/5-runtime/src/runtime-transaction.ts`). The base holds what is the same at every level: the statement members, `transaction()`, and the check before work. `OuterTransaction` sends `COMMIT` and `ROLLBACK` and owns what only the outermost transaction has: the deadline, the connection's open-transaction record and the cleanup when the connection is released or destroyed. `Savepoint` sends `RELEASE` and `ROLLBACK TO`.

### 5. The transaction context's `transaction(fn)` holds the savepoint logic, and each facade wraps it

The context that `withTransaction` passes to its callback has `transaction(fn)`:

```ts
export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
  transaction<R>(fn: (tx: TransactionContext) => PromiseLike<R>): Promise<R>;
}
```

It opens the savepoint, builds the nested context, calls `fn` and settles the savepoint with the same settle sequence `withTransaction` uses for the outer transaction (§ 8). The nested context is guarded as `tx` is: once its callback has settled, or once the transaction it is in closes, `invalidated` is `true` and its work rejects with `RUNTIME.TRANSACTION_CLOSED` before anything reaches the driver.

A facade adds its own members to the runtime's context, so the nested callback must get a context with those members too. Each facade builds its context with one function and gives it a `transaction` member that calls the runtime context's `transaction` and builds the facade's context again for the nested one (`packages/3-targets/postgres/9-facade/src/runtime/postgres-members.ts`):

```ts
function buildTransactionContext(txCtx: TransactionContext): PostgresTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...buildPostgresQueryMembers(/* … */, txCtx),
    enums,
    nativeEnums,
    transaction: (fn) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  });
}
```

The MySQL, MariaDB, SQLite and Supabase facades do the same. `SupabaseTransactionContext` is `PostgresTransactionContext`. Supabase binds the role and JWT claims with session-scoped settings before the transaction begins and resets them when the connection is given back, so savepoints leave them unchanged.

### 6. One savepoint open per level, and work below it fails fast

A savepoint applies to whatever runs on the connection while it is open. Two consequences follow:

- Work sent on the enclosing transaction while a savepoint is open runs inside the savepoint on the database, so the savepoint's `ROLLBACK TO` would undo it.
- Two sibling savepoints opened at the same time share the connection, so one sibling's `ROLLBACK TO` would undo the other's statements.

The runtime therefore keeps, per transaction, a stack of the open levels: the outer transaction, then each open savepoint (`TransactionStack` in `packages/2-sql-family/5-runtime/src/transaction-stack.ts`). Only the top of the stack accepts work. A statement, `commit()`, `rollback()` or `transaction()` on a level below the top rejects with `RUNTIME.TRANSACTION_SUSPENDED` and sends nothing. So does a statement sent on the connection while its transaction has a savepoint open, because the connection sends its statements through the open transaction. The error's message names the innermost open savepoint, and its details carry that savepoint's activity ID as `savepointId`. The level can be used again once the savepoints above it settle.

`transaction()` pushes the new savepoint onto the stack before its first `await`, so the second of two concurrent `transaction()` calls on one level is refused as suspended, and `Promise.all([tx.transaction(a), tx.transaction(b)])` rejects for `b`. Only a level's own `commit()` or `rollback()` removes it from the stack.

A level that is closed reports `RUNTIME.TRANSACTION_CLOSED`, not `RUNTIME.TRANSACTION_SUSPENDED`. A savepoint is closed once it has settled, or once the outer transaction has settled, timed out or been invalidated.

The one exception to "settle from the top" is the outer transaction's timeout. After the deadline passes, the callback, and any savepoint it opened, may still be running, so the outer transaction can end with savepoints still open: its `rollback()` is allowed then and sends `ROLLBACK`, and so is the cleanup when its connection is released or destroyed, which is what `withTransaction` does on a timeout. Either ends only the outer transaction's activity. The open savepoints then refuse work with `RUNTIME.TRANSACTION_CLOSED`, and the nested call's `rollback()` sends nothing and ends the savepoint's activity.

A consequence for users: while an ORM write of several statements runs in its savepoint, other work sent on the same `tx` rejects with `RUNTIME.TRANSACTION_SUSPENDED`. Each call on `tx` is awaited before the next starts when one of them is such a write.

### 7. Savepoint names come from a counter per transaction

Savepoints are named `sp_1`, `sp_2` and so on, from a counter kept with the transaction's stack. It starts at 1 when the transaction begins and only goes up. `COMMIT` and `ROLLBACK` remove every savepoint of a transaction, so the next transaction on the connection starts at `sp_1` again. Within one transaction a name is never reused, so it never refers to an earlier savepoint.

### 8. How a nested call settles

| What happens | What the nested call does |
|---|---|
| The callback resolves | `RELEASE SAVEPOINT`, then resolves with the callback's result. |
| The callback throws | `ROLLBACK TO SAVEPOINT`, then rejects with the callback's error unchanged. The enclosing context can be used again. |
| `RELEASE` fails | `ROLLBACK TO SAVEPOINT`, then rejects with `RUNTIME.TRANSACTION_COMMIT_FAILED`, with the `RELEASE` error as `cause`. When the rollback succeeded, the enclosing context can be used again. On Postgres this is the path of a callback that caught a failed statement and returned, because Postgres refuses `RELEASE` in an aborted transaction. |
| `ROLLBACK TO` fails after the callback threw | Rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, with the callback's error as `cause` and the rollback error in its details. |
| `ROLLBACK TO` fails, in either row above | The database state is unknown, so the runtime invalidates the whole stack. Every enclosing level rejects work with `RUNTIME.TRANSACTION_CLOSED`, the outer `rollback()` rejects with it without sending `ROLLBACK`, and `withTransaction` destroys the connection. |
| An `activityStarted` hook refuses the savepoint | Nothing is sent, the callback is not called, the call rejects with the hook's error, and the enclosing context can be used again. A failed `SAVEPOINT` statement is handled the same way. |
| `RELEASE` resolved, then an `activityEnded` hook throws | Rejects with the hook's error. The savepoint was released, so no `ROLLBACK TO` is sent. |
| `ROLLBACK TO` resolved, then an `activityEnded` hook throws | Rejects with the callback's error; the hook's error is logged as `middleware.activityEnded.error`. |
| The outer deadline passes while the callback runs | Rejects with `RUNTIME.TRANSACTION_TIMEOUT` without waiting for the callback, and ends the savepoint's activity. |

These rules are the outer transaction's rules from `withTransaction`, applied to one level, and the error codes are the same: a nested call reuses `RUNTIME.TRANSACTION_COMMIT_FAILED` and `RUNTIME.TRANSACTION_ROLLBACK_FAILED` rather than adding savepoint-specific codes.

A nested call that the enclosing callback does not await, and that is still running when the enclosing callback returns, leaves the enclosing level unable to settle: its `commit()` and `rollback()` are refused as suspended. The settle sequence then invalidates the stack, the enclosing call rejects with `RUNTIME.TRANSACTION_COMMIT_FAILED`, every context of the transaction is closed, and the connection is destroyed.

### 9. Middleware sees each savepoint as a transaction activity

A savepoint is a `'transaction'` activity beneath the activity it was opened on: the enclosing transaction or savepoint, or the activity handle that opened it. Its `SAVEPOINT`, `RELEASE` and `ROLLBACK TO` statements are sent by the driver and never reach middleware as statement activities. A middleware recognizes a savepoint with `activity.kind === 'transaction' && ctx.inTransaction()`; `TransactionActivity` has no field for it.

A released savepoint and its activities are finalized with the outermost transaction's outcome when that transaction ends. A rolled-back savepoint and its activities are finalized `rolled-back` at once, and its failed statements do not make the outer commit `unknown`. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) § "When an activity is finalized" records these rules and why they differ.

### 10. ORM writes of several statements run in a savepoint inside a transaction

The ORM's statement graph runner opens a transaction for a write of more than one statement with the `transaction(fn, options)` member of the call's `orm-call` activity handle (`packages/3-extensions/sql-orm-client/src/statement-graph/run-graph.ts`). Outside a transaction it passes the client's `implicitTransactionOptions`, such as the MySQL facade's `isolationLevel: 'ReadCommitted'`, and gets a transaction. When the handle's `inTransaction()` is true, it passes no options and gets a savepoint beneath the call's activity. This applies whichever API opened the transaction: `db.transaction(cb)`, a nested context, or a held connection.

When a statement of the write fails, the savepoint is rolled back and the write rejects with the statement's error, so none of its rows stay, and on Postgres the transaction is no longer aborted. When the database ends the whole transaction with the error, such as an InnoDB deadlock or a SQLite error that rolls the transaction back, `ROLLBACK TO` fails and the write rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, whose `cause` is the database's error (§ 8).

A read of several statements and a single-statement write open no savepoint.

## Out of scope

- **Databases without savepoints**, such as Spanner, Redshift, Snowflake and BigQuery, and **databases without `RELEASE SAVEPOINT`**, such as SQL Server and Oracle. None is a target. If one becomes a target, making `SqlTransaction.savepoint` optional is a non-breaking change for code that calls the driver.
- **MongoDB**: its runtime has no transactions.
- **A user-facing API for named savepoints**, where the user names a savepoint and rolls back to it by name. `tx.transaction(cb)` names its savepoints itself and settles them when the callback settles.

## Consequences

- Code that opens its own transaction can be called inside another transaction without changing, and its work is still applied together or not at all.
- A single ORM call is atomic whether or not it runs inside a user's transaction, on every SQL target.
- Concurrent work on one transaction context, which worked before when it did not involve a write of several statements, can now reject with `RUNTIME.TRANSACTION_SUSPENDED` when a nested call or such a write is running. The error names the open savepoint.
- Every `SqlTransaction` implementation, including test stubs, implements `savepoint(name)`.
- A new facade adds `transaction` to its transaction context as § 5 shows, or its nested callback receives the runtime's context without the facade's members.
- A middleware that treats every `'transaction'` activity as a top-level transaction sees savepoints as well, and filters them with `ctx.inTransaction()` when it needs only the outermost.

## Alternatives considered

- **Join the outer transaction by default, or offer a flag that chooses between joining and a savepoint.** A joined inner transaction gives up its own atomicity without saying so: a failure the inner code handles leaves its earlier writes in place, and an inner rollback that is swallowed is the usual complaint about this design. A flag adds a choice every caller has to understand, for a mode that should not be the default. Rejected.
- **Accept an isolation level or a timeout on the nested call and ignore it.** The caller would get an isolation level or timeout other than the one it asked for, with no error. Rejected; the user-facing call has no options parameter, and the handle refuses them.
- **Make sibling savepoints wait for each other.** The statements would run in a different order from the one the code reads in, and the bug of sharing one transaction between concurrent tasks would be hidden instead of reported. Rejected for failing fast with `RUNTIME.TRANSACTION_SUSPENDED`.
- **A separate driver type for a savepoint, such as `SqlSavepoint { release() }`, beside `SqlTransaction`.** The runtime would rebuild the single shape on top of the two, to write its settle logic once. Rejected for one recursive `SqlTransaction`.
- **The runtime sends `SAVEPOINT`, `RELEASE` and `ROLLBACK TO` as ordinary statements.** They would skip the driver's lock and its transaction state, and middleware would see them as user statements. Rejected; the driver sends them.
- **A capability flag for savepoints.** Every SQL target supports them with the same syntax. Rejected; the method is required, and making it optional later is non-breaking.
- **A separate `savepoint()` member on runtime transactions, beside `transaction(options)`.** The ORM would choose between two methods instead of passing or leaving out options, and a transaction and a savepoint would have two interfaces for one operation. Rejected for `transaction()` on every scope.
- **An exported function `withSavepoint(txCtx, fn, buildMembers)` that facades call.** It receives only the context, so the context would have to carry its transaction under a hidden member, with a type guard for objects without it. The context is built from its transaction, so it has the method itself. Rejected for `TransactionContext.transaction(fn)`.
- **Savepoints invisible to middleware.** Writes undone by a savepoint would be finalized `committed`, and one recovered failure would make every statement in the outer transaction `unknown`. Rejected for a transaction activity per savepoint ([ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md)).
- **Savepoint names unique per connection.** A transaction removes all its savepoints when it ends, so names need to be unique only within a transaction. Rejected for a counter per transaction.
