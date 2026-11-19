# Principal engineer review: connecting to a pooled Prisma Postgres URL

Verdict: **sound with changes.** Keeping direct connections exactly as they are (4.1) is right, and the switch is opt-in, so few users are affected if it is wrong. But building `pool: false` as one plain `pg.Client` gives a long-running server the failures that the serverless client's decision record lists for a shared `pg.Client`. Sections 6.2 and 6.3 rest on a wrong reading of how the direct driver behaves. The same switch, built as a pool that holds at most one plain connection, removes those failures with no driver change.

All line numbers are at `234d27acb2` unless a dependency path is given.

## Findings, most important first

### 1. One plain `pg.Client` lets one request's queries run inside another request's transaction

**What the design says.** Section 6.3: "a transaction blocks every other query until it ends. This is already how `postgres({ pg: client })` behaves (the driver takes the client's query lock)."

**What is wrong.** The direct driver does not block other queries while a transaction is open. Only `acquireConnection` callers wait for each other, on `#connectionMutex` (`packages/3-targets/postgres/3-driver/src/postgres-driver.ts:909`). A statement through the driver itself (`db.orm…`, `db.query`, the marker read) calls `acquireClient` (995–1010), which takes no lease. It returns the same socket, and the query lock is held for one statement only (300–314, 538–545). The driver shares the transaction-open flag between the driver and its connection on purpose, so that such a statement runs inside the open transaction (552–564, 877–880). A test checks this: `driver.stream-portal-protection.integration.test.ts:362`, "a driver-level streamed query during an open connection transaction does not end it". The rc.2 release notes describe the same behaviour (`docs/releases/v8.0.0-rc.2.md:136`).

In a server with `pool: false`, suppose request A is inside `db.transaction(...)` and request B runs `db.orm.User.create(...)` at the same moment. B's insert goes into A's transaction. If A rolls back, B's insert disappears, although B was told it succeeded. B's reads also see A's uncommitted writes. The serverless client's decision record lists exactly this as one of the four reasons a module-scope `pg.Client` is unsafe: "If one request opens a transaction, another request's queries can run inside it." It also says those failures "do not occur in a long-lived process, where a pool already gives each query a database connection". `pool: false` brings them back into the long-lived process.

The same client has three more failures, none of them in the design:

- **A connect failure never clears.** `#connectFailure` is set once (1027), and every later `acquireClient` throws it (996–998). A server that starts while the database is unreachable, for example during a deploy or a DNS blip, fails every query until it is restarted. A pool tries to connect again on the next checkout.
- **A lost connection is lost for good.** After an idle disconnect, `acquireClient` throws `DRIVER.NOT_CONNECTED` "Postgres connection lost or closed. Create a new client to reconnect." (999–1003). A module-scope `db` cannot do that, so the only fix is a restart. Section 6.2 covers this, but only as a later option.
- **Waits have no time limit.** A query sent inside a `for await` over a cursor stream waits forever, because the stream holds the client's query lock for its whole life (comment at 53–57; the serverless guide says the same at line 229). A second `db.runtime().connection()` waits forever on `#connectionMutex`.

**What I would do instead.** With `pool: false`, the facade builds `new Pool({ connectionString: url, max: 1, connectionTimeoutMillis, idleTimeoutMillis })` from plain `pg` (not `createPgPool`). It binds it as `{ kind: 'pgPool', pool, ownedByDriver: true }`, the shape `toRuntimeBinding` already returns (`packages/3-targets/postgres/9-facade/src/runtime/binding.ts:429–443`). Then:

- The driver still does not change. `PostgresPoolDriverImpl` with a pool it did not build already uses the statement path (`session-settings.ts:96–100`, `postgres-driver.ts:849–856`).
- There is still one connection to the pooler, so Will's objection to stacking a client-side pool on a pooler still holds. Nothing multiplexes.
- Other work waits for the one connection instead of running inside someone else's transaction. The wait ends with an error after `connectionTimeoutMillis`, because pg-pool applies that timeout to waiting checkouts too, so nothing hangs forever.
- pg-pool drops a connection that errors while idle (`node_modules/.pnpm/pg-pool@3.14.0_pg@8.22.0/node_modules/pg-pool/index.js:52–59`) or that comes back broken (392–397), and opens a new one on the next checkout. That is section 6.2's option b, already built and already tested.
- A connect failure belongs to that checkout only. The next checkout tries once more, with the same settings.
- `connectWithBinding` already ends an owned pool when binding fails (`binding.ts:455–458`). A driver-owned client built there would need a new cleanup branch.
- `poolOptions.idleTimeoutMillis` becomes useful, not invalid. It closes the one connection when idle, so a socket dropped by a NAT is not reused. Drop the rule in 4.2 that rejects it.

