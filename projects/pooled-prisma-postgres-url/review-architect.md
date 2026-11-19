# Architect review: connecting to a pooled Prisma Postgres URL

Verdict: **sound with changes.** The core move fits the system: the facade builds the connection from a URL, binds it as a driver-owned `pgClient`, and the driver's existing statement path sets the session settings. But `pool: false` carries two unrelated effects under one name. The rule for how a connection gets its session settings is not written down anywhere true. And sections 5 and 6 would add three separate answers to one question.

All references are to the base commit `234d27acb2`.

## Findings, most important first

### 1. `pool: false` changes how session settings arrive, and its name does not say so

**What the design says.** Section 4.2: with the pool off, the facade builds a plain `pg.Client` instead of calling `createPgClient`. So the driver applies the settings with a statement. The option is named `pool: false`.

**What is wrong.** Two independent things are tied to one switch:

- how many connections the client keeps: a pool, or one connection;
- how the session settings arrive: in the startup message, or by a statement.

The second effect is what fixes the pooled URL. The first is the one the name describes. Someone reading `postgres({ url, pool: false })` for the first time expects "one connection, no pool". Nothing tells them it also changes how `DateStyle` and `lc_monetary` are set, or that this is why a pooled URL then connects. The reverse also holds: a user who connects straight to PostgreSQL and turns the pool off for a script pays a statement they never asked for. That is the coupling showing.

The system already keeps these two things apart everywhere else. `postgres({ pg: new Pool(url) })` is a pool whose settings arrive by statement. `postgresServerless().connect({ url })` is one connection whose settings arrive at startup (`packages/3-targets/postgres/9-facade/src/runtime/postgres-serverless.ts:210-216`). Only the new URL path would tie them together.

The design's own sections 5.2 and 6.1 show the cost. The serverless client needs the second effect without the first, so the design reaches for a second name. A third may follow for the CLI.

**Evidence that the system already has this concept under another name.** The driver has `preparedStatements: false`, documented as "Set `false` when running behind a transaction-mode pooler" (`packages/3-targets/postgres/3-driver/src/postgres-driver.ts:84-91`). The facade does not expose it: `postgres()` calls `driverDescriptor.create({ cursor })` only (`postgres.ts:164-166`). So "the URL reaches a server-side pooler" already has one switch named after its mechanism. This design would add a second mechanism-named switch, and section 5.2 a third, all for the same fact.

**What I would do instead.** Name the option after the fact the user knows, and derive the mechanisms from it. The Prisma Postgres console calls the URL "pooled" (design section 1), and Prisma users know "pooled URL" and "direct URL". The option means "this URL reaches a server-side connection pooler". A candidate name is `pooledUrl: true`; Will picks the word. Each factory lists its consequences in the docs:

- `postgres()`: no startup settings, so the driver sets them by statement. No client-side pool, which is Will's direction.
- `postgresServerless()`: no startup settings, so the driver sets them by statement.

If Will wants to keep `pool: false` as a pure topology switch, then it must not also select the settings path, and the settings path needs its own name, shared by both factories (see finding 4). Of the two, I recommend the single option named after the fact. One fact, one option, the same meaning on both factories, and direct connections pay nothing.

### 2. One rule for session settings exists in the code but not in the control driver or the records

**What the design says.** Section 2 says that for "a pool or client the driver did not build", `SessionSettingsGuard` runs the statement. Section 5.1 A has the control driver build a plain client and "run the `set_config` statement once after connecting".

**What is wrong.** The rule the code actually follows is not "the driver did not build it". `SessionSettingsGuard` skips the statement only for a pool or client made by `createPgPool` or `createPgClient` with the same settings. It tracks this in a hidden lookup table filled in by those two functions (`packages/3-targets/postgres/3-driver/src/session-settings.ts:54-55, 66-79, 81-100`). The facade builds the pool for `postgres({ url })` (`packages/3-targets/postgres/9-facade/src/runtime/binding.ts:429-443`), not the driver, and that pool still skips the statement. So the rule is: **a setting the connection's builder put in the startup message is not sent again; the driver sets every other setting by statement.**

