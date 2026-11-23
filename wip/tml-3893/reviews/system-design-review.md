# System design review: a statement on a single-connection Postgres client waits for an open transaction

Reviewer stance: architect. Scope: `wip/tml-3893/spec.md` and `wip/tml-3893/plan.md`, checked against the code at `2681eb45de` and the design documents.

## Verdict

The direction is sound and the driver is the right owner of the wait. The driver already owns the lease, the pool driver gets the same guarantee by construction, and the driver lifecycle record already defines a driver connection as a handle "for operations that require a dedicated connection". The design does not touch `packages/1-framework`.

The design is not ready to build as written. Two defects would ship with it: the headline `Promise.all` example hangs on a fresh connection because of the shared marker check, and the rule for how long a statement holds the lease is stated against the wrong span. Both have small, local fixes. Several documents and existing tests that the change makes false or makes hang are not named.

## What I read

- `CLAUDE.md` golden rules; `.agents/rules/adr-writing.mdc`; `.agents/rules/test-database-limitations.mdc`.
- `docs/Architecture Overview.md` (guiding principles).
- In full: the decision record "A serverless Postgres connection has the same query interface as a postgres() client" (ADR 263); "Runtime target layer: session-coupled connections" (ADR 230).
- The decision record "The runtime middleware observes a tree of activities" (ADR 271): the sections on statements under transactions, the cache, and Consequences.
- The driver terminology and lifecycle record (ADR 159), its definition of a connection.
- The superseded afterTransaction record (ADR 260), the paragraph on the direct driver.
- `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`: raw connections, activity handles, "Work outside the connection's transaction", Shutdown ("When refusal begins", "What close() waits for", "Held connections are exempt"), Transactions.
- `docs/architecture docs/subsystems/5. Adapters & Targets.md`: "Concurrency, streaming, and cancellation".
- `docs/Serverless Deployment Guide.md`: "Known limitations" and "Cursor streaming".
- Code: all of `packages/3-targets/postgres/3-driver/src/postgres-driver.ts`, `src/exports/runtime.ts`, `src/session-settings.ts`, `src/pg-client-state.ts`; in `packages/2-sql-family/5-runtime/src/sql-runtime.ts` the constructor, `setupDriverExecution`, `beginOperation`, `acquireRawConnection`, `openConnection`, `connectionRoute`, `beginTransactionOn`, `withTransaction`, `close`/`refuseAfterWork`, `verifyMarker`; the ORM statement graph runner (`sql-orm-client/src/statement-graph/run-graph.ts`) and include consumer (`collection-dispatch.ts`); the serverless facade `connect`; the Supabase binding; the MySQL and SQLite drivers; the driver tests named below; `@repo/test-utils` `createDevDatabase` and the `@electric-sql/pglite-socket` query queue it runs on.

## Findings

### 1. The headline example hangs on a fresh connection: the shared marker check deadlocks against the lease

**Must fix before building.**

Evidence. `sql-runtime.ts:876-883`: the marker check runs once per runtime. The first statement creates `verifyMarkerPromise` on its own queryable if that queryable is held, otherwise on `this.driver`, and every later statement, on any queryable, awaits that same promise. The Runtime subsystem document says so too ("concurrent first queries share its result", Shutdown, "Held connections are exempt"). The default is `verifyMarker: 'onFirstUse'` (`sql-runtime.ts:404`), and every serverless connection is a new runtime, so every request runs a first marker read.

Trace of `Promise.all([db.transaction(async (tx) => { await tx.query(insertUser) }), db.query(selectOrders)])` on a new serverless connection, after the fix:

1. `db.transaction` reaches `driver.acquireConnection()` within a few microtasks and takes the lease.
2. `db.query` goes through activity start, compile, lower and encode, then reaches `setupDriverExecution` with the driver as queryable. `verifyMarkerPromise` is still `null`, so it starts a marker read on the driver. That read now waits for the lease.
3. The transaction sends `BEGIN`, runs the callback, and `tx.query` reaches `setupDriverExecution`. `verifyMarkerPromise` is not `null`, so it awaits the driver's marker read.
4. The marker read waits for the lease, the lease waits for the callback, the callback waits for the marker read. Nothing finishes.

Step 1 needs far fewer awaits than step 2, and step 2 happens long before step 3 (which needs a `BEGIN` round trip). So this is the likely order, not a rare race.

The codebase already knows this path exists. The comment in `driver.stream-portal-protection.integration.test.ts:349-352` says: "A driver-level read on the shared socket (the runtime's lazy verify-marker read does exactly this mid-mutation)."