There is one behaviour change, and it is a better failure. Code that calls `db.*` inside a `db.transaction` callback, where it should call `tx.*`, now waits and then fails with a timeout. With the plain client it silently ran inside the transaction. The runtime's own reads inside a transaction use the held connection (`packages/2-sql-family/5-runtime/src/sql-runtime.ts:865`, 1415, 1521), so the runtime does not block itself.

Also state the throughput cost in the docs. With `pool: false`, a server runs one statement at a time. At a 20 ms round trip to the pooler, that is about 50 statements a second for the whole process, and one slow query stalls every request. That cost is the reason to keep `pool: false` from being the only way to use a pooled URL (see "A simpler design" below).

### 2. The settings statement runs more often than the design says

**What the design says.** One `set_config` per connection (4.2). One round trip per request for serverless option A (5.2).

**What is wrong.** When a connection held for exclusive use is released, the driver forgets that its settings were applied (`postgres-driver.ts:824` for pools, 915–917 for a direct client). The next use runs `set_config` again (851, 1006). `db.transaction` uses exactly such a connection (`sql-runtime.ts:797`, 820). So:

- `pool: false` (either build): one extra round trip after every transaction, not once per connection.
- The serverless client: `connect` acquires and releases a connection to prove the database answers (`postgres-serverless.ts:231–232`). With the statement path, that is one `set_config` during `connect` and a second one before the first query, plus one after each transaction. Option A costs two origin round trips per request, not one.

**What I would do instead.** Will has said a user who runs `RESET ALL` has only himself to blame. Applying the settings again after a release exists only to undo that kind of reset (the driver lifecycle decision record says so: "because the holder may have reset the session"). For a connection the driver or facade owns, applying them once per physical connection is enough. That is a small change in the driver: do not forget on release for an owned client or pool. It changes behaviour the two decision records describe, so it needs Will's yes. If he says no, the design must state the per-transaction cost. In either case, the serverless probe must not cause a second `set_config`.

### 3. The refusal is treated as fixed, but the endpoint is Prisma's own

**What the design says.** Section 1 takes "the pooled endpoint refuses a startup message carrying `options`" as a constraint and builds around it.

**What is missing.** That is an assumption about a service Prisma runs, and it rests on one transcript (9.1). The error text, "Failed to connect to upstream database", does not look like PgBouncer's ("unsupported startup parameter: options"). It reads like a proxy that passed the parameter upstream and failed. If the upstream is a PgBouncer without `options` in `ignore_startup_parameters`, the fix may be one line of configuration on the endpoint. That would fix the CLI, serverless, `postgres()` and `supabase()` with no ORM change.

**What I would do instead.** Before building, send the Prisma Postgres team the startup parameters we send and the full error response (SQLSTATE, detail), and ask whether the endpoint can accept or ignore `options`. Ask them also whether new databases can default to `DateStyle=ISO` and `lc_monetary=C`. Build 4.2 anyway, because users of other poolers need it, but do not build 5.1 or 5.2 until they answer.

### 4. The CLI: what a per-transaction pooler breaks, and which option to pick

**What the design says.** 5.1: "The CLI uses session-level features (advisory locks, multi-statement transactions). If the endpoint pools per transaction, those may break."

**What is wrong.** The CLI's advisory lock is transaction-scoped: `select pg_advisory_xact_lock(hashtext($1))` (`packages/3-targets/postgres/1-target/src/core/migrations/marker-lock.ts:7`). The migration runner wraps every space's work in one `BEGIN … COMMIT` and takes the lock inside it (`runner.ts:279–297`, 934–948). `db sign` takes the lock inside `withTransaction` (`packages/2-sql-family/9-family/src/core/control-instance.ts:749–757`, `packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts:564–588`). I found no statement that must run outside a transaction, such as `CREATE INDEX CONCURRENTLY`. A per-transaction pooler gives one server connection for the whole transaction, so the lock, the DDL, the marker write and the ledger write all work.