The runtime driver follows that rule on all three binding kinds. The control driver does not follow it at all. `PostgresControlDriver` has no guard and no statement path. It relies only on `createPgClient` (`packages/3-targets/postgres/3-driver/src/exports/control.ts:19-58, 70-80`). Section 5.1 A would give the control driver a second, hand-written way to apply the settings, next to `SessionSettingsGuard`.

**What I would do instead.** State that rule once and make every entry point follow it:

1. Whoever builds the pg connection decides which of the target's settings go in the startup message. It does that through the driver's existing `createPgPool(config, settings)` and `createPgClient(config, settings)`. Passing `{}` means none go at startup. Today the guard already reads `{}` as "every setting still needs a statement" (`session-settings.ts:81-87`).
2. Every PostgreSQL driver, runtime and control, uses `SessionSettingsGuard` to set by statement whatever did not go at startup. The control driver adopts the guard; it does not get its own `set_config` code.

The single rule is then: settings go in the startup message unless the user said the URL reaches a server-side pooler; whatever did not go at startup, the driver sets by statement. This covers all three entry points. Direct connections send no extra statement. Nothing depends on why a connection failed. It also keeps all construction of pg objects in the driver package, which is how the base commit works. Today the facade only imports pg types (`binding.ts:10`, `postgres.ts:14`). Section 4.2 has the facade call `new Client(...)` from `pg` directly, which would make it the first place outside the driver that constructs a pg object from a URL. Use `createPgClient(config, {})` instead.

### 3. The decision records describe a rule that section 4.2 makes false

**What the design says.** Section 7: section 4 does not reverse the decision record on driver terminology and lifecycle.

**What is wrong.** It does not reverse the decision, which leaves "how" to the driver. But the records describe the PostgreSQL behavior by who supplied the connection, and section 4.2 creates a case that description gets wrong:

- The decision record on driver terminology and lifecycle, at "A target's session settings" (line 108): "The PostgreSQL driver sends them as startup options on connections it opens. On a pool or client the user supplies, it applies them with a statement."
- The decision record on data types and casts (line 380): "It starts each connection it opens with `options=-c DateStyle=ISO` … On a `pg.Pool` or `pg.Client` the application supplies, it sets `DateStyle=ISO` with a statement". Line 384 says the same for `lc_monetary`.
- The user-facing error texts say the same thing: `packages/3-targets/postgres/1-target/src/core/errors.ts:147` and `:160` ("it starts each connection it opens with it, and sets it on a connection the application supplies").

With `pool: false`, the driver owns the client and opens it (`postgres-driver.ts:1005, 1023-1032`), and still sends a statement. The application did not supply it. So all three texts become false for that case.

**What I would do instead.** Amend both records and both error texts to state the rule from finding 2: settings in the startup message when the connection's builder put them there, by statement otherwise, and a pooled URL is a case where the builder puts none. Section 4.4 reverts the earlier branch's amendments to the two records. That is right, but this design needs amendments of its own, and section 7 should say so.

### 4. One name or two: the record on serverless connections decides it

**What the design says.** Section 6.1 asks whether one option name should cover `postgres()` and `postgresServerless()`, or two.

**What is wrong.** The design does not cite the recorded rule that answers this. The decision record that a serverless Postgres connection has the same query interface as a `postgres()` client says: "`postgres()` and `postgresServerless()` take the same options, apart from where the database is and the pool settings, with the same defaults" (line 77).

- A switch that turns the client-side pool off is a pool setting. It belongs on `postgres()` only, which is consistent with that record.
- A switch that changes how the session settings arrive is not a pool setting. If the serverless client gets one, the record requires `postgres()` to take the same option with the same meaning.