Why it matters. The spec's own requirement, the code in "What every client must do", would hang in production on the first request of each connection. Test B5 does not catch it: it covers only the order where the transaction's statement starts the marker read. The existing facade tests pass `verifyMarker: false`. Test B4 would catch it only if it runs with marker verification on and with no earlier statement on the connection.

Change. Add to the spec's design, as a runtime change in `packages/2-sql-family/5-runtime` (which the spec already allows): a statement on a held connection or transaction never awaits a marker read that was started on the driver and has not settled; it runs its own read on its own queryable, and the first read to succeed settles the check for the runtime. State it as a general runtime rule, not a single-connection rule: any driver can make work on the driver wait for a held connection (a pool with `max: 1` does today). Add a runtime unit test with a fake driver whose `query` waits until a held connection is released, and a facade test: the literal `Promise.all` code, on a new serverless connection and on `postgres({ pg: client })`, with marker verification on and no earlier statement. Update the "Held connections are exempt" paragraph of the Runtime subsystem document.

### 2. The lease span is stated against the wrong span; the natural reading skips the session-settings check

**Must fix before building.**

Evidence. Design point 3 says a statement holds the lease "for exactly as long as it holds the client query lock today". On the driver paths the query lock is taken after `acquireClient()` (`postgres-driver.ts:298-300`, `332-340`, `410-412`, `538`). `PostgresDirectDriverImpl.acquireClient()` (`postgres-driver.ts:995-1010`) does three things before that: refuses a closed or lost client, connects on first use, and runs `ensureSessionSettings`, which asks `SessionSettingsGuard.needs(client)` and, if needed, sends `SELECT set_config(...)`. The guard is told to forget the client when a held connection is released (`postgres-driver.ts:916`), because the holder may have changed its session.

Three consequences of taking the lease only around the query-lock span:

- A statement sent while a connection is held calls `acquireClient()` first. `needs()` is still false because the holder has not released yet. The statement then waits for the lease, the holder releases (the guard forgets), and the statement runs without re-applying the settings. It runs with whatever the holder set, for example a changed `DateStyle`, which the Postgres codecs depend on (`packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts:26`). This affects `postgres({ pg: client })` with a client the caller made; a client made by `createPgClient` starts with the settings and the guard has nothing to apply.
- The cursor path falls back to a buffered read when the cursor fails for a reason that is not a Postgres error (`postgres-driver.ts:380-395`). It releases the query lock in `close()` and takes it again in `executeBuffered`. If the lease follows the query lock, a transaction can take the lease between the two, and the buffered fallback runs inside it.
- `acquireConnection()` calls `this.acquireClient()` while it holds the lease (`postgres-driver.ts:909-911`). An implementation that puts the lease inside `acquireClient()` deadlocks against itself.

Change. Restate design point 3 as: on the driver itself (`query`, `execute`, `explain`, prepared variants), the lease is taken before `acquireClient()` and released in `releaseClient()`. This is the pool driver's shape: its `acquireClient`/`releaseClient` pair already brackets exactly the use of one pool client. For a buffered read the span ends before the first row is yielded (`postgres-driver.ts:398-404`), so the nested-query case in test A6 still works. For a cursor read it ends when the stream ends or is returned, as the query lock does today. `acquireConnection()` must reach the client through a path that does not take the lease. Add a test: a statement on the client sent while a held connection has changed a session setting runs with the driver's setting after the release.

### 3. Four existing driver tests will hang after the fix, not fail; two of them assert the defect

**Should fix.**

Evidence. Each of these sends a statement on the driver while a connection the same test holds is still unreleased, so after the fix the statement waits for a release that comes only after the statement:

- `driver.pinned-client-serialization.test.ts:150` "serializes driver-level and pinned-connection statements sharing one physical client" (the spec names this one).
- `driver.pinned-client-serialization.test.ts:240` "destroy() on a direct driver connection ends the client without waiting for the statement in flight": a statement on the driver is in flight, then the test awaits `driver.acquireConnection()`, which now waits for that statement, which waits for a gate the test opens only after `destroy()`.
- `driver.stream-portal-protection.integration.test.ts:287` "root direct-driver stream preserves an acquired connection transaction for rollback": it reads on the driver inside an open transaction and asserts the uncommitted row is returned (`rows.at(-1)` is `{ id: '100' }`). It asserts the defect.
- `driver.stream-portal-protection.integration.test.ts:339` "a driver-level streamed query during an open connection transaction does not end it": same shape, also asserts the uncommitted row is read.

Why it matters. The plan says to stop and report when "a test hangs for a reason the spec does not name". These four would trigger that stop. The two stream-portal tests are also the only justification for the driver's own `inExplicitTransaction()` override (finding 6).