What does break is the session settings. A `set_config` sent after connecting is its own transaction, so it may land on a different server connection from the migration's `BEGIN`. Reads outside the runner's transaction (status, introspection) may also land elsewhere. The control driver parses timestamps with pg-types (`server-text-types.ts:28–32`). pg-types returns `null` for timestamp text it does not recognise, so a non-ISO `DateStyle` there gives a silent null, not an error. `money` is not decoded by the CLI, so `lc_monetary` does not matter there. The rest of the 9.4 unknown is whether the endpoint allows DDL and long transactions, which the manual run settles.

**What I would pick.** Option A, the statement path always in the control driver. It needs Will to accept, explicitly, that the CLI is an exception to "no extra statements on direct connections".

- The real cost is one round trip per CLI command. Each command already pays TCP, TLS and SCRAM authentication (about four to six round trips) and then runs tens of statements. On a 100 ms link that adds 100 ms to a command that takes seconds, a few percent at most.
- The cheapest alternative, C, costs nothing. But the getting-started user stays stuck, because the server's text does not say what to do. If Will declines A, do C and make the connect error state facts: the startup parameter we sent, and that a pooled URL must be replaced by the direct one for the CLI. That states what was sent; it does not guess why the connection failed.
- B adds a configuration concept for one provider and is the most work.

MySQL's control driver already applies its settings this way (`packages/3-targets/mysql/1-mysql/3-driver/src/core/migrations/control-driver.ts:103–111`).

### 5. The serverless client: pick B, and settle Hyperdrive first

**My pick.** Option B, an explicit option, set only by users of an endpoint that refuses `options`.

**The real cost of A.** For a Worker, the statement goes through Hyperdrive to the origin, because `set_config` is volatile and cannot be cached. That is one round trip to the origin per request, two with today's probe (finding 2), plus one per transaction. For an edge app, the round trip to the origin is the main cost of a request, so A would add a large share of its latency for every user. That is the trade Will rejected for direct connections.

**C versus B.** C needs a new ownership rule: today a serverless connection owns exactly the one `pg.Client` it creates and ends it on close (serverless decision record, line 120–122). B adds one option and nothing else.

**Two constraints the design does not mention.**

- A type test requires the options of `postgres()` and `postgresServerless()` to differ in exactly `binding`, `url`, `pg` and `poolOptions` (`packages/3-targets/postgres/9-facade/test/postgres-serverless.types.test-d.ts:62`). An option on serverless only, or `pool` on `postgres()` only, fails it. Either the option sits in the shared execution options, or the test and the serverless decision record change. I leave the naming to the architect, but this test will force the decision.
- Hyperdrive pools per transaction. Behind it, a `set_config(..., false)` lasts for one origin server session, so B gets the connection open but does not ensure the settings after the first transaction. Today, startup options sent to Hyperdrive cannot be applied per client to shared origin sessions either. Settle 9.5 before building B. If Hyperdrive accepts `options` and drops them, current serverless users already run on the origin's defaults.

### 6. Section 6.4 holds for PgBouncer only, and money writes can be silently wrong

**The claim.** PgBouncer in transaction mode carries `DateStyle` between server connections and not `lc_monetary`. This is correct for PgBouncer. PostgreSQL reports `DateStyle` to the client in a ParameterStatus message, and PgBouncer applies the client's value to each server connection it assigns. `lc_monetary` is never reported, so no pooler can track it. But nothing establishes that the Prisma Postgres endpoint or Hyperdrive behaves like PgBouncer, so the design should say "PgBouncer", not "a pooler that pools per transaction".

**What the user experiences.**

