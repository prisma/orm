# non-ported: interactive-transactions (individual non-portable tests)

Source: `packages/client/tests/functional/interactive-transactions/tests.ts`

Note: Most interactive-transaction tests ARE ported (see the `.test.ts` file in
`functional/interactive-transactions/`). The non-portable tests are listed here.

---

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `timeout default` — subject: interactive transaction times out after the 5000ms default and rejects with Prisma error code P2028 — non-ported (Prisma 8's `transaction()` facade accepts no timeout option; the 5-second default timeout mechanism is absent)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `timeout override` — subject: `$transaction(fn, { maxWait, timeout })` respects a custom timeout and rejects when the callback exceeds it — non-ported (no `timeout`/`maxWait` options on Prisma 8 `transaction()`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `timeout override by PrismaClient` — subject: a `PrismaClient` constructed with `transactionOptions: { timeout }` enforces that timeout for all its transactions — non-ported (no per-client transaction options in Prisma 8; no `newPrismaClient` equivalent)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `postgresql: nested create` — subject: `$transaction` called inside another `$transaction`'s callback creates a nested transaction context (both commits succeed) — non-ported (Prisma 8 `transaction()` gives a `tx` with `tx.orm`/`tx.sql` but no `tx.transaction()`; nested interactive transactions are absent from the facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: nested rollback` — subject: throwing in a nested `tx.$transaction()` rolls back the nested write but the outer transaction can still roll back too — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: nested rollback restores parent state (savepoints, 3 levels)` — subject: 3-level nested $transaction with savepoints: grandchild rollback, child rollback, outer rollback, each restoring state correctly — non-ported (no nested `tx.transaction()` / savepoint support in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: nested commit keeps state (savepoints, 3 levels)` — subject: 3-level nested $transaction: all commit successfully and all rows are visible — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: disallow concurrent nested transactions` — subject: concurrent `tx.$transaction()` calls within the same outer tx throw "Concurrent nested transactions are not supported" — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: allow nested transactions in concurrent top-level transactions` — subject: nested `tx.$transaction()` is allowed when each is inside its own independent top-level `$transaction` — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: nested commit keeps outer transaction open` — subject: a nested transaction commit does not close the parent transaction; the parent can still write and commit — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: sequential nested transactions work` — subject: two sequential `tx.$transaction()` calls succeed inside one outer tx — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: deep nesting (3 levels) works` — subject: 3-level nested `$transaction` (tx → tx2 → tx3) all commit — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: nested rollback can be caught and outer can continue` — subject: a caught inner `tx.$transaction()` rejection (via savepoint rollback) lets the outer tx continue and commit — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: enforce order for nested transactions` — subject: starting a nested tx and then writing on the parent without awaiting the nested tx throws "Cannot close transaction while a nested transaction is still active" — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: child fails if parent tries to commit before child finishes` — subject: the parent returning from its callback while a child transaction is still running causes the parent commit to fail with "Cannot close transaction while a nested transaction is still active" — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: child fails if parent rolls back before child finishes` — subject: a parent rolling back while a child `tx.$transaction()` is still in flight rejects the child with P2028 — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `sql: child fails if nested parent closes before grandchild finishes` — subject: a parent nested transaction closing before its grandchild finishes causes grandchild to fail with P2028 — non-ported (no nested `tx.transaction()` in Prisma 8 facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `forbidden` — subject: the transaction-bound Prisma client does not expose `$connect`, `$disconnect`, `$on`, or `$use` — non-ported (Prisma-specific client lifecycle methods have no equivalents in Prisma 8's transaction context; Prisma 8 tx exposes `tx.orm`/`tx.sql`, not a PrismaClient facade)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `already committed` — subject: using a transaction-bound client after the transaction has committed rejects with a "Transaction already closed" message and Prisma error code P2028 — non-ported (Prisma 8 does not expose a `tx` object outside the callback; the error shape is P2028-specific with Prisma's message format, no equivalent structured error in Prisma 8)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `batching` — subject: array/batch `$transaction([create, create])` creates both rows atomically — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `batching rollback` — subject: array/batch `$transaction([create, create])` rolls back on unique constraint violation — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `batching timeout override` — subject: array/batch `$transaction([...], { timeout })` respects the timeout override — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `batching raw rollback` — subject: array/batch `$transaction([$executeRaw, $queryRaw, ...])` combining raw SQL and ORM queries rolls back on duplicate-key error — non-ported (no array/batch `$transaction([...])` surface; also uses `$executeRaw`/`$queryRaw`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `concurrent` — subject: two concurrent array/batch `$transaction([create])` calls each commit their own row — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `high concurrency with SET FOR UPDATE` — subject: 12 concurrent interactive transactions using `$queryRaw SELECT ... FOR UPDATE` to lock a row then update its `val` — non-ported (`$queryRaw` is the subject; the raw-SQL execution path inside a transaction is absent from Prisma 8's ORM)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `isolation levels > read committed` — subject: `$transaction(fn, { isolationLevel: ReadCommitted })` executes with READ COMMITTED isolation — non-ported (no `isolationLevel` option on Prisma 8 `transaction()`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `isolation levels > read uncommitted` — subject: `$transaction(fn, { isolationLevel: ReadUncommitted })` executes with READ UNCOMMITTED isolation — non-ported (no `isolationLevel` option on Prisma 8 `transaction()`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `isolation levels > repeatable read` — subject: `$transaction(fn, { isolationLevel: RepeatableRead })` executes with REPEATABLE READ isolation — non-ported (no `isolationLevel` option on Prisma 8 `transaction()`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `isolation levels > serializable` — subject: `$transaction(fn, { isolationLevel: Serializable })` executes with SERIALIZABLE isolation — non-ported (no `isolationLevel` option on Prisma 8 `transaction()`)

- `packages/client/tests/functional/interactive-transactions/tests.ts` › `isolation levels > invalid value` — subject: `$transaction(fn, { isolationLevel: 'NotAValidLevel' })` type-errors at compile time and rejects with P2023 at runtime — non-ported (no `isolationLevel` option on Prisma 8 `transaction()`; no equivalent error code)