Change. Name all four in "Changes to existing driver tests". Say what each becomes: the first asserts the new order; the destroy test sends its in-flight statement on the connection instead of the driver; the two stream-portal tests become "a statement on the driver sent during a connection's transaction waits and runs after the rollback, wrapped in its own BEGIN/COMMIT, and does not see the rolled-back row".

### 4. Documents that state the old behaviour and are not on the list

**Should fix.**

Evidence (from `git grep` for the old wording):

- The activity-tree decision record (ADR 271), Consequences, line 288: "The direct single-client Postgres driver runs a runtime-scope statement sent while a transaction is open inside that transaction, and the runtime cannot see it. That limit is unchanged." This is an accepted record and becomes false.
- `skills/prisma-8/references/runtime.md:172`: the published agent skill repeats the Serverless Deployment Guide's rule, including "runs inside the open transaction without saying so". The plan's search covers `docs/`, `packages/**/README.md` and `examples/`, not `skills/`.
- Runtime subsystem document, Shutdown, "Held connections are exempt": the marker paragraph (finding 1) and "the direct Postgres driver waits for its connection lease and for the client query lock", which now also covers streams on the driver.
- ADR 263's last alternative paragraph says a hand-started cursor iterator "holds the client query lock, so close() waits for it"; after the fix it also blocks every transaction and every later statement on the client. The spec lists only the "Three rules" section and the "Costs" paragraph.
- Source comments that become false: the `PostgresBinding` concurrency contract (`postgres-driver.ts:47-58`), `SharedTransactionState` (`552-559`) and the driver's `#txState` (`877-880`), which all say a statement on the driver can run during a connection's open transaction.

The superseded afterTransaction record (ADR 260) says the same at line 84; it is superseded, so leave it.

Change. Add these to "In scope" and to dispatch 3. Widen the plan's search to `skills/`, `upgrade-instructions/` and the driver's source comments. The `examples/prisma-8-cloudflare-worker/README.md:163` line is already caught by the existing search.

### 5. Rewriting the serverless connection record in place conflicts with the ADR writing rule

**Should fix.**

Evidence. `.agents/rules/adr-writing.mdc` line 11: "To change a decision, write a new ADR and mark the old one superseded. Do not edit the old one." The same record was last changed by a new record (ADR 311, "connect() on a client is safe to call again"), with a status line on ADR 263 and a note in the index row. There is also precedent for dated in-place amendments (the enum record ADR 157, the raw SQL record ADR 268). The spec says "No new record is needed" and does not address the rule.

Why it matters. The rule exists so the record of why a rule was once different survives. Here the old text documents a defect as a rule ("runs inside the open transaction"), and the change also makes a line of the activity-tree record false (finding 4).

Change. Pick one and say so in the spec. Either write a short new record ("On a connection, a statement through `db` waits for the connection's open transaction") that amends ADR 263 and the ADR 271 line, add status lines to both, and add an index row; or keep the in-place rewrite as a dated amendment section with a status line and an updated index row, and give the reason the rule does not apply. The first matches the most recent precedent on this same record.

### 6. A connection released with its transaction still open leaves the defect reachable

**Should fix.**

Evidence. `PostgresConnectionImpl.release()` (`postgres-driver.ts:630-639`) releases the lease without looking at `#txState`. The runtime lets a holder release a connection whose transaction is still open; the Runtime subsystem document says so ("A transaction stops counting when ... its connection is released or destroyed"). So `const c = await db.runtime().connection(); await c.transaction(); await c.release();` frees the lease while the server transaction is still open and `#txState.open` stays `true`. The next statement on the client takes the lease and runs inside that leftover transaction. On the cursor path the driver's `inExplicitTransaction()` (`postgres-driver.ts:896-898`) returns `true`, so it also skips its own `BEGIN`/`COMMIT` wrap.

Why it matters. The plan's outcome for dispatch 2 says "no statement on the driver is ever sent between a transaction's `BEGIN` and its `COMMIT` or `ROLLBACK`". That is false on this path. After the fix, the driver's `inExplicitTransaction()` override is true only in this broken case, and its comment explains a case the fix removes. The spec keeps it without saying why.

Change. Either fix it locally: when a direct driver connection is released with `unfinishedOnServer` set, send `ROLLBACK` under the query lock before releasing the lease (the driver already does this for a supplied client it gives up on, `postgres-driver.ts:977-991`), then remove the driver's `inExplicitTransaction()` override because it can no longer be true. Or state the path as out of scope, file it (the pool driver has the same gap: pg-pool hands back a client with an open transaction), and narrow the plan's outcome sentence to transactions that end by `COMMIT` or `ROLLBACK`. Either way, say in the spec why the override stays or goes.