- Reads fail intermittently. A `money` read fails with `RUNTIME.LC_MONETARY_NOT_C` (a non-ISO date read with `RUNTIME.DATE_STYLE_NOT_ISO`) only when the transaction lands on a server connection whose default prints differently. Whether it fails changes from request to request, which is the hardest kind of bug for on-call to diagnose.
- Writes can be silently wrong. The data types decision record says a `money` write through `$1::numeric::money` is exact only under `C` and locales with two fraction digits, and not under one like `ja_JP`. So behind such a pooler, a write can store the wrong amount with no error. The design says only that "the codec then refuses the value".
- On a server whose defaults already print the same text as `DateStyle=ISO` and `lc_monetary=C`, nothing is visible. That is probably most servers, which is why this can stay hidden for a long time.

**What the docs must say.** Behind a pooler that hands out a server connection per transaction, a setting the ORM applies lasts only for the server session it lands on. Set both on the role or the database, for example `ALTER ROLE app SET lc_monetary = 'C'` and `ALTER ROLE app SET DateStyle = 'ISO'`. The change applies to new server sessions only, so the pooler's existing ones keep the old values until it replaces them. Before writing that, check that a Prisma Postgres user is allowed to run `ALTER ROLE … SET` or `ALTER DATABASE … SET`. Managed services often do not allow it.

### 7. Named prepared statements behind a per-transaction pooler have no off switch

The driver uses named prepared statements by default (`postgres-driver.ts:84–91`, 99), and the facade does not expose `preparedStatements` (it passes only `cursor` to `create`, `postgres.ts:164–166`). Behind a pooler that does not keep prepared statements across server connections, `db.prepare(...)` can land on a server connection that lacks the statement and get SQLSTATE 26000. Outside a transaction, the driver's stale-handle retry hides it at the cost of a round trip (242–262). Inside a transaction, the first 26000 aborts the transaction, the retry fails with "current transaction is aborted", and the user's transaction fails. This is a separate gap from the startup options, but the same users meet it. Add "does the pooled endpoint keep named prepared statements" to section 9. If it does not, the switch should also turn named statements off, or the docs must say `db.prepare` cannot be used through the pooled URL.

### 8. `postgres({ url })` never fails with `DRIVER.CONNECTION_FAILED`

Section 8 expects `postgres({ url })` to "fail once with `DRIVER.CONNECTION_FAILED`". Only the control driver (`control.ts:103`) and the serverless client (`postgres-serverless.ts:75`) build that code. On `postgres()`, the pool driver turns a connect failure into a `SqlConnectionError` (`postgres-driver.ts:845–848`, `normalize-error.ts:186–192`). An ErrorResponse that carries a SQLSTATE outside the connection classes even becomes a `SqlQueryError`. On a first query this usually surfaces as `CONTRACT.MARKER_READ_FAILED`, as the serverless decision record notes (line 312). With a pool it also fails on every query, not once. Section 4.3 must say where the server's detail and hint go on the `postgres()` path. Today they are only on `cause`.

### 9. `supabase()` is a fourth entry point that opens from a URL

`supabase()` binds through the same `connectWithBinding` and `toRuntimeBinding` (`packages/3-extensions/supabase/src/runtime/supabase.ts:10`, 422), so it also always sends startup options. Its options type includes `PostgresOptionsBase` (line 177–178), so a `pool` option added there reaches it. The design says it is rejected, so that needs both a type-level `Omit` and a runtime check. Whether Supabase's own pooler accepts `options` is unknown. Add it to section 9, because Supabase users connect through a pooler more often than not.

### 10. Smaller factual points

- Section 6.2 quotes "This pg client lost its connection… Create a new client to reconnect." That message is thrown when a driver is bound to a client that is already lost (`postgres-driver.ts:1074–1078`). A client lost during use gets "Postgres connection lost or closed. Create a new client to reconnect." (1001–1002), or "Postgres connection is no longer usable." mid-statement (179).
- Section 2 says the guard runs the statement "again after a connection … is released". It runs again lazily, before the next use, not at release (`session-settings.ts:115–118`, `postgres-driver.ts:1006`).
- Section 7 says no decision record text changes. Both records describe which connections get startup options: the driver lifecycle record ("sends them as startup options on connections it opens"; on a pool or client the user supplies, a statement) and the data types record ("It starts each connection it opens with `options=-c DateStyle=ISO`"). With `pool: false`, the facade opens a connection that gets the statement, which neither sentence covers. The rule itself, that how the driver ensures the settings is its own choice, is not reversed.
- A plain `pg.Client` still sends `options` when the user's URL has `?options=` or `PGOPTIONS` is set (`node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/connection-parameters.js:9–22`, 83). That is the user's own choice and correct. The `pool: false` docs should say so, so that a user behind this endpoint knows to unset it.

