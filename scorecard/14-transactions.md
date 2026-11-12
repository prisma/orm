# Transactions

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `transaction(fn)` (atomic commit/rollback) | ✅ | ✅ | — | `test/e2e/framework/test/transaction.test.ts` (`withTransaction`, the runtime primitive `transaction(fn)` delegates to); `test/e2e/framework/test/transaction-orm.test.ts` (`db.transaction` commit/rollback); `test/e2e/framework/test/sqlite/transaction.test.ts` (`db.transaction`) |
| ORM operations inside a transaction (read-your-own-write) | ✅ | ✅ | — | `test/e2e/framework/test/transaction-orm.test.ts`; `test/e2e/framework/test/sqlite/transaction.test.ts` (`read-your-own-write`) |
| Prepared statements (`prepare(decl, cb)`) | ✅ | ✅ | — | `test/e2e/framework/test/runtime.prepared.test.ts`; `test/e2e/framework/test/sqlite/prepared.test.ts` |
| Callback `isolationLevel` | Works | Works (Serializable only) | — | `packages/3-targets/postgres/9-facade/test/transaction-isolation.integration.test.ts`; `packages/3-targets/postgres/3-driver/test/driver.isolation.integration.test.ts`; `packages/3-targets/sqlite/9-facade/test/transaction.test.ts`; `packages/3-targets/sqlite/3-driver/test/transaction-isolation.test.ts` |
| Batch transaction isolation | Not in 8.0 | Not in 8.0 | — | No batch transaction API is added. |
| Callback `timeout` | Works | Works | — | `packages/3-targets/postgres/9-facade/test/transaction-isolation.integration.test.ts` (dev transport, pooled/serverless); `packages/3-targets/postgres/9-facade/test/transaction-timeout.integration.test.ts` (native PostgreSQL with POSTGRES_TIMEOUT_TEST_URL); `packages/3-targets/sqlite/9-facade/test/transaction-members.test.ts` (actual SQLite ORM rollback and late-work refusal) |
| `P2028` compatibility | Not in 8.0 | Not in 8.0 | — | Structured runtime timeout errors, not P2028. |
| `maxWait` (+ `P2028`) | ❌ | ❌ | — | |
| Explicit-callback `transactionOptions` defaults | Works | Works (Serializable only) | — | `packages/3-targets/postgres/9-facade/test/transaction-isolation.integration.test.ts` (pooled/serverless, override/manual baseline); `packages/3-targets/sqlite/9-facade/test/transaction.test.ts` (real driver defaults/overrides) |
| Nested interactive transactions (savepoints) | ❌ | ❌ | — | |
| Write-conflict surfacing (`P2034`) | ❌ | ❌ | — | |

## Additional target evidence

| Surface | Status | Evidence and limits |
| --- | --- | --- |
| MySQL four actual isolation levels and one-shot pool reuse | Works | `packages/3-targets/mysql/1-mysql/3-driver/test/transaction-isolation.live.test.ts`: dirty-read distinction, repeatable snapshot, Serializable locking, configured READ UNCOMMITTED baseline, size-one reuse and failed SET/BEGIN eviction. Requires MYSQL_URL; executed on MySQL 8.4.13. |
| MySQL explicit callback defaults and implicit ORM ownership | Works | `packages/3-targets/mysql/1-mysql/9-facade/test/runtime/transaction-isolation.live.test.ts`: actual root/held ORM transactions, explicit Serializable participation, manual no-default start and callback-owned failure destruction. Precedence/validation matrix additionally covered by unit tests. |
| Supabase callback isolation forwarding and defaults | Untested at database integration tier | `packages/3-extensions/supabase/test/transaction-members.test.ts`, `supabase-runtime.transaction-activity.test.ts`, and `supabase-runtime.isolation-failures.test.ts` prove same-session role/start forwarding and cleanup using recording transports. PostgreSQL evidence does not substitute for a Supabase database-specific isolation test. |

Native PostgreSQL timeout evidence uses both pooled and direct/serverless public APIs: parked cursor closure, in-flight statistics execution, hung callback rejection after cleanup, same-PID reuse, and refusal of escaped results. A separate case injects rollback failure on an actual direct connection and proves disconnection plus explicit fresh driver binding; it is not a naturally occurring network-failure test. Executed on PostgreSQL 17.11; that version is evidence, not a requirement. The native tests skip without POSTGRES_TIMEOUT_TEST_URL.

MySQL callback timeout rollback, late ORM refusal, reuse and unchanged implicit ReadCommitted are covered by `packages/3-targets/mysql/1-mysql/9-facade/test/runtime/transaction-isolation.live.test.ts`, executed on MySQL 8.4.13 with MYSQL_URL. Supabase timeout forwarding, post-BEGIN setup, both implicit roots and reset-or-destroy ownership are proven by recording-transport `test/transaction-members.test.ts`, not a native Supabase timeout acceptance run.

PostgreSQL ReadUncommitted is effectively ReadCommitted; MySQL ReadUncommitted permits dirty reads. SQLite accepts only Serializable without changing BEGIN or PRAGMAs. MySQL explicit unconfigured callbacks intentionally use the server/session default, not a blanket READ COMMITTED session override; implicit ORM starts retain ReadCommitted. See [API, validation and SPI rules](../docs/reference/transaction-isolation.md). [Callback timeout](../docs/reference/transaction-isolation.md#timeout) is an application deadline from successful BEGIN to commit admission, not wire cancellation or a hard rejection bound. Local undefined inherits and null disables timeout, unlike isolation null; defaults affect callbacks only. These claims do not imply maxWait/P2028, retry, savepoint or batch support.
