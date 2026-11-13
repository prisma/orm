# SQL callback transaction options

PostgreSQL (pooled and serverless), SQLite, MySQL, and Supabase role-bound clients support `transaction(callback, options?)`. Factory `transactionOptions` provides defaults for explicit callbacks only.

```typescript
import postgres, { IsolationLevel } from '@prisma/orm-postgres/runtime';

const db = postgres({ contract, url, transactionOptions: { isolationLevel: IsolationLevel.RepeatableRead, timeout: 5000 } });
const rows = await db.transaction(
  (tx) => tx.orm.public.User.select('id').all(),
  { isolationLevel: IsolationLevel.Serializable },
);
```

Each facade runtime exports a named `IsolationLevel` const object: `@prisma/orm-postgres/runtime`, `@prisma/orm-mysql/runtime`, `@prisma/orm-sqlite/runtime`, and `@prisma/orm-extension-supabase/runtime`. PostgreSQL's `/serverless` entry exports the same object as `/runtime`; Supabase reuses that PostgreSQL object too. PostgreSQL/MySQL expose all four supported keys, while SQLite exposes only `Serializable`. Values remain string literals, so existing string inputs are still accepted. The supported type and validator are derived from each target's object, not a TypeScript enum.

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

## Timeout

Factory `transactionOptions` and per-call options accept `timeout` as integer milliseconds in `1..2147483647`, with no finite default. Global omission, `undefined` or `null` disables it; local omission/`undefined` inherits and local `null` disables it independently of isolation (`isolationLevel: null` remains invalid). These defaults apply only to explicit callbacks.

The clock starts after successful BEGIN, includes post-BEGIN setup, and stops when commit starts. Expiry invalidates transaction access and rejects with `RUNTIME.TRANSACTION_TIMEOUT` after safe cleanup, without awaiting a hung callback. If rollback fails, rejection is `RUNTIME.TRANSACTION_ROLLBACK_FAILED` with the selected timeout as its cause. Acquisition/BEGIN and commit duration are excluded. This is not wire cancellation, JavaScript termination or a hard rejection-time bound: blocked JavaScript and safe cleanup can delay rejection.

## Driver and runtime start SPI

Driver `SqlConnection.beginTransaction(options?)` receives isolation-only `SqlTransactionOptions`:

```typescript
interface SqlTransactionOptions {
  readonly isolationLevel?: string | undefined;
}
```

Shared runtime code forwards resolved options, not ORM ownership or database policy. Facades validate public options with target-owned schemas and pass resolved options to `withTransaction(runtime, callback, resolvedOptions)`. Runtime connection/activity starts accept `RuntimeTransactionOptions`, including timeout; the runtime strips timeout before driver BEGIN. The returned transaction owns its deadline and exposes a readonly AbortSignal, which `withTransaction` observes for expiry. Role/session wrappers forward runtime options and preserve that signal; see [runtime wrapper contract](../../packages/2-sql-family/5-runtime/README.md#internal-callback-deadlines). They retain refusal/settlement metadata.

ORM factories separately accept `implicitTransactionOptions`, retained in collection configuration and used only when the ORM opens a transaction. The MySQL facade supplies `{ isolationLevel: 'ReadCommitted' }` to its root ORM factory. Standalone ORM instances may opt into this policy; without it they request the database default. Namespace collections, nested writes and activity-bound execution preserve the configured options. An ORM already bound to a transaction does not open another transaction or change its isolation. Drivers receive no implicit/explicit discriminator and never choose ORM policy.

Drivers validate supplied levels against their target, then select fixed SQL. MySQL's SET TRANSACTION and BEGIN must share one connection query lock. A failed BEGIN after successful SET can leave a pending next-transaction setting: the owner must destroy an uncertain connection, not return it to the pool. Release is safe after a known pre-BEGIN refusal or confirmed settlement; uncertain rollback also requires destruction. Cleanup failures must not replace an existing setup error. Existing callback rollback-failure wrapping remains unchanged.

## Deliberately unsupported

Batch transactions, maxWait, P2028 behavior, retries, nested transactions/savepoints and Mongo transaction support remain unsupported.

See the [transaction scorecard](../../scorecard/14-transactions.md) for per-database evidence and the [runtime subsystem](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md#transactions) for lifecycle semantics.