## Section 6.2: what to do when the connection is lost

- **a. Accept it.** Not acceptable for `postgres()`. A long-running server stops working after its first idle disconnect, and also after a connect failure at startup (finding 1).
- **b. Open a new connection on the next use.** This is right, but it belongs in the pool, not in new code. A pool of at most one plain connection gives it with existing code, and these are the rules it already follows:
  1. A statement in flight when the socket dies fails with a connection error (`normalizePgClientError`, `normalize-error.ts:199–206`). Nothing resends it. The driver's only resend is the stale prepared-statement retry, which follows an answer from the server, not a lost connection.
  2. A transaction or held connection on the dead socket fails. The runtime destroys it, and the driver releases it with an error so the pool drops it (`postgres-driver.ts:650–660`).
  3. The next checkout opens one new connection, with the same URL, the same timeout and the same settings path. The guard records settings per physical connection, so the new one gets `set_config` before its first use.
  4. A failed connect is reported to the caller who triggered it. There is no loop, no backoff and no background reconnect. The next use makes one new attempt.

  If Will insists on a plain `pg.Client`, the reopen has to live in `PostgresDirectDriverImpl`. The facade cannot do it, because the runtime owns the driver and keeps state for it (the marker check, in-flight tracking, prepared-statement handles). That driver treats `directClient` as fixed for its life, along with the per-client query lock, stream registry and shared transaction flag. Making it replaceable means rebuilding pg-pool with a maximum of one connection, inside our driver.
- **c. A connection per unit of work.** Each operation would pay TCP, TLS, startup and authentication, about four to six round trips, plus `set_config`. Reject it.

## Section 8: missing tests, and a stand-in for the refusing server

**A stand-in for the refusing server.** Extend the existing startup-parameter recorder, `test/utils/src/startup-parameters.ts`, which already parses startup messages and refuses TLS. Turn it into a small proxy in front of the test PostgreSQL. If the startup message carries `options`, it answers with a FATAL ErrorResponse with the pooled endpoint's message and closes. Otherwise it forwards the buffered startup message to the real server and pipes both directions. The same proxy can count `Query` and `Parse` messages whose text contains `set_config`, so tests can assert how many settings statements reach the wire. It can also close a socket on demand to simulate a lost connection. This is about 80 lines, runs locally, and needs no cloud database.

**Missing tests.**

1. Two concurrent operations with `pool: false`, one inside `db.transaction`. Assert that the other waits and that a rolled-back transaction does not take the other's write with it. This is the test for finding 1.
2. Idle loss: end the backend while idle (`pg_terminate_backend`, or the proxy closes the socket). The next query succeeds on a new connection.
3. Loss mid-statement and mid-transaction. The in-flight statement fails with a connection error and ran once (insert into a table, then count rows from a second connection). The transaction rejects, and the next call succeeds.
4. A connect failure that clears: the first query fails while the proxy refuses connections, and a later query succeeds once it accepts them.
5. Statement count on the wire: one `set_config` per physical connection. Assert what happens after a transaction, depending on the decision in finding 2, and that the serverless connect plus first query sends one.
6. A wait that ends: with `pool: false` and cursors on, a query inside a `for await` fails after the connect timeout and does not hang.
7. `db.close()` with `pool: false`: it waits for the statement in flight, ends the connection, can be called twice, and opens nothing when called before first use.
8. The type test in `postgres-serverless.types.test-d.ts:62` updated on purpose, and `supabase()` rejecting the option at the type level and at runtime.
9. Server detail and hint (4.3) on all three error paths: the control driver, serverless, and the `postgres()` path from finding 8.
10. Through the proxy: `postgres({ url })` fails, and with the switch it connects. Do the same for the CLI and serverless if 5.1 and 5.2 are built.

The manual run against a real pooled URL should come first, not last (see section 9 below).

