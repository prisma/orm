# Design: connecting to a pooled Prisma Postgres URL

Status: reviewed by the architect and the principal engineer on 2026-11-18 (`review-architect.md`, `review-principal-engineer.md`). Nothing is built. Section 11 is the revised proposal and replaces sections 4.2, 5 and 6 where they differ. It needs Will's decision.

All code references are to the base commit `234d27acb2` (`git show 234d27acb2:<path>`). The branch tip (`claude/pooled-url-startup-options`) holds a superseded implementation that this design replaces; do not read the tip as the current behavior.

## 1. The problem

A user creates a Prisma Postgres database. The console gives a direct URL and a pooled URL (`pooled.db.prisma.io`). With the pooled URL, connecting fails:

```
Failed to connect to upstream database. Please contact Prisma support if the problem persists.
```

Observed in the 2026-11-16 nightly run of the getting-started agent test. In that run a plain `pg.Client` failed with this error when it sent the startup parameter `options: '-c DateStyle=ISO -c lc_monetary=C'`, and connected when it did not. So the pooled endpoint refuses a connection whose startup message carries `options`.

Our PostgreSQL driver sends exactly that startup parameter on every connection it opens.

## 2. What the code does today

The PostgreSQL target declares two session settings: `DateStyle=ISO` (the date and time codecs read ISO text) and `lc_monetary=C` (the `money` codec reads the `C` locale's text). The driver must ensure them on every connection it uses. It has two ways:

- **Startup options.** `createPgPool` and `createPgClient` (`packages/3-targets/postgres/3-driver/src/session-settings.ts`) build a pool or client whose connections send the settings as `-c name=value` in the startup message. No extra round trip. The settings are the session's defaults.
- **A statement.** For a pool or client the driver did not build, `SessionSettingsGuard` (same file) runs `SELECT set_config(...)` once per connection before first use, and again after a connection that was handed out for exclusive use is released.

Three places open connections from a URL. All three use startup options:

| Entry point | Code | Opens |
| --- | --- | --- |
| `postgres({ url })` | `toRuntimeBinding` in `packages/3-targets/postgres/9-facade/src/runtime/binding.ts` | a `pg.Pool` via `createPgPool` |
| `postgresServerless().connect({ url })` | `packages/3-targets/postgres/9-facade/src/runtime/postgres-serverless.ts` | one `pg.Client` via `createPgClient` |
| The CLI (control driver) | `packages/3-targets/postgres/3-driver/src/exports/control.ts` | one `pg.Client` via `createPgClient` |

So all three fail against the pooled endpoint.

One path already works: `postgres({ pg: new Client(url) })` or `postgres({ pg: new Pool(...) })`. The user built the client, so the driver uses the statement path.

`postgres({ url })` always builds a pool. `poolOptions` has two timeouts and nothing else. There is no way to say "do not pool".

## 3. Constraints Will has set

- No retry and no guessing. A connection is made one way. If it fails, the server's error is reported. A different mode exists only if it is the single mode or the user selects it explicitly.
- Direct connections must not get worse. No extra statements for users who connect straight to PostgreSQL.
- A pooled URL already has a pooler. A second, client-side pool in front of it is wrong. The user must be able to turn the client-side pool off through the facade.
- If a user runs `RESET ALL` and loses the settings, that is the user's problem.

## 4. The agreed design

### 4.1 Direct connections do not change

`createPgPool`, `createPgClient`, `pgConnectionConfig` and the startup-options path stay exactly as at the base commit. The public exports stay. No behavior change for `postgres({ url })` with the pool on.

### 4.2 `postgres()` gets an option to turn the client-side pool off

With the pool off, the facade builds a plain `pg.Client` from the URL (not `createPgClient`) and binds it as `{ kind: 'pgClient', client, ownedByDriver: true }`. The driver then treats it as it treats any client it did not build with startup options: it applies the settings with a statement. The driver does not change.

This is shorthand for what a user can already write by hand: `postgres({ pg: new Client(url) })`. The difference is that the facade owns the client, applies its connect timeout, and closes it on `db.close()`.

Proposed shape (name is open, see 6.1):

```ts
const db = postgres({ contract, url: process.env.DATABASE_URL, pool: false });
```

Rules:

- `pool: false` is valid only with `url`. With `pg` or `binding` the user has already chosen, so it fails with `RUNTIME.BINDING_INVALID`.
- `pool: false` together with `poolOptions.idleTimeoutMillis` fails with `RUNTIME.ARGUMENT_INVALID`. `connectionTimeoutMillis` still applies to the one client.
- `db.connect({ url })` (the deferred form) follows the factory's `pool` setting.
- `supabase()` rejects `pool: false`, for the reason it already rejects a `pg.Client`: each role-bound query needs its own connection.

### 4.3 The connect error carries the server's detail

Keep one piece of the superseded branch: `DRIVER.CONNECTION_FAILED` includes the server's detail and hint when the server sends them. Today the user sees only the message.

### 4.4 Everything else on the branch is reverted

The statement-on-every-connection change, the removal of `createPgPool` / `createPgClient` / `pgConnectionConfig`, the removal of the `pg-connection-string` dependency, the amendments to the two decision records, and the pending upgrade notes all go. The pull request is rewritten on top of the base.

## 5. Open: the CLI and the serverless client have no pool to turn off

Section 4 fixes `postgres()`. It does not fix the other two entry points, and the nightly failure was in the CLI. Each opens one client with startup options. There is no client-side pool, so "turn the pool off" does not apply to them. They need their own answer.

### 5.1 The CLI

Options:

- **A. The control driver always applies the settings with a statement.** It builds a plain `pg.Client` and runs the `set_config` statement once after connecting. One path, no option, no guess. Cost: one extra round trip per CLI command. The MySQL control driver already works this way (`packages/3-targets/mysql/1-mysql/3-driver/src/core/migrations/control-driver.ts`).
- **B. A setting in `prisma.config.ts`** that selects the statement path. Adds a configuration concept for one provider's endpoint.
- **C. No change.** The CLI needs the direct URL. The docs say so, and the error (4.3) shows the server's text. The server's text does not tell the user what to do.

Recommendation: A. The cost is one round trip per command, the CLI is not a hot path, and there is nothing for the user to configure.

Unknown: whether migrations work at all through the pooled endpoint once the connection succeeds. The CLI uses session-level features (advisory locks, multi-statement transactions). If the endpoint pools per transaction, those may break, and C would be the honest answer. This must be tested against the real endpoint before choosing.

### 5.2 The serverless client

`postgresServerless().connect({ url })` opens one client per request. Serverless is where pooled URLs are most used. Options:

- **A. Always apply the settings with a statement.** One path. Cost: one extra round trip on every request's connection. That is the "worse for everyone" trade Will rejected for direct connections, applied to serverless.
- **B. An explicit option** on `postgresServerless()` that selects the statement path. Users of an endpoint that refuses startup options turn it on. Others pay nothing. It needs a name that states a fact the user knows, not a mechanism.
- **C. `connect({ pg: client })`.** The serverless connection accepts a client the user built, and the existing statement path applies. No new concept, the same pattern as 4.2, but the user writes the `pg.Client` construction and timeout themselves.

Recommendation: B, with the same option name on `postgres()` if one name can be true for both. See 6.1.

## 6. Open design points inside the agreed part

### 6.1 The option's name

`pool: false` says what the facade does. It fits `postgres()`. It does not fit the serverless client, which never pools. If 5.2 takes option B, two candidates:

- Two names: `pool: false` on `postgres()`, and a different option on `postgresServerless()`.
- One name on both that states the fact about the server, for example "this URL points at a connection pooler". On `postgres()` it would mean no client-side pool and settings by statement; on serverless it would mean settings by statement.

Will's stated expectation is the first form for `postgres()`. The reviewers should say whether one name across both is clearer or whether it hides two different effects behind one word.

### 6.2 What happens when the one connection is lost

A pool replaces a dead connection. A single `pg.Client` does not: after a loss, the direct driver fails every call with `DRIVER.NOT_CONNECTED` ("This pg client lost its connection... Create a new client to reconnect"). Server-side poolers close idle client connections. A long-running server using `pool: false` would stop working after its first idle disconnect and need a restart.

Options:

- **a.** Accept it. Document that `pool: false` is one connection for the life of the client.
- **b.** The facade opens a new client on the next use after a loss. Same URL, same settings, same path; not a retry of a failed operation. Needs new code in the facade or driver.
- **c.** A connection per unit of work: open for each query or transaction, close after. This is what "no client-side pool" means in PgBouncer's own guidance. Cost: a connect handshake per operation.

Recommendation: b. Option a makes the feature unusable for the long-running servers that `postgres()` is for. Option c is a large cost per query.

### 6.3 Concurrency on one connection

With one client, queries run one at a time and a transaction blocks every other query until it ends. This is already how `postgres({ pg: client })` behaves (the driver takes the client's query lock). It must be documented for `pool: false`. No design change proposed.

### 6.4 The settings behind a pooler that pools per transaction

`set_config(..., false)` sets the value for the server session. A pooler that hands out a different server connection per transaction (PgBouncer transaction mode) carries `DateStyle` between server connections but not `lc_monetary`. So after `pool: false` connects:

- Date and time values read correctly.
- A `money` read can land on a server connection without `lc_monetary=C`. The codec then refuses the value and names the setting (this is the recorded behavior: a codec never sets a session setting).

The fix on the user's side is `ALTER ROLE <role> SET lc_monetary = 'C'` or `ALTER DATABASE ... SET`. The docs for `pool: false` must say this.

Unknown: which pooling mode the Prisma Postgres pooled endpoint uses. Not verified.

## 7. What this reverses or touches in recorded decisions

- The decision record on driver terminology and lifecycle says the driver ensures the target's session settings on every connection, and that how is the driver's choice; today it sends startup options on connections it opens. Section 4 does not reverse this. Option 5.1 A changes "how" for the control driver only.
- The decision record on data types and casts describes the startup options and says a codec refuses a value it cannot read when a pooler dropped the setting. Section 6.4 relies on that behavior and does not change it.
- No recorded decision covers a client-side pool switch. I found none that rejects one.

## 8. How we will know it works

- Unit tests in the facade: `pool: false` builds one plain client and no pool; the invalid combinations in 4.2 fail with the stated codes; `db.close()` ends the client.
- A targeted integration test: with `pool: false`, the first query's connection runs the `set_config` statement, and a `timestamp` and a `money` value read correctly against a direct PostgreSQL.
- A test with a local server that refuses a startup message carrying `options`: `postgres({ url })` fails once with `DRIVER.CONNECTION_FAILED` carrying the server's text, and `postgres({ url, pool: false })` connects.
- A manual run against a real pooled Prisma Postgres URL for each entry point this design changes. This creates a cloud database and needs Will's approval. Until it is done, the claim "pooled URLs connect" is unverified.

## 9. Unverified facts this design depends on

1. The pooled endpoint refuses any startup `options`. Seen once, in one nightly transcript, with plain `pg`.
2. The pooled endpoint accepts a connection without `options` and then accepts `SELECT set_config(...)`. Seen: the connect. Not seen: the statement.
3. The pooled endpoint's pooling mode (session or transaction).
4. Whether CLI operations (migrations, introspection) work through the pooled endpoint at all.
5. Whether Cloudflare Hyperdrive accepts startup `options`. The serverless guide calls Hyperdrive the primary tested path, and the serverless client has sent startup options since rc.21.

## 10. Questions for the reviewers

1. Is section 4.2 sound as written: a plain `pg.Client`, bound as driver-owned, with no driver change? Check the direct driver's connect, close and loss handling for a facade-owned client.
2. Section 5: which option for the CLI and for serverless, and why? Is there a simpler single rule that covers all three entry points without making direct connections worse and without guessing?
3. Section 6.1: one option name or two? Does `pool: false` read true?
4. Section 6.2: is reopening after a loss (option b) sound, and where does it belong?
5. What did this document miss or get wrong? Check each claim in section 2 against the base commit.

## 11. Revised proposal after review

Both reviewers found the direction sound and section 4.2 unsafe as written.

### 11.1 What the reviews changed

- **One bare `pg.Client` behind `postgres()` is unsafe in a server.** Section 6.3 is wrong. In the direct driver only `acquireConnection` callers wait for each other. A plain statement from another request takes the same socket and runs inside whatever transaction is open; a test asserts this on purpose (`packages/3-targets/postgres/3-driver/test/driver.stream-portal-protection.integration.test.ts`, "a driver-level streamed query during an open connection transaction does not end it"). So request B's write can land in request A's transaction and be rolled back with it. The same client also never recovers from a connect failure or a lost connection.
- **The rule for session settings is already simpler than section 2 says.** The guard skips the statement only for a pool or client built by `createPgPool` / `createPgClient` with those settings. It does not ask who owns the object. So the rule is: whoever builds the connection decides which settings go in the startup message; the driver applies the rest with a statement.
- **The extra statement runs after every transaction, not once per connection.** The driver forgets the settings when an exclusively held connection is released, and `db.transaction` holds one.
- **The CLI's lock is `pg_advisory_xact_lock`, and each migration runs in one transaction.** A pooler that pools per transaction breaks neither.
- **The two factories must take the same options.** A recorded decision says a serverless connection and a `postgres()` client take the same options apart from where the database is and the pool settings, and a type test enforces it.

### 11.2 The revised design

1. **Direct connections do not change.** As 4.1.
2. **One option on both `postgres()` and `postgresServerless()` that states a fact the user knows: this URL reaches a server-side pooler.** Working name `pooledUrl: true`; Will picks the word. Valid only when the resolved binding is a URL.
   - On `postgres()`: the client keeps one connection instead of a pool of ten, and that connection's startup message carries none of our settings.
   - On `postgresServerless()`: the per-request client's startup message carries none of our settings.
   - On both: the driver applies the two settings with one statement on first use. This is the existing guard, unchanged.
3. **The one connection on `postgres()` is held by pg's pool class limited to one connection**, built with `createPgPool(config, {})` (no startup settings) and bound as a driver-owned `pgPool`. It is still one connection to the server-side pooler. pg's pool gives what a bare client lacks: other callers wait instead of running inside someone else's transaction, a dead connection is replaced on next use, and a failed connect fails one call, not the client forever. No driver change.
4. **No re-apply after a transaction on connections the driver owns.** `RESET ALL` is the user's problem, and the re-apply exists only to undo resets. This makes the cost one statement per connection. It is a small driver change, and the two decision records that describe the re-apply get amended.
5. **The CLI does not change. It needs the direct URL.** The serverless guide already says migrations go to the origin, not through a pooler. The connect error states the server's text and the startup options that were sent, and the docs for the CLI and the getting-started pages say to use the direct URL. (The principal engineer preferred applying the settings by statement in the CLI, at one round trip per command. That is an extra statement on direct connections, which Will has ruled out.)
6. **The connect error carries the server's detail and hint.** As 4.3. Note `postgres({ url })` surfaces a connect failure as a `SqlConnectionError`, sometimes wrapped in `CONTRACT.MARKER_READ_FAILED`, not as `DRIVER.CONNECTION_FAILED`; the detail must reach the user on that path too.
7. **`supabase()` rejects the option**, as it rejects a `pg.Client`.
8. **Docs.** Both decision records and two error texts say "startup options on connections the driver opens, a statement on connections the user supplies". They are amended to state the rule in 11.1. The option's docs say: one connection, queries wait for an open transaction, and behind a pooler that pools per transaction the user must run `ALTER ROLE <role> SET lc_monetary = 'C'` to read and write `money`.

### 11.3 Before building

One manual script against a real pooled Prisma Postgres database settles unknowns 1 to 3 in section 9: that the endpoint refuses `options`, accepts the `set_config` statement, and which pooling mode it uses. It creates and deletes one cloud database and needs Will's approval.

### 11.4 Left out on purpose

- Turning off named prepared statements with the same option. The driver has `preparedStatements: false` for poolers that pool per transaction; the facade does not expose it. Decide after 11.3 shows the pooling mode.
- Whether Cloudflare Hyperdrive accepts startup `options` (unknown 5). Separate check.

## 12. Results from a real pooled Prisma Postgres database (2026-11-18)

Will agreed to section 11. The probe in 11.3 ran against a temporary database from `create-db` (deleted automatically on 2026-11-19). Scripts and output: `probe/probe.mjs`, `probe/probe2.mjs`, `probe/probe.out`, `probe/probe2.out`.

- **The pooled address does not refuse `options`. It refuses some settings inside it.** Accepted as startup options: `DateStyle`, `TimeZone`, `extra_float_digits`. Refused, each with "Failed to connect to upstream database": `lc_monetary`, `statement_timeout`, `search_path`, `lc_messages`. So our connection fails because of `lc_monetary` alone. `-c DateStyle=ISO` alone connects.
- **It pools per transaction.** Two clients connected at once reported the same server process id.
- **`DateStyle` set by statement stays with the client that set it.** Client A set `German`; client B on the same server connection still read `ISO`.
- **`lc_monetary` set by statement lands on the shared server connection.** Client A set it; client B read A's value. So our statement changes it for every client that shares the server connection, and another client's value can reach us. The pooler shares server connections between clients of the same user and database.
- `ALTER ROLE CURRENT_USER SET lc_monetary = 'C'` and `ALTER DATABASE postgres SET lc_monetary = 'C'` both succeed over the direct address. New server sessions then start with `C`. A server connection the pooler already holds keeps its old value until the pooler replaces it.
- `SET LOCAL` (`set_config(..., true)`) inside a transaction works and ends with the transaction.
- Named prepared statements work through the pooled address, inside and outside transactions. `pg_advisory_xact_lock` works inside a transaction.
- The direct address accepts `options` with both settings.

What this means for section 11: the option, the single connection and "no settings in the startup message" still fix the connect failure. The statement on first use sets `DateStyle` reliably. It does not set `lc_monetary` reliably behind this pooler; only the role or database default does. 11.4's question about prepared statements is answered: no change needed for Prisma Postgres.