### 7. The rule this fix establishes belongs on the driver interface, not only in the Postgres driver

**Should fix.**

Evidence. The runtime already depends on a statement on the driver being independent of held connections: it routes the marker read of a held queryable to that queryable "so it works while close() waits for their release" (`sql-runtime.ts:318`). The cache skips `'connection'` scope because a held connection "can carry session state, such as a database role, that changes which rows a statement returns" (ADR 271, the cache section). The driver lifecycle record defines a driver connection as a handle for operations "that require a dedicated connection". The `SqlDriver` interface (`packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts:38-46`) does not say it, and the Adapters & Targets document says only "Single-connection driver: serializes or rejects overlapping executes per its policy".

Why it matters. Today the guarantee is true of the pool, MySQL and SQLite drivers by construction and of the direct driver only after this fix. Without a stated contract, the next single-connection driver (another target, a test double) can reintroduce the defect, and the runtime's marker routing rests on an unwritten assumption. This is a family-layer interface in `2-sql-family`, not the framework, so documenting it does not touch the forbidden domain.

Change. Add one sentence to the `SqlDriver` doc comment and replace the Adapters & Targets line: a statement on the driver never runs on the session of a connection the driver has handed out and not had back; a driver with one database connection makes it wait. This also states the session-state answer: waiting while a connection is merely held, with no transaction, is right, because a held connection can carry session state (a role, a changed setting) that must not leak into statements on the client.

### 8. The SQLite result is predictable; decide it now instead of stopping dispatch 1

**Should fix.**

Evidence. `packages/3-targets/sqlite/3-driver/src/sqlite-driver.ts:57-62`: every connection is a synchronous `node:sqlite` `DatabaseSync` with `PRAGMA busy_timeout = 5000`. A write on the driver's own connection while the transaction's connection holds the write lock retries inside the synchronous call, which blocks the whole event loop. The transaction cannot progress meanwhile, so after 5 seconds the write fails with "database is locked". Reads work under the default rollback journal. Also, each `DatabaseSync(':memory:')` is a separate database, so the test must use a file (the spec already says so).

Why it matters. The plan stops dispatch 1 and returns to Will when the SQLite run is red. The outcome can be predicted now, and the global guidance says to settle decisions at design time.

Change. State the expected SQLite result in the spec (reads green, the write fails after blocking the event loop for 5 seconds), decide now whether the SQLite run asserts that known limit or skips the write case, and file the SQLite behaviour as its own ticket. Keep "report to Will" only for an outcome other than this one.

### 9. Tests missing from sections A and B

**Should fix.**

Without these the fix can ship with a defect the listed tests do not see:

- The marker-check order from finding 1, on the runtime with a fake driver and on the facade with a real database.
- The session-settings case from finding 2.
- Cursor mode on the driver. Section A uses the recording fake with cursors off. Add, with cursors on: a stream on the driver sent during a transaction waits, then sends its own `BEGIN`/`COMMIT` outside it; a transaction requested while a cursor stream on the driver is open waits until the stream is returned (by `break`), then runs.
- `close()` in both orders: a statement queued before `close()` runs and then the driver closes (A7); a statement queued after `close()` is rejected with `DRIVER.NOT_CONNECTED` and does not hang.
- A held connection, no transaction, whose socket dies while a statement on the client waits. The statement waits until the holder releases or destroys, then is rejected. Today it would fail at once. State this as the expected behaviour.
- B4 with marker verification on and no earlier statement on the connection (finding 1).

### 10. The pooled-client run on the dev database passes for a different reason

**Note.**

Evidence. `createDevDatabase()` starts `@prisma/dev`, which serves every connection from one PGlite session through `@electric-sql/pglite-socket`. Its query queue, while PGlite is inside a transaction, serves only the connection that opened it and holds every other connection's queries until it ends. So on that server the pooled client's statement on the client also waits for the transaction; it does not run beside it on another session as it would on real Postgres.

Why it matters. Section B's pooled run is still a correct statement of the requirement, but it cannot tell pool isolation from the dev server's queueing. The table under "What every client must do" gives pool isolation as the reason. A pooled-client statement awaited inside the callback would also hang on the dev server, which is not true in production. Only the live MySQL and MariaDB runs exercise a real second session.

Change. Say this in the spec next to the pooled rows, so a reader of a green pooled run does not read it as proof of isolation.

### 11. A statement waiting for the lease cannot be cancelled

**Note.**

