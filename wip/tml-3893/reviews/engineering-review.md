# Engineering review: spec and plan for TML-3893

Reviewer stance: principal engineer, engineering only (tests, correctness of the planned change, build risks). System design is covered by another reviewer.

Verdict: the direction is buildable, and the fix in the driver is small. But the plan as written will hit a hang that its tests do not look for, and it will stop on two results that can be predicted now. Fix the five "must fix" items before dispatch 1.

## Findings, most severe first

### 1. After the fix, the spec's own `Promise.all` example hangs on a fresh connection with marker verification on (must fix before building)

Evidence:
- `packages/2-sql-family/5-runtime/src/sql-runtime.ts:876-883`. The runtime keeps one marker read for all first statements (`verifyMarkerPromise`). The first statement to arrive decides where the read runs: on its own queryable if that queryable is a held connection or transaction (line 877), otherwise on the driver. Every later statement awaits that same promise.
- `withTransaction` (`sql-runtime.ts:1782-1790`) calls `runtime.connection()`, which reaches `driver.acquireConnection()` (line 831) and takes the lease within a few microtasks. `db.query` reaches `setupDriverExecution` only after middleware, compile, lower and encode, all microtasks.
- Default `verifyMarker` is `'onFirstUse'` (line 404). A serverless connection is new per request, so every request does a first-use read.

Order of events after the planned driver change, for `Promise.all([db.transaction(async (tx) => tx.query(a)), db.query(b)])` on a new serverless connection:
1. The transaction takes the lease and sends `BEGIN`.
2. `db.query(b)` reaches `setupDriverExecution` first (no network wait), finds no marker read, and starts one on the driver. That read waits for the lease.
3. `tx.query(a)` reaches `setupDriverExecution`, finds the read already started, and awaits it.
4. The marker read waits for the lease, the lease waits for the transaction, the transaction waits for the callback, and the callback waits for the marker read. Nothing finishes.

Today the driver read does not need the lease, so it runs (inside the transaction) and everything completes.

Test B5 does not catch this: it covers only "the first statement of the connection is inside a transaction", where the read goes to the transaction. The spec's edge-case table names the marker check as the candidate, but no planned test produces the triggering order, so dispatch 2 would ship the hang.

Recommended change:
- Spec, section B: replace case 4 (see finding 8) with "new single-connection client, marker verification on, `db.transaction(...)` and `db.query(...)` started together, transaction first; then the reverse order; and the same with a connection from `db.runtime().connection()` held". Both promises must settle.
- Plan, dispatch 2: make the runtime change a planned step, not a conditional one. The smallest change: a statement on a held queryable never awaits a marker read that is running on the driver; it runs its own read on its held queryable (or the runtime records where the pending read runs and only shares it when that is safe). This is in `packages/2-sql-family/5-runtime`, which the spec already allows.

### 2. The SQLite result can be predicted, and the plan stops the build on it (must fix before building)

Evidence: `packages/3-targets/sqlite/3-driver/src/sqlite-driver.ts:57-62` opens each connection with `node:sqlite` `DatabaseSync` (synchronous) and `PRAGMA busy_timeout = 5000`. `acquireConnection()` opens a second connection (line 254-257). Journal mode is the default rollback journal.

What the shared body does on SQLite today:
- After the transaction's insert, the transaction holds SQLite's write lock. A write on the client from the other connection gets "busy". The busy handler sleeps inside the synchronous call, so the whole Node event loop stops for up to 5 seconds, then the write fails with "database is locked". The package test timeout is `timeouts.vitestPackageDefault` (500 ms base, `test/utils/src/timeouts.ts:17`), so the test also times out.
- The read on the client can make the transaction's `COMMIT` fail: the runtime decodes rows with `await` between rows, so the read's statement stays open (holding a shared lock) while the transaction's `COMMIT` runs, and `COMMIT` then waits on the busy handler.
- Order is decided by microtask counts, not by a network round trip. The callback's extra statement on `tx` is synchronous on SQLite, so the "one more statement" trick in section B gives no window. Whether the write lands before or after `COMMIT` depends on how many awaits each path has, which can change with any runtime edit.