So two names, where the serverless one does not exist on `postgres()`, contradicts that record. One name that means "settings by statement" on serverless and "no pool, and settings by statement" on `postgres()` also breaks it, unless the name states a fact whose consequences differ by factory. That is finding 1's recommendation. Of the options in 6.1, only the fact-named option is consistent with the record. If Will keeps `pool: false`, it may exist only as a pure pool setting next to a shared settings option.

### 5. Option 5.1 A is the trade Will rejected, applied to the CLI, and it conflicts with the serverless guide

**What the design says.** In 5.1, the recommendation is A: the control driver always applies the settings by statement. In 5.2, the design calls the same move for serverless "the 'worse for everyone' trade Will rejected".

**What is wrong.** The two sections reason differently about the same move. 5.1 A sends a statement on every CLI connection for every user, direct or pooled. That is the rejected design, limited to the CLI. It may be the right call for a path that does not run often, but the design should say so plainly instead of leaning on the MySQL precedent. MySQL is not a precedent for a split. Its runtime and control drivers both always use the statement (`packages/3-targets/mysql/1-mysql/3-driver/src/core/migrations/control-driver.ts:103-111`, `.../runtime/mysql-driver.ts:602-608`). So MySQL has one rule. 5.1 A would give PostgreSQL two: startup options at runtime, a statement in the CLI.

It also runs against a recorded position. The Serverless Deployment Guide says: "Migrations stay on Node, against the **origin** database connection string (not Hyperdrive)", and "The control-plane (migrations) path goes Node → origin directly" (lines 62 and 296). Its reasons are specific to Hyperdrive, but the position is that control-plane operations do not go through a pooler. Unverified fact 4 in the design (do migrations work through the pooled endpoint at all) is exactly the question that position answers.

**What I would do instead.** Under the rule in finding 2, the CLI's choice is one line: it builds its client with no startup settings (A), or with all of them (C). Settle unknown 4 first. If migrations do not work through the pooled endpoint, C is the consistent answer: the CLI needs the direct URL, as the guide already says. If they do work and Will wants the CLI to accept pooled URLs, take A through `SessionSettingsGuard`, say that it is the rejected trade accepted for a path that does not run often, and update the guide. Do not choose option B for the CLI. It would make the user state in `prisma.config.ts` a fact they have already stated in their runtime code.

### 6. The validation rules in 4.2 depend on which input form was used, which the binding throws away

**What the design says.** "`pool: false` is valid only with `url`. With `pg` or `binding` the user has already chosen, so it fails with `RUNTIME.BINDING_INVALID`." And "`db.connect({ url })` follows the factory's `pool` setting."

**What is wrong.**

- `url` and `binding: { kind: 'url', url }` resolve to the same value (`binding.ts:285` and `:367`). With `binding: { kind: 'url' }` the user has chosen a URL, not a pool. The rule as written would have to remember which input form was used, which breaks the equivalence the binding module sets up.
- The design does not say what `db.connect({ pg })` or `db.connect({ binding })` do when the factory has `pool: false`. `connect` takes the full binding input (`postgres.ts:50, 237-239`).
- `poolOptions` is silently ignored with `pg` today (`binding.ts:425-427`). A new option on the same object that fails with `pg` is a mismatch. Failing is better, but the mismatch should be deliberate and noted.
- `supabase()` shares `PostgresOptionsBase` (`packages/3-extensions/supabase/src/runtime/supabase.ts:174-182`) and `connectWithBinding`. If the option goes on `PostgresOptionsBase`, its type offers an option it must refuse when the code runs.

**What I would do instead.** Base the rule on the resolved binding kind: the option is allowed with any URL binding and fails with `pgPool` or `pgClient`, whether those come from the factory or from `connect`. Put the option on `postgres()`'s own options type, not `PostgresOptionsBase`, so the type keeps it out of `supabase()`. Keep the runtime refusal for JavaScript callers.

### 7. `poolOptions` would configure something that is not a pool

