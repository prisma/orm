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
| `isolationLevel` (batch + interactive) | ❌ | ❌ | — | |
| `timeout` (+ `P2028`) | ❌ | ❌ | — | |
| `maxWait` (+ `P2028`) | ❌ | ❌ | — | |
| Client-level `transactionOptions` defaults | ❌ | ❌ | — | |
| Nested interactive transactions (savepoints) | ❌ | ❌ | — | |
| Write-conflict surfacing (`P2034`) | ❌ | ❌ | — | |
