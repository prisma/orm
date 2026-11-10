# SQL callback transaction isolation

PostgreSQL (pooled and serverless), SQLite, MySQL, and Supabase role-bound clients support `transaction(callback, options?)`. Factory `transactionOptions` provides defaults for explicit callbacks only.

```typescript
const db = postgres({ contract, url, transactionOptions: { isolationLevel: 'RepeatableRead' } });
const rows = await db.transaction(
  (tx) => tx.orm.public.User.select('id').all(),
  { isolationLevel: 'Serializable' },
);
```

## Resolution and validation

A defined per-call `isolationLevel` overrides the factory level. An omitted property or explicit `undefined` inherits the factory level. Without either, the database/session default applies; `{}` does not reset a configured default. `transactionOptions: undefined` is accepted. Null options, null levels, unsupported levels, wrong primitives, and unknown option keys reject with `RUNTIME.ARGUMENT_INVALID`. Globals are validated during construction; local options are validated before connection or role-session acquisition and before the callback runs.

Defaults remain in facade closures, not shared runtime/driver state. Manual runtime starts and ORM-owned implicit transactions do not inherit them. ORM work inside an explicit transaction participates in it without another BEGIN or isolation reset. Consume lazy query results within the callback.

| Facade | Option type | Supported levels | Database behavior |
| --- | --- | --- | --- |
| PostgreSQL pooled/serverless | `PostgresTransactionOptions` | ReadUncommitted, ReadCommitted, RepeatableRead, Serializable | PostgreSQL treats ReadUncommitted as ReadCommitted. Selected starts use fixed BEGIN variants. |
| SQLite | `SqliteTransactionOptions` | Serializable | Plain BEGIN, unchanged transaction mode; no isolation PRAGMA. |
| MySQL | `MysqlTransactionOptions` | ReadUncommitted, ReadCommitted, RepeatableRead, Serializable | Selected explicit starts use SET TRANSACTION then BEGIN; unconfigured explicit/manual starts use the server/session default. ORM-owned starts select ReadCommitted. |
| Supabase role-bound app root | `PostgresTransactionOptions` | Same as PostgreSQL | Role/claims setup and selected BEGIN use the same session; reset or destruction retains existing ownership rules. |

**MySQL default change:** sessions no longer receive a blanket READ COMMITTED override. Applications relying on it for explicit callbacks can set `transactionOptions: { isolationLevel: 'ReadCommitted' }`. Implicit ORM transactions retain ReadCommitted independently. UTC session setup remains. No isolation choice is persisted as a session default.

Supabase's `.supabase` secondary root still has no callback transaction API. Its implicit activity transactions retain role sessions, without app callback defaults.

## Driver and runtime start SPI

`SqlConnection.beginTransaction(start?)`, runtime connection `transaction(start?)`, and activity transaction routes carry `SqlTransactionStart`:

```typescript
type SqlTransactionStart =
  | { readonly kind: 'explicit'; readonly isolationLevel?: string | undefined }
  | { readonly kind: 'implicit' };
```

Shared code forwards intent, not database policy or SQL fragments. Facades validate public options with target-owned schemas and pass resolved options to `withTransaction(runtime, callback, resolvedOptions)`. That helper produces an explicit start. ORM-owned starts use the implicit variant. Role/session wrappers must forward the optional input, including through activity-owned routes, while retaining refusal/settlement metadata.

Drivers validate defined explicit levels against their target, then select fixed SQL. MySQL's SET TRANSACTION and BEGIN must share one connection query lock. A failed BEGIN after successful SET can leave a pending next-transaction setting: the owner must destroy an uncertain connection, not return it to the pool. Release is safe after a known pre-BEGIN refusal or confirmed settlement; uncertain rollback also requires destruction. Cleanup failures must not replace an existing setup error. Existing callback rollback-failure wrapping remains unchanged.

## Deliberately unsupported

This API does not add batch transactions, timeout/maxWait options, P2028 behavior, retries, nested transactions/savepoints, or Mongo transaction support. Isolation does not imply these features.

See the [transaction scorecard](../../scorecard/14-transactions.md) for per-database evidence and the [runtime subsystem](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#transactions) for lifecycle semantics.