Evidence. The runtime checks the abort signal only before it calls the driver and between rows (`checkAborted`, `sql-runtime.ts:975`, `1027`, `1154`). The driver's `AsyncMutex` (`postgres-driver.ts:149-164`) has no way to leave the queue. An `execute` whose signal aborts while it waits for the lease still runs when the lease frees.

Why it matters. This was already true for the client query lock, but that wait lasted one statement. The lease wait lasts a whole transaction. An aborted write that still lands after the transaction is surprising.

Change. One line in "Behaviour that changes", and a ticket if it should be fixed later.

### 12. Smaller accuracy and vocabulary points

**Note.**

- "The defect" says `acquireClient()` "takes the client query lock but not the lease". `acquireClient()` takes the query lock only to apply session settings; `runQuery`, `runExecute` and `explain` take it after `acquireClient()` returns.
- "Single-connection client" lists two ways to make one. There is a third: `postgres({ binding: { kind: 'pgClient', client } })` (`packages/3-targets/postgres/9-facade/src/runtime/binding.ts:22-23`). Same driver.
- Section A uses "statement on the driver", which the Terms section does not define. Define it as what a statement on the client becomes at the driver, and note that the activity-tree record calls it a runtime-scope statement, so the spec and the records use one name per thing.
- Design point 4 (lease before query lock) is correct. After the fix, every path takes the lease first: driver statements, `acquireConnection` (lease, then `ensureSessionSettings`, then `BEGIN`), `close()`, and `destroy()` (already holding the lease when it takes the query lock to roll back). The only reversed order is user code that holds the query lock through a cursor stream and then calls the client, which is the documented hang that exists today.
- A `pg.Pool` with `max: 1` already behaves as the new design does: a statement on the client waits for the transaction, and one awaited inside the callback hangs. This supports "Why waiting, not rejecting" and could be cited there.

## Spec claims verified as true

- The direct driver's `query` and `execute` reach the socket without the lease and without looking at `#txState` (`postgres-driver.ts:297-320`, `331-404`, `995-1010`).
- The lease is `#connectionMutex`, taken by `acquireConnection()` and released on release or destroy; `AsyncMutex` is first-in, first-out (`postgres-driver.ts:149-164`, `908-940`).
- A transaction holds the lease from before `BEGIN` until after `COMMIT` or `ROLLBACK`: the runtime acquires the connection first (`withTransaction`, `sql-runtime.ts:1789`), then `BEGIN` (`beginTransactionOn`, `1529`), and releases it after settling.
- A second `db.transaction(...)`, `db.runtime().connection()`, and ORM writes of several statements already wait for the lease; the ORM's single-row `update` and `delete` run in a transaction it opens (`run-graph.ts:84-89`; the activity-tree record says the same).
- The ORM sends every statement of an operation on one scope: the runtime, or the transaction it opened. I found no ORM path that sends a statement on the root runtime while it holds a transaction. Searched `sql-orm-client/src` for `.connection(`, `.transaction(`, `.query(`, `.execute(`; `acquireRuntimeScope` is defined but unused.
- The runtime's only path that sends on the driver while the same runtime may hold a connection is the shared marker check (finding 1). Searched `sql-runtime.ts` for every use of `this.driver`; the other uses are runtime-scope statements, `acquireConnection`, and `close`. No middleware in the repository sends statements (`budgets.ts`, `cache-middleware.ts`), and nothing calls `explain` outside the driver.
- The serverless facade's `connect` acquires and releases one driver connection and sends nothing else (`postgres-serverless.ts:229-236`).
- `PostgresUnboundDriverImpl` delegates `query`, `execute`, `explain` and `acquireConnection` to the bound driver and adds no path around the lease (`exports/runtime.ts:101-172`).
- The control-plane driver is a separate class (`exports/control.ts`, `PostgresControlDriver`) and is not affected.
- Supabase cannot use a `pg.Client` (`supabase.ts:158`, `276-295`); its role session uses `acquireRawConnection` on a pool.
- MySQL and MariaDB bind only to a URL and use a `mariadb` pool (`mysql-driver.ts:37`, `640-656`).
- SQLite's `acquireConnection()` opens a new connection to the file, and statements on the driver use the driver's own connection (`sqlite-driver.ts:254-283`).
- MongoDB has no `db.transaction`.
- The existing facade transaction tests pass `verifyMarker: false` (`nested-transactions.integration.test.ts:11`).
- The test locations named in section B exist.
- The change needs nothing in `packages/1-framework`, and the pool driver and runtime interfaces do not change. The only runtime change needed is the marker fix in finding 1, which the spec already allows in `packages/2-sql-family/5-runtime`.
