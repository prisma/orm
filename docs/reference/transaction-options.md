# SQL transaction options

PostgreSQL (pooled and serverless), SQLite, MySQL and Supabase role-bound clients support `transaction(callback, options?)`. Factory `transactionOptions` supplies defaults for explicit callbacks only; ORM work inside the callback participates in that transaction. Consume lazy query results inside the callback.

```typescript
import postgres, { IsolationLevel } from '@prisma/orm-postgres/runtime';

const db = postgres({ contract, url, transactionOptions: { isolationLevel: IsolationLevel.RepeatableRead, timeout: 5000 } });
const rows = await db.transaction(
  (tx) => tx.orm.public.User.select('id').all(),
  { isolationLevel: IsolationLevel.Serializable },
);
```

## Isolation level

Import `IsolationLevel` from your facade's `/runtime` entry (also available from PostgreSQL's `/serverless` entry), or use the string literals below. A per-call level overrides the factory level; omission or `undefined` inherits it. Without either, the database/session default applies. Null or unsupported levels and unknown options are rejected before acquiring a connection or invoking the callback.

| Facade | Option type | Supported levels | Notes |
| --- | --- | --- | --- |
| PostgreSQL pooled/serverless | `PostgresTransactionOptions` | ReadUncommitted, ReadCommitted, RepeatableRead, Serializable | ReadUncommitted behaves as ReadCommitted. |
| SQLite | `SqliteTransactionOptions` | Serializable | Transaction mode is unchanged. |
| MySQL | `MysqlTransactionOptions` | ReadUncommitted, ReadCommitted, RepeatableRead, Serializable | Unconfigured explicit transactions use the session default; implicit ORM transactions use ReadCommitted. |
| Supabase role-bound clients | `PostgresTransactionOptions` | Same as PostgreSQL | Use `transaction` on the role-bound application client, not its `.supabase` secondary root. |

## Timeout

`timeout` accepts integer milliseconds in `1..2147483647`. There is no finite default: global omission, `undefined` or `null` disables it. Local omission/`undefined` inherits the factory timeout; local `null` disables it independently of isolation. These defaults do not apply to manual or implicit ORM transactions.

The clock starts after successful BEGIN, includes post-BEGIN setup, and stops at commit admission. On expiry, transaction access is invalidated and the connection is destroyed, not rolled back and released for reuse. The callback rejects with `RUNTIME.TRANSACTION_TIMEOUT` after disposal, without waiting for callback JavaScript; disposal failures do not replace that error. Pooled clients can acquire a fresh connection; a direct PostgreSQL client must reconnect with a fresh binding or be recreated.

Acquisition/BEGIN and admitted COMMIT duration are excluded. A blocked event loop (including synchronous SQLite work) and connection disposal can delay rejection. Timeout does not terminate JavaScript or external side effects and is not a hard rejection-time bound. Ordinary callback errors still use normal rollback cleanup.