The plan says "Stop and report if the SQLite run is red". It will be red, or green by accident, so dispatch 1 will stop. A red test cannot be committed (CI fails), and a skipped one breaks the "none skipped" rule in dispatch 2.

Recommended change: decide now. My recommendation: on SQLite, run only what is correct by design (the read on the client, and the transaction's own outcome) and leave the write beside an open write transaction to a separate ticket, stating the 5-second event-loop stall. Or ask Will once, before building, with this evidence.

### 3. Four existing tests will hang after the fix, and the spec names only one (must fix before building)

The plan says to stop when "a test hangs for a reason the spec does not name". These will trigger it:

| Test | Why it hangs after the fix |
| --- | --- |
| `packages/3-targets/postgres/3-driver/test/driver.pinned-client-serialization.test.ts:150` "serializes driver-level and pinned-connection statements sharing one physical client" (named in the spec) | Awaits a driver statement before `connection.release()`. |
| same file, line 240, "destroy() on a direct driver connection ends the client without waiting for the statement in flight" | A driver statement is blocked on `queryGate` and holds the lease, then the test awaits `driver.acquireConnection()`. Rewrite with the in-flight statement on the connection. |
| `driver.stream-portal-protection.integration.test.ts:287` "root direct-driver stream preserves an acquired connection transaction for rollback" | Awaits `queryRows(h.driver, ...)` inside an open connection transaction. |
| `driver.stream-portal-protection.integration.test.ts:361` "a driver-level streamed query during an open connection transaction does not end it" | Same. Its comment says the runtime's marker read "does exactly this mid-mutation", which supports finding 1. |

`driver.pinned-client-serialization.integration.test.ts` needs no change: none of its tests sends a driver statement while a connection is held.

Recommended change: list all four in the spec's Tests section and in dispatch 2's work. The last two assert today's defect (a driver read inside the transaction). Replace them with tests that a driver read waits until after `ROLLBACK`, and keep a test that the portal-protection wrap is still skipped inside a transaction (on `transaction.query`).

### 4. Every test outside the driver package loads the driver from `dist` (must fix before building)

Evidence: `packages/3-targets/postgres/3-driver/package.json` exports `./runtime` as `./dist/runtime.mjs`. The facade, Supabase, `test/integration`, `test/e2e` and the examples import it from there.

Why it matters: after a source change in the driver, the facade and integration tests keep running the old driver until `pnpm build` runs. Dispatch 2 would see its new tests still red after the fix. The check "removing the fix makes the dispatch 1 tests red again" would pass vacuously for facade tests if nobody rebuilds after removing and again after restoring the fix. The plan names failure mode F24 but no check does the build.

Recommended change: in dispatch 2, run `pnpm build` (whole workspace) after every driver change and before any facade, Supabase, integration or example test, including both halves of the remove-the-fix check.

### 5. Plan stop condition "the defect does not reproduce" depends on a database the plan does not name (must fix before building, small)

Dispatch 1 runs "the ticket's reproduction script against a real Postgres". Nothing in the repo starts one for package work; facade tests use `createDevDatabase()`, which is PGlite behind `@prisma/dev`. The Cloudflare example has `pnpm db:up` (Docker, port 5433). Name the database (and say whether Docker is available here); otherwise the dispatch cannot complete its "before" half.

### 6. The section B ordering claim is wrong as written; the mechanism works on Postgres for a different reason (should fix)

The spec says the extra statement on `tx` "makes the statements on the client reach the socket first". Traced through today's code, they reach the socket after that extra statement, but before `COMMIT` or `ROLLBACK`:
- After the callback signals, it calls `tx.execute(more)` at once. The test's continuation runs a microtask later and starts the client statements.
- Both paths to the driver are microtasks only (`queryAgainstQueryable`, `executeStatisticsInFlight`, `setupDriverExecution` with the marker read already settled). All microtasks run before any network callback. So the client statements queue on the client query lock while `more` waits for the network, and `ROLLBACK`/`COMMIT` queue behind them.
- So on Postgres the order is deterministic, provided the client statements are actually started (finding 7) and the marker read has settled. It is not deterministic on SQLite (finding 2).

Recommended change: fix the wording, and add one deterministic test at the seam: a facade test with the mocked `pg.Client` already used in `packages/3-targets/postgres/9-facade/test/postgres-serverless.test.ts:40-56`, gating `ROLLBACK`, asserting the recorded statement order on the socket (no client statement between `BEGIN` and `ROLLBACK`). That is the exact claim of the fix and needs no database.

### 7. "Start a read without awaiting" does nothing unless the test consumes it; unhandled rejections will mislabel the red (should fix)

Evidence: `packages/1-framework/1-core/framework-components/src/execution/async-iterable-result.ts:3,40,92`. `db.query(...)` returns an `AsyncIterableResult`, which starts only on `toArray()`, `then()` or iteration.

- The spec must say: start the read with `.toArray()`.
- Today, in case 2, the client statements reject with 25P02 while the test is still awaiting `db.transaction`. If the test keeps bare promises and awaits them later, Node reports an unhandled rejection and vitest fails the run with an error that looks like a harness failure, not the defect. Wrap them at once, for example `const outside = ready.then(() => Promise.allSettled([db.query(sel).toArray(), db.execute(ins)]))`, and assert on the settled results.
- Case 1's `db.transaction` rejection must be captured the same way (`.then(ok, err)`), so the test can await both sides with `Promise.all` without ever awaiting a client statement inside the callback.

I checked the described body for hangs after the fix: the callback awaits only `tx` statements and the signal, never a client statement, so it cannot deadlock, as long as the signal is a one-way "resolve" and the test does not await the client work before the transaction settles inside the callback.

### 8. Case 4 is green before and after the fix (should fix)

On today's single-connection driver the literal `Promise.all` code always resolves (the defect leaks rows, it does not throw). It is green in both worlds, which `.agents/rules/non-vacuous-verification.mdc` forbids. Repurpose it as the marker test from finding 1 (marker verification on, new connection): today it settles, after a naive fix it hangs, after the correct fix it settles. That gives it a reason to exist.

### 9. The case 2 failing statement only fails on Postgres (should fix)

`SELECT 1 / 0` returns `NULL` on MySQL, MariaDB and SQLite (division by zero is not an error in a `SELECT` there). On those clients the callback's `catch` never runs and case 2 silently becomes case 1. Use a statement that fails everywhere, for example a select from a table that does not exist, or an insert that breaks a constraint, and assert in the callback that it did fail.

### 10. "One shared test body" cannot be imported across these packages (should fix)

The clients live in four packages with different contracts and raw-SQL builders, and no shared package depends on all four facades. MySQL and MariaDB already have a pattern: a body in `packages/3-targets/mysql/3-live-tests/test/suites/<name>.ts` and one-line runners in `test/mysql/` and `test/mariadb/` (see `test/mysql/nested-transactions.live.test.ts`). Say so in the spec's location table. For the rest, either write a target-neutral scenario in `@repo/test-utils` that takes callbacks (insert on `tx`, read and write on the client, failing statement, table reads), or accept one copy per package and say that. Without this, four hand-written copies will drift.

### 11. B5 has no way to sign a database in the facade package (should fix)

The facade tests all pass `verifyMarker: false`. The helpers that create the marker tables and write the marker live in `test/integration` (`test/integration/test/utils.ts:126-131`, `test/integration/test/postgres-bootstrap.ts`, and `setupTestDatabase` in `packages/2-sql-family/5-runtime/test/utils.ts:184`). Options: put B5 and the finding-1 tests in `test/integration/test/` beside the `runtime.verify-marker.*` tests, using `postgres({ pg: client })` or `createTestRuntimeFromClient`; or keep them in the facade with an unsigned database and assert that the transaction rejects with the marker-missing error (which proves no hang). The spec should also say how B5 is shown able to fail: with the fix in place, temporarily route the marker read to the driver and watch it time out.

### 12. B6 may not hold a connection at all; the real ORM check is elsewhere (should fix)

Evidence: `packages/3-extensions/sql-orm-client/src/statement-graph/run-graph.ts:84-90`. The ORM opens a transaction only for a write graph with more than one statement. A single-row `update` may be one statement and then never takes the lease. Make B6 use a nested create and assert from the statement log that `BEGIN` was sent.

The stronger check already exists: the `test/integration` ORM harness runs every ORM operation on `PostgresDirectDriverImpl` (`test/integration/test/sql-orm-client/runtime-helpers.ts:110-117,161`), as do `createTestRuntimeFromClient` (`test/integration/test/utils.ts:107`) and the e2e harness (`test/e2e/framework/test/utils.ts:263`, `pg: client` with marker verification on). A hidden statement on the driver while the ORM holds the lease shows up there as a timeout. Dispatch 2 should run, by path: `test/integration/test/sql-orm-client/{nested-mutations,mn-nested-write,mutation-include-readback,nested-variant-mutations,nested-create-on-conflict,nested-update-defaults,create,update,upsert,delete,transaction-hook-after-commit}.test.ts`, `test/integration/test/cross-package/middleware-cache-write-invalidation.test.ts`, `middleware-cache-orm.test.ts`, and `test/e2e/framework/test/transaction-orm.test.ts`. Leave the full suites to CI.

### 13. The coverage check in the plan does not apply the coverage thresholds (should fix)

Evidence: the driver's `vitest.config.ts` has no coverage settings. Thresholds are composed at the root (`vitest.config.ts`, `scripts/coverage-config.js:167-188`) from `packages/3-targets/postgres/3-driver/coverage.config.json` (lines 94, branches 95, functions 95, statements 94). `pnpm test --coverage` inside the package reports coverage but enforces nothing. Run root vitest with coverage on the package's path and confirm the output names the thresholds. The new branch that releases the lease when `acquireClient` fails after locking needs its own test, or the 95% branch threshold may fail in CI.

### 14. Upgrade instructions need two declarations (should fix)

Evidence: `upgrade-instructions/README.md`. Changes under `packages/3-targets/*/9-facade/` and `packages/3-extensions/` need an `extension` declaration; this work adds tests in the Postgres facade and Supabase. The behaviour change for callers is an `app` declaration with prose. So: `upgrade-instructions/pending/<name>/app/instructions.md` with the prose, and `.../extension/instructions.md` with `changes: []` and no prose (unless the extension guide should mention it). Prose must name only published `@prisma/orm-*` entries; add `pnpm lint:consumer-internal-imports` to dispatch 3's checks.

### 15. CI checks missing from the plan (should fix)

From `.github/workflows/ci.yml` and `drive/calibration/dod.md`:
- `pnpm lint:vitest-timeouts` (new tests set timeouts).
- `pnpm lint:docs` if a package README changes.
- `pnpm lint:consumer-internal-imports` (finding 14).
- `pnpm check:upgrade-coverage` and `pnpm lint:ratchets` are in the plan; run them on the final tip after the merge of `origin/main`, as the dod's PR-side item says.
- Release notes: no per-PR file is needed. `scripts/check-release-notes.mjs` only checks a version bump. State that so nobody adds one.

### 16. Details for section A (should fix)

- A2 is buildable but needs a different fake. `makeTrackedClient` answers every statement after a 1 ms timer and has no way to hold `BEGIN`. Add a per-statement gate (a deferred promise keyed by statement text, as the destroy test at line 240 does with `queryGate`), wait with `expect.poll` until `BEGIN` reached the fake, then send the driver statement, then open the gate. Today the driver statement is queued on the query lock right behind `BEGIN` and runs before the transaction's own statements: red for the right reason.
- Run A1 over each driver path: `query` buffered, `query` with cursor, `execute`, `explain`, and `query`/`execute` with a prepared-statement handle. Each reaches the socket through its own `acquireClient`/`releaseClient` pair (`postgres-driver.ts:297-320`, `331-404`, `406-429`, `242-295`).
- Add: a driver cursor stream holds the lease until it completes or `return()` is called, so `acquireConnection()` waits for it.
- Add: on the direct driver, a statement whose `acquireClient` fails after it took the lease (session settings rejected, connect failure, closed driver) releases the lease, so the next statement and `acquireConnection()` do not hang. Existing guards cover connect failure (`driver.client-ownership.integration.test.ts:183` "reports a failed connect again on the next use instead of hanging", `driver.connection-errors.test.ts:124-125`); session-settings failure on the direct driver has none.
- A7 is green today (nothing waits), so list it with A5 and A6 as "kept behaviour" in dispatch 1's expectations. A8 should assert the code `DRIVER.NOT_CONNECTED`.
- The pinned-client file is 297 lines; eight or more new tests will pass the 500-line limit in `.agents/rules/test-file-organization.mdc`. Put them in a new file.

### 17. Local runnability must be reported plainly (should fix)

- MySQL and MariaDB live tests skip without `MYSQL_URL`/`MARIADB_URL` (`packages/3-targets/mysql/3-live-tests/test/live-database.ts`, "Skips when the server's URL variable is not set"). A local "pass" may be a skip. CI's "Package Tests" job sets both URLs and starts both servers (`ci.yml` test-packages), and runs every `packages/**/vitest.config.ts` project, so the new MySQL, MariaDB, Supabase, SQLite and facade files will run in CI. No new file goes unrun.
- `examples/prisma-8-cloudflare-worker` needs `pnpm db:up` (Docker) locally; CI's "Test Examples" job runs it. Say which applies.

### 18. The pooled run should use a pool of at least two (should fix)

`nested-transactions.integration.test.ts` uses `new pg.Pool({ max: 1 })`. With one pool connection the client statements wait for the pool, so the "different connection" path is never exercised. Use `max: 2` or more. Note also that the dev server serializes connections: `@prisma/dev` 0.25.2 uses `@electric-sql/pglite-socket` 0.1.3, whose query queue serves only the connection that has a transaction open. So on `createDevDatabase()` a pooled client's statements also wait for the transaction to end, unlike real Postgres. The assertions in cases 1 and 2 still hold; case 3 must not assert what the read returns (after the fix it sees the committed row on single-connection clients, and may or may not on pooled ones).

### 19. An existing test awaits a client statement inside a transaction callback on a `pg.Client` (note)

`test/integration/test/cross-package/middleware-cache-write-invalidation.test.ts:169` awaits `readUserOne(db.orm.public.User)` inside `db.transaction(...)` with `pg: client` (line 100). It passes after the fix only because that read is a cache hit and never reaches the driver (`events: []`). Run it in dispatch 2. If the cache ever misses there, it becomes the "never finishes" row.

### 20. Small spec wording (note)

The Cause paragraph says `acquireClient()` "takes the client query lock". It does not; `runExecute`, `runQuery` and `explain` take it after `acquireClient()` returns (`postgres-driver.ts:298-300`, `340`, `538`, `412`). The conclusion is right.

## The fix: smallest correct change, and where an implementer will go wrong

Sketch (words only):
- Split `PostgresDirectDriverImpl.acquireClient()` into two parts: a private step that connects and ensures session settings (what it does today), and the override used by driver statements, which first takes `#connectionMutex`, then checks `#closed` and lost connection, then runs the private step. On any throw after taking the lease, it releases the lease before rethrowing.
- `releaseClient()` on the direct driver releases that lease. Because the lease is exclusive, one private field holding the current statement's release function is enough.
- `acquireConnection()` keeps taking the lease itself and calls the private step, never the override.

Does "hold the lease for the span it holds the query lock today" hold up? Yes, if the lease lives in the `acquireClient`/`releaseClient` pair:
- `runExecute` (`297-320`): acquire, lock, query, unlock, release. Same span plus connect and session settings.
- `runQuery` buffered (`395-403`): `releaseClient` runs in `finally` before the rows are yielded (`401-403`), so a nested driver statement inside the consumer's loop works (A6).
- `runQuery` cursor (`335-393`): `releaseClient` runs after the stream completes, fails, or is returned. Same span as the query lock.
- `explain` (`406-429`) and the prepared-statement retries (`242-295`, the retry acquires again after the failed attempt released) follow from the same pair.
- `PostgresUnboundDriverImpl` (`src/exports/runtime.ts:154-172`) only delegates to the bound driver. No path around the lease.
- Lock order is lease then query lock on every path: `close()` (`942-949`), `acquireConnection()` with `ensureSessionSettings`, and the new statement path.

Where an implementer will most likely go wrong:
1. Taking the lease inside `acquireClient()` without splitting it. `acquireConnection()` calls `acquireClient()` while holding the lease, and `AsyncMutex` is not re-entrant, so every transaction deadlocks.
2. Wrapping the public `query()` generator instead of the acquire/release pair. The lease is then held while the consumer reads buffered rows, which breaks A6 and any `for await` over `db.query` that sends another statement.
3. Not releasing the lease when `acquireClient` throws after taking it (`runQuery`, `runExecute` and `explain` call it outside their `try`). The client then hangs forever after one connect or session-settings failure.
4. Checking `#closed` before waiting for the lease. A statement that waited through a `destroy()` would then run on an ended client and fail with pg's own error instead of `DRIVER.NOT_CONNECTED` (A8 catches this).
5. Missing the marker read in the runtime (finding 1).

## Claims verified as true

- `PostgresDirectDriverImpl` driver statements reach the socket without the lease; only `acquireConnection()` and `close()` take `#connectionMutex` (`postgres-driver.ts:908-949`, `995-1010`).
- The lease is first-in, first-out: `AsyncMutex.lock()` reserves its place in the queue synchronously (`149-164`). For `execute` the place is taken at the call; for `query` (an async generator) at the first `next()`.
- A transaction holds the lease from before `BEGIN` to the connection's release: `withTransaction` takes the connection first and releases it after commit or rollback (`sql-runtime.ts:1782-1802`).
- The marker read goes to a held queryable when the first statement is on one (`sql-runtime.ts:877`), and transactions on held connections are added to the held set (`1538`).
- `supabase()` cannot take a `pg.Client` (`packages/3-extensions/supabase/src/runtime/supabase.ts:158`). MySQL and MariaDB use a `mariadb` pool (`packages/3-targets/mysql/1-mysql/3-driver/src/core/runtime/mysql-driver.ts:19,651`).
- `SqliteDriver.acquireConnection()` opens a new connection to the file, and driver statements use another (`sqlite-driver.ts:254-279`).
- `postgresServerless().connect()` binds a new `pg.Client` with `kind: 'pgClient'` (`packages/3-targets/postgres/9-facade/src/runtime/postgres-serverless.ts:200-216`), so it uses `PostgresDirectDriverImpl`.
- Cursor streams on the driver decide their `BEGIN`/`COMMIT` wrap from `inExplicitTransaction()`, which reads the shared `#txState` (`896-898`, `440-470`). With the lease held by the statement, no caller transaction can be open, so keeping the check is harmless.
- Facade, Supabase, SQLite facade and MySQL live-test files are all run by CI's "Package Tests" job through the root `vitest.config.ts` projects glob, with MySQL and MariaDB servers started.
- Section B cases 1 and 2 are red today on both single-connection clients for the defect's reason, provided findings 7 and 9 are applied: case 1 stores no client write and the read sees the transaction's row; case 2 fails the client statements with 25P02. Case 3 and case 4 are green today.
