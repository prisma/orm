# Slice spec: a statement sent on a single-connection Postgres client waits for an open transaction to end

- Linear ticket: [TML-3893](https://linear.app/prisma-company/issue/TML-3893/postgres-serverless-client-a-query-sent-outside-an-open-transaction)
- Kind: one slice, one pull request, no parent project. This file is the working copy of the spec; its content becomes the pull request description. It lives in the gitignored `wip/` folder and is not committed.
- Branch: `tml-3893-postgres-serverless-client-a-query-sent-outside-an`, cut from `origin/main`.
- Status: design settled with Will on 2026-11-20. Revised the same day after two reviews: [system design](./reviews/system-design-review.md) and [engineering](./reviews/engineering-review.md). Not started.
- Dispatch plan: [plan.md](./plan.md).

## Terms

- **Client**: the object a user queries through, called `db` in examples. It is returned by `postgres()`, `supabase()`, `mysql()`, `sqlite()`, or `postgresServerless().connect()`.
- **Single-connection client**: a Postgres client with exactly one physical database connection. There are three ways to make one: `postgresServerless(options).connect({ url })`; `postgres({ pg: client })` when `client` is a `pg.Client`; and `postgres({ binding: { kind: 'pgClient', client } })`. All use the driver class `PostgresDirectDriverImpl`.
- **Pooled client**: a client backed by a connection pool. `postgres({ url })`, `postgres({ pg: pool })`, `supabase()` and `mysql()` are pooled.
- **Transaction callback**: the function passed to `db.transaction(fn)`. It receives `tx`.
- **Statement on the transaction**: a statement sent through `tx`. It runs inside the transaction.
- **Statement on the client**: a statement sent through `db` (`db.query`, `db.execute`, `db.orm.*`, a prepared statement run on `db`). It must run outside every transaction.
- **Statement on the driver**: what a statement on the client becomes when the runtime passes it to the driver object itself, not to a connection the driver handed out. The decision record on the activity tree calls it a runtime-scope statement.
- **Held connection**: a connection the driver has handed out through `acquireConnection()` and not had back. A transaction runs on one.
- **Lease**: the lock in `PostgresDirectDriverImpl` (`#connectionMutex`) that `acquireConnection()` takes and holds until the connection is released. A transaction holds it from before `BEGIN` until after `COMMIT` or `ROLLBACK`. It is first-in, first-out and not re-entrant.
- **Client query lock**: a second, per-socket lock (`acquireClientQueryLock`) that lets one statement at a time use the socket. A statement holds it only while it runs.
- **Marker read**: the runtime's one-time read of the contract marker table, made before the first statement, to confirm the database matches the contract. It is on by default (`verifyMarker: 'onFirstUse'`). Every first statement shares one read.

## The defect

On a single-connection client, a statement on the client that is sent while a transaction is open goes to the same socket and runs inside that transaction. Three things go wrong, all seen in production (see the ticket for the statement logs):

1. The transaction rolls back, and a write the caller sent on the client is rolled back with it, with no error.
2. A statement on the transaction fails, Postgres marks the transaction as aborted, and the statement on the client fails with error 25P02 ("current transaction is aborted").
3. A read on the client sees the transaction's uncommitted rows.

Cause, in `packages/3-targets/postgres/3-driver/src/postgres-driver.ts`: `PostgresDirectDriverImpl.query`, `.execute` and `.explain` reach the socket through `acquireClient()` and then take the client query lock. Neither step takes the lease or looks at whether a transaction is open. So the statement is sent between the transaction's statements.

The defect is still in the code on `main` as of commit `2681eb45de`. It was reproduced on release 8.0.0-rc.23. It has not been re-run on `main`; the first dispatch does that.

## What every client must do

This code must work on every SQL client, pooled or not, including on a new connection with the marker read on:

```ts
await Promise.all([
  db.transaction(async (tx) => { await tx.query(insertUser) }),
  db.query(selectOrders),
])
```

The transaction commits or rolls back on its own. `selectOrders` runs outside it: it does not see the transaction's uncommitted rows, it is not rolled back with it, and it does not fail because of it.

State today, from reading each driver (nothing was run):

| Client | Today | Why |
| --- | --- | --- |
| `postgres({ url })`, `postgres({ pg: pool })` | Works | The statement on the client gets a different pool connection. |
| `supabase()` | Works | Pool only. `SupabaseBinding` excludes the `pg.Client` binding (`packages/3-extensions/supabase/src/runtime/supabase.ts`). |
| `mysql()` and MariaDB | Works | Pool (`packages/3-targets/mysql/1-mysql/3-driver/src/core/runtime/mysql-driver.ts`). |
| `sqlite()` | A read works. A write does not. | See "SQLite" below. |
| Single-connection Postgres clients | Broken | The defect. |

MongoDB has no `db.transaction` yet, so it is out of scope.

### SQLite

`SqliteDriver.acquireConnection()` opens a new connection to the database file, so a transaction and a statement on the client are on different connections. Each is a synchronous `node:sqlite` connection with `busy_timeout = 5000`. SQLite allows one writer at a time. Predicted from the code, not yet run: a write on the client while a transaction holds the write lock retries inside a synchronous call, which stops the whole event loop for 5 seconds, and then fails with "database is locked". The transaction cannot commit during that time, because the event loop is stopped.

This is a separate defect in the SQLite driver, which is a proof of concept. This work does not fix it. The SQLite test covers what SQLite does correctly: the `Promise.all` code above with a read on the client. The first dispatch runs the write case once to confirm the prediction, and the result is filed as its own ticket.

## Decided design

1. **A statement on the client waits.** On a single-connection client, a statement on the driver takes the lease before it does anything else. If a transaction is open or a connection is held, it waits until the lease is free, then runs on its own. Nothing is rejected.
2. **The wait lives in the driver.** `PostgresDirectDriverImpl` already owns the lease. The pool driver and the other targets are not edited.
3. **Where the lease is taken and released.** In the driver's `acquireClient()` / `releaseClient()` pair, which already brackets one statement's use of the client on every path (`query` buffered and cursor, `execute`, `explain`, prepared statements and their retries). This is the same shape as the pool driver, where that pair takes and returns a pool client.
   - The lease is taken before the closed-or-lost check, the connect, and the session-settings check. So a statement that waited behind a held connection re-applies the driver's session settings if the holder changed them, and a statement that waited through a `destroy()` is rejected with `DRIVER.NOT_CONNECTED`.
   - If anything fails after the lease is taken, the lease is released before the error is rethrown.
   - `acquireConnection()` already holds the lease when it needs the client. It must reach the client through a private step that does not take the lease again, or every transaction deadlocks.
   - For a buffered row stream, `releaseClient()` runs before the first row is yielded, so code that awaits a second statement on the client inside the stream's loop keeps working. For a cursor stream, it runs when the stream completes, fails or is returned.
4. **Lock order.** Lease first, then client query lock, on every path. That is already the order in `acquireConnection()`, `close()` and `destroy()`.
5. **The marker read must not wait on the lease while a held connection waits on it.** Today the first statement to arrive starts the marker read, on its own queryable if that queryable is held and otherwise on the driver, and every other first statement awaits the same promise. After the driver change, this order hangs: the transaction takes the lease; `db.query` starts the marker read on the driver, which waits for the lease; `tx.query` then awaits that read. This is the likely order on every new connection, not a rare race. The fix is in the SQL runtime (`packages/2-sql-family/5-runtime/src/sql-runtime.ts`, `setupDriverExecution`): a statement on a held connection or transaction never awaits a marker read that is pending on the driver. It runs its own read on its own queryable. The first read to succeed settles the check for the runtime. This is a general rule, not a single-connection rule: a pool with one connection has the same shape today.
6. **The rule is written on the driver interface.** A statement on the driver never runs on the session of a held connection; a driver with one database connection makes the statement wait. This goes in the `SqlDriver` doc comment (`packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts`) and replaces the line "Single-connection driver: serializes or rejects overlapping executes per its policy" in the Adapters & Targets document. The runtime already relies on it, and the next single-connection driver must follow it.
7. **No detection and no timeout for the mistaken call.** A statement on the client that is awaited inside the transaction callback never finishes: it waits for the transaction, the transaction waits for the callback, and the callback waits for it. This is documented and not handled. The same is true of a statement on the client awaited while the caller holds a connection from `db.runtime().connection()`.

### Why waiting, not rejecting

- `Promise.all([db.transaction(...), db.query(...)])` is correct code on a pooled client. If the statement were rejected whenever a transaction is open, the same code would pass or fail on a single-connection client depending on which arrived first.
- It keeps the rule from the decision record "A serverless Postgres connection has the same query interface as a postgres() client": code written against a client's `db` works unchanged against a connection's `db`.
- It matches what this client already does: a second `db.transaction(...)` already waits for the lease. A pool with `max: 1` already behaves exactly as the new design does.
- Prior art: among about 30 libraries checked from source, waiting is the common choice for one connection (Kysely's SQLite and PGlite dialects, postgres.js with one connection, Go's `database/sql`, Prisma 7's libSQL adapter). None rejects a statement because a transaction is open. Drizzle on a single `pg.Client` and raw `pg` have our defect.

### Why waiting while a connection is merely held

A held connection can carry session state: a database role, a changed setting. A statement on the client must not run with it. This is why the cache already skips statements on a held connection, and why the Supabase role session is built on a held connection.

### Behaviour that changes

| Code on a single-connection client | Before | After |
| --- | --- | --- |
| Statement on the client, sent by other code while a transaction is open | Runs inside the transaction | Waits, then runs outside it |
| Statement on the client, awaited inside the transaction callback | Runs inside the transaction, by accident | Never finishes |
| Statement on the client, sent by other code while a connection from `db.runtime().connection()` is held | Runs at once on the same socket, with the holder's session state | Waits for the release, then runs with the driver's session settings |
| Statement on the client, awaited by the holder of such a connection before releasing it | Runs at once | Never finishes |
| Statement on the client that waits behind a held connection whose socket then dies | Fails at once | Waits until the holder releases or destroys the connection, then is rejected with `DRIVER.NOT_CONNECTED` |
| Statement on the client whose abort signal fires while it waits for the lease | Not applicable | Still runs when the lease is free. The runtime checks the signal only before it calls the driver and between rows. |
| A cursor row stream on the client that the caller has not finished or returned | Blocks later statements on the socket | Also blocks every transaction and every later statement on the client |
| Second `db.transaction(...)`, `db.runtime().connection()`, or an ORM write that needs a transaction, while a transaction is open | Waits | Waits (unchanged) |
| Any statement when nothing is held | Runs | Runs (unchanged, one uncontended lock more) |
| First statements of a new connection, one on a transaction and one on the client, with the marker read on | Both run; the marker read may run inside the transaction | Both run; each side reads the marker on its own queryable if the other's read is still pending |

Will accepted the second row on 2026-11-20: code that calls `db.query` inside the callback is already wrong.

## Scope

### In scope

- The driver change in `packages/3-targets/postgres/3-driver`.
- The marker-read change in `packages/2-sql-family/5-runtime`.
- The `SqlDriver` doc comment in `packages/2-sql-family/4-lanes/relational-core`.
- Tests on every SQL client (see "Tests"), and rewrites of the four existing driver tests that hang or assert the defect.
- Documents (see "Documents").
- Upgrade instructions that say what callers must change.

### Out of scope

- Rejecting the mistaken call inside the callback. Designed and filed as TML-3899.
- A default transaction timeout.
- TML-3817 (whether a statement can run after its transaction closed).
- A connection released while its transaction is still open. `PostgresConnectionImpl.release()` frees the lease without ending the transaction on the server, so the next statement on the client runs inside the leftover transaction. The pool driver has the same gap: the pool hands the client, with its open transaction, to the next user. It is reachable only through `db.runtime().connection()` used wrongly, never through `db.transaction(fn)`. It is filed as its own ticket. Because of it, this work's claim is limited to transactions that end by `COMMIT` or `ROLLBACK`, and the driver's `inExplicitTransaction()` override stays, since that leftover case is the one case where it is still true.
- Cancelling a statement that is waiting for the lease.
- Any change to `packages/1-framework`. If the work turns out to need one, stop and tell Will.
- The SQLite write beside a transaction (see "SQLite").
- MongoDB.

## Adapter impact

Postgres: the single-`pg.Client` driver changes. Supabase, MySQL, MariaDB and SQLite get tests and no code change. All SQL targets get the marker-read change through the shared SQL runtime; for pooled drivers it changes only which queryable a first marker read runs on.

## Contract impact

None. No contract surface changes.

## Decision record

`.agents/rules/adr-writing.mdc` says a decision is changed by a new record, not by editing the old one. The last change to the serverless connection record was made that way ("connect() on a client is safe to call again"). So this work writes one short new record: on a single-connection client, a statement on the client waits for a held connection to be released, and a statement on the driver never runs on a held connection's session. It carries the behaviour table above and the alternatives (rejecting; a timeout; detection inside the callback, with a pointer to TML-3899).

- The serverless connection record (ADR 263) gets a status line pointing to the new record for its section "Three rules that follow from one database connection", its "Costs" sentence "The three rules are documented, not enforced", and its last alternative paragraph about a hand-started cursor stream.
- The activity-tree record (ADR 271) gets a status line for the sentence in its Consequences that says the direct driver runs a runtime-scope statement inside an open transaction and "that limit is unchanged".
- The index (`docs/architecture docs/ADR-INDEX.md`) gets a row for the new record and notes on the two amended rows.
- The record's number is chosen at build time, after checking `main` and open pull requests for the next free number.

## Documents

Each claim is checked against the final code, not copied from this spec.

- The new decision record and the two status lines, above.
- `docs/Serverless Deployment Guide.md`, "Known limitations".
- `docs/architecture docs/subsystems/5. Adapters & Targets.md`: the single-connection driver line (design point 6).
- `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`: in Shutdown, "Held connections are exempt", the marker paragraph (design point 5) and the sentence on what the direct Postgres driver waits for.
- `skills/prisma-8/references/runtime.md`: the published agent skill repeats the old rule, including "runs inside the open transaction without saying so".
- `examples/prisma-8-cloudflare-worker/README.md`, the line that states the old rule.
- Source comments in `postgres-driver.ts` that say a statement on the driver can run during a connection's open transaction: the `PostgresBinding` concurrency contract, `SharedTransactionState`, and the driver's `#txState`.
- The READMEs of `packages/3-targets/postgres/3-driver` and `packages/3-targets/postgres/9-facade` if they describe the behaviour.
- A search of `docs/`, `skills/`, `upgrade-instructions/`, `packages/**/README.md`, `examples/` and the driver's source comments for any other statement of the old behaviour. The superseded record on the afterTransaction stage (ADR 260) is left as it is.
- Upgrade instructions under `upgrade-instructions/pending/<name>/`: an `app` declaration with prose (move statements meant for the transaction onto `tx`; a statement on the client now waits while a transaction is open or a connection is held, and never finishes if awaited inside the callback or by the connection's holder), and an `extension` declaration with `changes: []`. The prose names only published `@prisma/orm-*` entries.
- No release-notes file. Release notes are drafted from merged pull requests when a release is cut.

## Tests

Every test is written before the code it tests. Each must fail when the behaviour it claims is broken, and the build records how each was seen to fail.

Rules for every test that starts statements on the client beside a transaction:

- `db.query(...)` does nothing until it is consumed. Start a read with `.toArray()`.
- Never await a statement on the client inside the callback.
- Capture every promise at once, with `Promise.allSettled` for the statements on the client and `.then(ok, err)` for the transaction, and assert on the settled results. Otherwise today's 25P02 rejection shows up as an unhandled rejection, which looks like a harness error.
- The statement that must fail inside the transaction must fail on every database. `SELECT 1 / 0` returns `NULL` on MySQL, MariaDB and SQLite. Use a statement that fails everywhere, such as a read from a table that does not exist, and assert in the callback that it failed.

### A. Driver: order of statements on the socket

A new file in `packages/3-targets/postgres/3-driver/test/` (the existing serialization file would pass the 500-line limit). It uses the recording fake client from `driver.pinned-client-serialization.test.ts`, extended with a per-statement hold so a test can keep `BEGIN` unanswered. Each test asserts the exact order of statements the socket receives.

| # | Test | Before the fix |
| --- | --- | --- |
| A1 | A statement on the driver sent while a transaction is open is sent after `COMMIT`; same for `ROLLBACK`. Run for each path: buffered `query`, cursor `query`, `execute`, `explain`, and `query` and `execute` with a prepared statement. | Red |
| A2 | A statement on the driver sent while `BEGIN` is still unanswered is sent after the transaction ends, not right after `BEGIN`. | Red |
| A3 | A statement on the driver sent while a connection is held with no transaction is sent after the release. | Red |
| A4 | Several statements on the driver and several transactions, started in a mixed order, run in the order they asked for the lease. | Red |
| A5 | A statement on the driver sent when nothing is held runs at once. | Green (kept behaviour) |
| A6 | A buffered row stream on the driver, with a second statement on the driver awaited inside its loop, completes. | Green (kept behaviour) |
| A7 | `close()` called while a statement on the driver waits for the lease: the statement runs, then the driver closes. | Green today, because nothing waits; must stay green |
| A8 | A statement on the driver queued after `close()` is rejected with `DRIVER.NOT_CONNECTED` and does not hang. | Green; must stay green |
| A9 | A statement on the driver that waits behind a connection which is then destroyed is rejected with `DRIVER.NOT_CONNECTED`, not with the `pg` library's own error, and does not hang. | Red |
| A10 | A cursor row stream on the driver holds the lease until it completes or is returned: `acquireConnection()` requested meanwhile waits, then runs. | Red |
| A11 | A cursor row stream on the driver sent during a transaction waits, then sends its own `BEGIN` and `COMMIT` outside the transaction. | Red |
| A12 | When the session-settings step fails for a statement on the driver, the lease is released: the next statement and `acquireConnection()` do not hang. | Green today; guards the new failure path |
| A13 | A statement on the driver that waited behind a held connection which changed a session setting runs with the driver's setting, not the holder's. | Red |

Existing tests that hang or assert the defect after the fix, and what each becomes:

| Existing test | Becomes |
| --- | --- |
| `driver.pinned-client-serialization.test.ts`, "serializes driver-level and pinned-connection statements sharing one physical client" | Asserts the new order (covered by A3; delete or rewrite). |
| same file, "destroy() on a direct driver connection ends the client without waiting for the statement in flight" | The in-flight statement is sent on the connection, not on the driver. |
| `driver.stream-portal-protection.integration.test.ts`, "root direct-driver stream preserves an acquired connection transaction for rollback" | A read on the driver sent during a connection's transaction waits, runs after the rollback, and does not return the rolled-back row. |
| same file, "a driver-level streamed query during an open connection transaction does not end it" | Same. Keep one test that a stream on the transaction itself still skips the driver's own `BEGIN`/`COMMIT` wrap. |

### B. Runtime: the marker read

In `packages/2-sql-family/5-runtime/test/`, with a fake driver whose statements on the driver wait until a held connection is released.

| # | Test | Before the runtime change |
| --- | --- | --- |
| B1 | Marker read on. A transaction is started, then a statement on the runtime, then the transaction's first statement. All settle. The transaction's marker read ran on the transaction. | Hangs (red by timeout) against a fake driver that waits |
| B2 | The reverse start order. All settle. | Green; must stay green |
| B3 | The same as B1 with a connection from `connection()` held and no transaction. | Hangs |
| B4 | The marker read on the held queryable fails (wrong marker): the statement on the held queryable is rejected with the marker error. The pending read on the driver is separate: it runs when its turn comes and rejects its own statement the same way. A failed read settles nothing for the runtime, as today. | Hangs |

### C. Every client: a statement on the client beside a transaction

One scenario, run per client against a database. The callback inserts a row through `tx` and resolves a one-way signal. The test, on that signal, starts a read and a write on the client (rules above). The callback runs one more statement on `tx` and ends. On today's single-connection driver the statements on the client queue on the socket behind that extra statement and ahead of `COMMIT` or `ROLLBACK`, because they are queued within microtasks while the extra statement waits for the network.

| # | Case | Expected |
| --- | --- | --- |
| C1 | Rollback: the callback throws. | The transaction's row is gone. The write on the client is stored. The read on the client succeeded and did not return the transaction's row. |
| C2 | Failed statement: a statement on `tx` fails, the callback asserts it failed, then throws. | The read and the write on the client both succeed. Neither fails with 25P02. |
| C3 | Commit: the callback returns. | Both rows are stored and nothing fails. No assertion on what the read returned, since it differs by client. |
| C4 | New client, marker read on, no earlier statement: `db.transaction(...)` and a read on the client started together, transaction first. | Both settle. |

Where each run lives, and how the scenario is shared:

| Client | Location | Database | Cases |
| --- | --- | --- | --- |
| `postgres({ pg: pool })`, pool `max` 2 or more | `packages/3-targets/postgres/9-facade/test/`, new `*.integration.test.ts` | `createDevDatabase()` | C1 to C3 |
| `postgresServerless().connect()` | same file | same | C1 to C3 |
| `postgres({ pg: client })` with a `pg.Client` | same file | same | C1 to C3 |
| Single-connection clients, marker read on | `test/integration/test/`, beside the `runtime.verify-marker.*` tests, where the helpers that create and sign the marker tables live | as those tests | C4 |
| `supabase()` | `packages/3-extensions/supabase/test/`, new `*.integration.test.ts` | as `nested-transactions.integration.test.ts` there | C1 to C3 |
| `mysql()` and MariaDB | body in `packages/3-targets/mysql/3-live-tests/test/suites/`, one-line runners in `test/mysql/` and `test/mariadb/`, as `nested-transactions` does | live servers | C1 to C3 |
| `sqlite()` | `packages/3-targets/sqlite/9-facade/test/`, new test, file database | file | The `Promise.all` code with a read on the client and a commit: both settle and the data is right. No write on the client (see "SQLite"). |

The scenario is written once as a target-neutral helper in `@repo/test-utils` that takes callbacks (insert on `tx`, read on the client, write on the client, the failing statement, read all rows), and each package supplies its own callbacks. This keeps four copies from drifting apart.

Expected before the fix: C1 and C2 red on the two single-connection Postgres clients, for the defect's reason. Everything else green. C4 is green today and hangs after the driver change alone; the runtime change makes it settle.

Two limits of these runs, stated so a green result is not over-read:

- `createDevDatabase()` serves every connection from one PGlite session and holds other connections' statements while a transaction is open. So the pooled Postgres run does not prove that the pool keeps the two apart; it proves the requirement holds. The live MySQL and MariaDB runs are the ones with a real second session.
- The MySQL and MariaDB tests skip when `MYSQL_URL` or `MARIADB_URL` is not set. A local run without them is reported as "not run", never as a pass. CI's "Package Tests" job starts both servers and runs them.

### D. Postgres facade: order on the socket, without a database

In `packages/3-targets/postgres/9-facade/test/`, using the mocked `pg.Client` already in `postgres-serverless.test.ts`, with `ROLLBACK` held: through the public client, a read and a write on the client started during a transaction are not sent between `BEGIN` and `ROLLBACK`. This is the exact claim of the fix, seen from the user's side, and it is deterministic.

### E. The ORM never sends a statement on the client while it holds the lease

- One new facade test on each single-connection client: a create with related rows completes, and the statement log shows a `BEGIN`, so the test is known to have held the lease.
- Existing integration tests that already run the ORM on the single-connection driver, run by path: in `test/integration/test/sql-orm-client/`, `nested-mutations`, `mn-nested-write`, `mutation-include-readback`, `nested-variant-mutations`, `nested-create-on-conflict`, `nested-update-defaults`, `create`, `update`, `upsert`, `delete`, `transaction-hook-after-commit`; in `test/integration/test/cross-package/`, `middleware-cache-write-invalidation` and `middleware-cache-orm`; and `test/e2e/framework/test/transaction-orm.test.ts`. A hidden statement on the client shows up as a timeout.
- Note: `middleware-cache-write-invalidation.test.ts` awaits a read on the client inside a transaction callback on a `pg.Client`. It passes only because the read is a cache hit and never reaches the driver. If it starts to hang, that is the "never finishes" row, not a new defect.

### F. The ticket's reproduction

The reproduction script in TML-3893 is run before and after the fix, and both outputs go in the pull request description. Database: the Docker Postgres of `examples/prisma-8-cloudflare-worker` (`pnpm db:up`) if Docker is available on this machine; otherwise `createDevDatabase()`, with the report saying which was used. The defect is about order on one socket, so both show it.

## Edge cases already known

| Case | What must hold |
| --- | --- |
| The lease is not re-entrant | `acquireConnection()` never goes through the lease-taking `acquireClient()`. |
| Wrapping the public `query()` generator instead of the acquire/release pair | Not done: it would hold the lease while the caller reads buffered rows and break A6. |
| A failure after the lease is taken | The lease is released before rethrowing (A12). |
| The closed-or-lost check | Made after the lease is taken, so a waiter sees the state left by whoever held it (A9). |
| The cursor path's fallback to a buffered read | Stays inside one acquire/release pair, so a transaction cannot start between the two. |
| The marker read | Design point 5; tests B1 to B4 and C4. |
| `PostgresUnboundDriverImpl` in `src/exports/runtime.ts` | Only delegates to the bound driver. Verified; no path around the lease. |
| Packages outside the driver load it from `dist` | `pnpm build` after every driver or runtime change, before any facade, Supabase, integration or example test. This includes both halves of the remove-the-fix check. |
| `examples/prisma-8-cloudflare-worker` | Its integration test needs Docker locally; CI's "Test Examples" job runs it. |

## Risks

- **A hidden statement on the client inside the runtime or ORM.** Both reviewers searched and found only the marker read. Section E is the check.
- **Coverage thresholds.** The driver's are 94 to 95 percent, enforced from the repository root, not by `pnpm test --coverage` inside the package. New failure paths need their own tests (A12).
- **Two marker reads on one new connection.** In the order of test B1, the marker is read twice: once on the transaction and once on the driver. That is one extra small read on the first request of a connection, only when a transaction and a statement on the client start together.

## Done when

1. Every test in sections A to E exists and is green, none is skipped or weakened, and each was seen red, or seen to hang, where this spec says so.
2. The four existing driver tests are rewritten as listed.
3. The reproduction in section F shows the defect before and the correct behaviour after.
4. Every item under "Documents" is done, and the search for the old behaviour finds nothing outside the superseded record.
5. The two tickets are filed: the SQLite write beside a transaction, with the result of the confirming run; and a connection released with its transaction open.
6. `/drive-code-review` has run on the final commit, with its findings fixed.
7. The repository's slice definition of done in `drive/calibration/dod.md` is walked item by item.

## Open questions

None.

## References

- Ticket TML-3893 (defect, reproduction, statement logs). Related: TML-3899 (rejecting the mistaken call, deferred), TML-3817, PTL-1667.
- Reviews: [system design](./reviews/system-design-review.md), [engineering](./reviews/engineering-review.md).
- `docs/architecture docs/adrs/ADR 263 - A serverless Postgres connection has the same query interface as a postgres client.md`
- `docs/architecture docs/adrs/ADR 230 - Runtime target layer session-coupled connections.md`
- `docs/architecture docs/adrs/ADR 271 - The runtime middleware observes a tree of activities, each started, ended and finalized.md`
- `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- `docs/architecture docs/subsystems/5. Adapters & Targets.md`
- `docs/Serverless Deployment Guide.md`
- `packages/3-targets/postgres/3-driver/src/postgres-driver.ts`
- `packages/2-sql-family/5-runtime/src/sql-runtime.ts` (`setupDriverExecution`, `withTransaction`)
- `packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts` (`SqlDriver`)