## Section 9: settle before building, or later

**Settle before building anything.** One short script against one pooled Prisma Postgres database settles all of these, and it needs Will's approval for the database.

- 9.1 and 9.2: the endpoint refuses `options`, accepts a connection without it, and accepts `SELECT set_config(...)`. Capture the full ErrorResponse: SQLSTATE, detail, hint.
- 9.3, the pooling mode: run `SELECT pg_backend_pid()` in two separate autocommit statements, and run `SET lc_monetary = 'C'` followed by `SHOW lc_monetary` in a separate statement. This decides whether the statement path ensures anything after the first transaction, and what the docs in 6.4 say.
- New: does the endpoint keep named prepared statements (finding 7)?
- New: the database's default `DateStyle` and `lc_monetary`, and whether the user may run `ALTER ROLE … SET` (finding 6).
- The question to the Prisma Postgres team (finding 3).

**Settle before the slice that needs it.**

- 9.4, the CLI through the endpoint. The code settles the lock and transaction part (finding 4). Whether DDL and long transactions are allowed is settled by the same manual run, before 5.1.
- 9.5, Hyperdrive and startup options: before 5.2. It does not block `postgres()`.
- Whether Supabase's pooler accepts `options`: it does not block this work, but record it as a follow-up.

## A simpler design

Two choices are tied together in section 4.2: how the settings are applied (startup options or a statement), and how many connections the client holds. The bug is only about the first. Tying the fix to "one connection" means every server that uses a pooled URL must run one statement at a time.

The design that covers every entry point is one explicit switch that means "send no startup options; apply the settings with a statement". It is set by the user, so nothing is guessed. Direct users who leave it off pay nothing. It works with the client-side pool on or off: `pool: false`, built as a pool of one connection, stays as a separate choice for users who want a single connection. It applies to `postgres()` and `postgresServerless()` alike, which also satisfies the type test in finding 5.

For the CLI there are two cheap ways to reach the same switch. One is the statement path always (5.1 A). The other is to carry the switch in the URL, which all three entry points share. Prisma ORM's `?pgbouncer=true` is the precedent. The cost is that `psql` and libpq reject unknown URL parameters, so a user who pastes the URL into `psql` gets an error. I would not carry it in the URL, but it is the only option that needs no configuration on any entry point, so the architect should weigh it.

Simplest of all, if the Prisma Postgres team can make the endpoint accept or ignore `options` (finding 3), only `pool: false` remains, and it is wanted for other poolers anyway.

## Checked and correct

- Section 2: `createPgPool` and `createPgClient` send the settings as `-c` startup options, after any options from the URL or `PGOPTIONS` (`session-settings.ts:34–79`).
- Section 2: the guard applies the settings only to a pool or client the driver did not build (`session-settings.ts:81–100`).
- Section 2: `postgres({ url })` always builds a `createPgPool` pool (`binding.ts:421–444`), and `poolOptions` holds only the two timeouts (`postgres-options.ts:21–24`).
- Section 2: the serverless client builds one `createPgClient` client per `connect` (`postgres-serverless.ts:210–216`). The CLI builds one `createPgClient` client (`control.ts:70–79`).
- Section 2: `postgres({ pg: new Client(url) })` and `postgres({ pg: new Pool(...) })` take the statement path today. Whether they connect through the pooled endpoint is still unverified (9.2).
- Section 4.2: mechanically, the direct driver accepts a client the facade owns with no driver change. The serverless client already binds an owned client this way (`postgres-serverless.ts:216`). It connects lazily on first use (`postgres-driver.ts:1005`), honours `connectionTimeoutMillis` (`pg/lib/client.js:114`, 162–166), and on close waits for the statement in flight before ending the client (952–975). Finding 1 is about what happens under failure and concurrency, not about the wiring.
- Section 5.1: the MySQL control driver applies its settings with one statement after connecting (`control-driver.ts:103–111`).
- Section 6.4: the codecs refuse a value read under the wrong setting and name it; they never set a setting. Both decision records state this.
- Section 4.1: keeping the startup-options path unchanged keeps direct users exactly where they are, and the switch is opt-in, which limits the damage if it is wrong.