**What the design says.** With `pool: false`, `poolOptions.connectionTimeoutMillis` still applies to the one client, and `poolOptions.idleTimeoutMillis` fails.

**What is wrong.** `pool: false, poolOptions: { connectionTimeoutMillis }` contradicts itself on first reading. The README says "When URL binding is used, pool timeouts are configurable via `poolOptions`" (`packages/3-targets/postgres/9-facade/README.md:207`). The connect timeout already has three names: `poolOptions.connectionTimeoutMillis`, `ControlDriverConnectOptions.connectTimeoutMs` (`control.ts:75`), and the serverless client's fixed `DEFAULT_CONNECT_TIMEOUT_MILLIS` (`postgres-options.ts:18`).

**What I would do instead.** If the option keeps a pool (finding 8), `poolOptions` stays true and the problem goes away. If it does not, accept the mismatch for now, document it, and record the three connect-timeout names as debt. Do not rename `poolOptions` in this change.

### 8. Reopening after a lost connection would rebuild what `pg.Pool` already does

**What the design says.** Section 6.2 recommends option b: the facade opens a new client on the next use after a loss.

**What is wrong.** Replacing a dead connection is what a pool does. Option b would write a second version of it, in the facade or the driver. It cannot go in the direct driver. That driver is built around one connection for its whole life, and it tells the user to "Create a new client to reconnect" (`postgres-driver.ts:993-1004`). A caller's own `pg.Client` cannot be reopened anyway. So option b would have to live in the facade, which would close and reconnect its unbound driver and track that state next to `driverConnected` and `connectPromise` (`postgres.ts:118-146`). That is a new abstraction with no current counterpart.

**What I would do instead.** Put this choice to Will. A `pg.Pool` with `max: 1`, built with no startup settings, gives one server connection that is replaced when it dies. It needs no new code, and the binding stays `pgPool`. Queries still run one at a time, as in 6.3. Whether that counts as "a client-side pool in front of a pooler" is Will's call, because his objection may be to a second pooling layer, not to the word. If he says no, option a (one connection for the client's life, documented) is the honest version of `pool: false`, and option b should be rejected as a pool built by hand.

### 9. Smaller points on the vocabulary

- Section 4.2 says "the facade owns the client … and closes it on `db.close()`". In the binding vocabulary, the owner is the driver: `ownedByDriver: true` means "the driver ends the client on close" (`postgres-driver.ts:70`). The runtime closes the driver, and the driver ends the client. Say "driver-owned", as the serverless client already does (`postgres-serverless.ts:216`).
- `connectWithBinding` ends a driver-owned pool when connecting fails, but not a driver-owned client (`binding.ts:456-458`). A driver-owned `pgClient` from the facade is new for `postgres()`, so handle the two kinds the same way.
- The driver's own `url` binding builds a pool with startup settings and fixed timeouts (`postgres-driver.ts:1045-1062`). The facade never uses it: it turns a URL into a `pgPool` itself (`binding.ts:419-444`). After this change, `url` means two different things at the two layers. The design should say the driver's `url` binding is unchanged and keeps meaning "a pool with startup settings". Record the duplicate URL-to-pool code as debt.

## Section 2 claims checked against the base commit

- "`createPgPool` and `createPgClient` build a pool or client whose connections send the settings as `-c name=value` in the startup message. No extra round trip. The settings are the session's defaults." **Correct** (`session-settings.ts:25-29, 31-52, 57-79`). The settings are added after any `options` from the URL or `PGOPTIONS` (line 49-50).
- "For a pool or client the driver did not build, `SessionSettingsGuard` runs `SELECT set_config(...)` once per connection before first use, and again after a connection that was handed out for exclusive use is released." **Imprecise.** The test is not whether the driver built it. The test is whether `createPgPool` or `createPgClient` built it with the same settings (`session-settings.ts:81-100`). The facade builds the `postgres({ url })` pool and the serverless client, and both skip the statement. The rest is correct: once per client (`:102-113`) and forgotten on release, for pool connections (`postgres-driver.ts:823-825`) and for the direct client (`:915-917`).
- "The driver must ensure them on every connection it uses. It has two ways." **True of the runtime driver only.** The control driver has one way, startup options, and no guard (`control.ts:19-58`).
- Table row `postgres({ url })`: `toRuntimeBinding` builds a `pg.Pool` with `createPgPool`. **Correct** (`binding.ts:421-444`).
- Table row `postgresServerless().connect({ url })`: one `pg.Client` with `createPgClient`. **Correct** (`postgres-serverless.ts:210-216`), bound as `{ kind: 'pgClient', ownedByDriver: true }`.
- Table row, the CLI: one `pg.Client` with `createPgClient`. **Correct** (`control.ts:70-80`).
- **Missing from the table:** the driver's own `url` binding, which also builds a pool with startup settings (`postgres-driver.ts:1045-1062`). The adapter's integration tests use it (for example `packages/3-targets/postgres/2-adapter/test/money-param-cast.integration.test.ts:124`). It is not a user entry point through the facade.
- "`postgres({ pg: new Client(url) })` or `postgres({ pg: new Pool(...) })` … the driver uses the statement path." **Correct** (`binding.ts:425-427`; the guard is built at `postgres-driver.ts:809` and `:890-893`). Whether this works against the pooled endpoint is still unverified (design section 9, item 2).
- "`postgres({ url })` always builds a pool. `poolOptions` has two timeouts and nothing else." **Correct** (`postgres-options.ts:21-24`).
- "Our PostgreSQL driver sends exactly that startup parameter on every connection it opens." **Correct for connections built with startup settings.** The target declares `{ DateStyle: 'ISO', lc_monetary: 'C' }` in that order (`packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts:26`).

## What I checked and found correct

- Binding a facade-built `pg.Client` as `{ kind: 'pgClient', client, ownedByDriver: true }` needs no driver change. The direct driver connects it lazily (`postgres-driver.ts:1005, 1012-1032`), applies the guard (`:1006`), and ends it on close because it is driver-owned (`:957-974`). The serverless client already binds a client this way.
- The plan fits the binding vocabulary in the decision record on driver terminology and lifecycle: `url`, `pgPool` and `pgClient`, each owned by the driver or not. It adds no binding kind. The facade remains the boundary that turns options into a binding, which is the record's responsibilities table (line 51).
- The facade is the right layer to decide pool or single client. It already makes that decision for URLs (`binding.ts:421-444`, `postgres-serverless.ts:210-216`). It should still build the object through the driver's `createPgClient` (finding 2).
- 4.1, leaving the startup-options path and its exports unchanged, is consistent with both records.
- 6.4 relies on the recorded rule that a codec never sets a session setting and instead refuses a value it cannot read. The design does not change that rule. The record on driver terminology and lifecycle states it at line 110.
- Rejecting `pool: false` in `supabase()` follows the reason `supabase()` already gives for refusing a `pg.Client` (`supabase.ts:288-297`).
- No decision record rejects a client-side pool switch. I found none in the decision records, the glossary (`docs/glossary.md`, which defines "driver" only loosely), or the facade README.

## What I read

- The architect persona.
- The design.
- At `234d27acb2`, these source files: `session-settings.ts`, `postgres-driver.ts`, the driver's `exports/runtime.ts` and `exports/control.ts`, the facade's `binding.ts`, `postgres.ts`, `postgres-options.ts` and `postgres-serverless.ts`, the facade README, `supabase.ts`, and the MySQL control driver.
- The PostgreSQL target's `errors.ts` and `descriptor-meta-runtime.ts`.
- These decision records: the one on driver terminology and lifecycle, the one on data types and casts (the sections on dates and money), the one saying a serverless Postgres connection has the same query interface as a `postgres()` client, and the one on session-coupled connections (skimmed; not relevant).
- The Serverless Deployment Guide and `docs/glossary.md`.
