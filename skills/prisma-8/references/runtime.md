
# Prisma 8 — Runtime (`db.ts` Wiring)

> **Edit your data contract. Prisma handles the rest.**

This skill covers the **runtime entry point** — `db.ts` — and how to compose the database client with extensions, middleware, and environment configuration.

## When to Use

- User is wiring up `db.ts` for the first time (post-init).
- User wants to add middleware (lints, budgets, cache, custom).
- User wants per-environment config (dev vs prod, multi-region).
- User wants to switch between the Postgres, SQLite, and Mongo façades.
- User wants to wrap operations in `db.transaction(...)` (Postgres and SQLite).
- User is running a one-off script (`tsx my-script.ts`, Node CLI, CI task) and the process won't exit after queries finish, or they need script teardown (`db.close()`, `await using`).
- User is deploying to a per-request runtime (Cloudflare Workers + Hyperdrive, AWS Lambda, Vercel Edge, Deno Deploy, Bun edge) and needs `postgresServerless()` with `postgres.connect({ url })` per request.
- User mentions: *db.ts, postgres(), mongo(), middleware, lints, budgets, cache, query log, slow query, DATABASE_URL, .env, connection pool, poolOptions, dev vs prod, transactions, read replicas, multi-database, script won't exit, hangs, db.close, db.end, close connection, pool.end, await using, serverless, edge, Cloudflare Workers, Hyperdrive, postgresServerless, connect per request*.

## When Not to Use

- User wants to write queries → `references/queries.md`.
- User is on Supabase — the `supabase()` role-first factory, `asUser(jwt)` / `asAnon()` / `asServiceRole()`, JWT config, RLS → `references/supabase.md`.
- User wants to edit the contract → `references/contract.md`.
- User wants to wire Prisma 8 into a build tool (Vite plugin, Next.js, …) → `references/build.md`.
- User wants to debug a connection / runtime error → `references/debug.md`.
- User wants to file a bug or feature request → `references/feedback.md`.

## Key Concepts

- **`db.ts` is the runtime entry point.** Imports the runtime factory from the `@internal/<target>` façade (`@internal/postgres/runtime`, `@internal/sqlite/runtime`, or `@internal/mongo/runtime`), the contract artefacts (`contract.json` + the `Contract` type from `contract.d.ts`), and any middleware. Exports a `db` value the rest of your app imports. On a per-request runtime, `db.ts` imports `postgresServerless` from `@internal/postgres/serverless` instead and exports the serverless client `postgres`; see *Workflow — Serverless and per-request runtimes*.
- **The façade's runtime factory is the only surface user-authored `db.ts` imports from.** Each factory is a *default* export. For Postgres: `import postgres from '@internal/postgres/runtime'`; SQLite: `import sqlite from '@internal/sqlite/runtime'`; Mongo: `import mongo from '@internal/mongo/runtime'`. The factory signature is `<Target><Contract>(options)` — a single type parameter (the `Contract` type from `contract.d.ts`), and one options object.
- **Lazy connect.** The factory does not connect to the database synchronously. `db.sql` and `db.orm` are available immediately; the driver / pool is instantiated on the first call that needs a runtime (or when you explicitly call `await db.connect({ url })`, which binds the client to that URL), and the pool opens its first database connection on the first query. This is why `db.ts` can be imported in modules that load before the env is ready.
- **Middleware composes in order.** The first middleware in the `middleware: [...]` array runs *outermost* — its `beforeQuery` sees the operation first, and `interceptQuery` hooks are consulted in registration order with the first non-`undefined` result winning. Register a cache first so it gets first claim on a hit. Every middleware's `afterQuery` still fires on a cache hit, with `result.source: 'middleware'`.
- **`prisma.config.ts` vs `.env`.** The config (`definePrismaConfig({ orm: ormConfig({ contract, db, extensions, migrations }) })` — see `references/contract.md`) is for static project shape: contract path, installed extensions, migrations directory, default connection string. `.env` is for per-environment values (`DATABASE_URL`, secrets). Nothing reads `.env` on its own: the scaffolded `prisma.config.ts` starts with `import 'dotenv/config'`, and that import is what loads `.env` into `process.env` before the config (and the CLI running it) reads `process.env['DATABASE_URL']`. Keep the import; a config without it sees no `.env` values. Hardcoding `DATABASE_URL` in the config file leaks credentials and bypasses per-env overrides.
- **Build-system / dev-server integration is a separate skill.** `vite dev` auto-emit lives in `references/build.md`. The runtime side (this skill) reads `contract.json` / `contract.d.ts` regardless of how they got onto disk, so the two skills compose cleanly.

## Workflow — Basic `db.ts`

The concept: `db.ts` is the seam between the emitted contract artefacts (target-shaped) and the runtime that executes queries against them. Three imports are required — the runtime factory, the `Contract` type (so the static query surfaces are typed), and the JSON artefact (so the runtime validates the structure at construct time).

`init` scaffolds something like this (for `--target postgres`):

```typescript
// src/prisma/db.ts
import postgres from '@internal/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
```

(The rest of `src/` imports from `./prisma/db` or `../prisma/db` depending on depth.)

Three things to know:

- **`<Contract>` type parameter is required.** Without it, the static surfaces collapse to a generic shape and you lose autocomplete on model names. Always import `Contract` from the emitted `./contract.d.ts`.
- **`with { type: 'json' }` is required.** Node's ESM JSON-import-attribute spec. Without it, the import errors.
- **`url` is optional at construct time.** If `DATABASE_URL` is not set when `db.ts` loads, the factory still returns a client; you can call `await db.connect({ url })` later. The factory throws lazily — only when a runtime is actually needed.

The Mongo façade has the same construction shape — `import mongo from '@internal/mongo/runtime'` — and the same `db.connect(...)` / `db.close()` lifecycle methods. **The Mongo façade does not expose `db.transaction(...)`.** See *What Prisma 8 doesn't do yet* for the workaround. **The ORM surface differs in one place: keys.** On Mongo, `db.orm` is keyed by the collection's storage name (from `@@map(...)`, or the lowercased model name if no `@@map` is set), not by the PSL model name — so `model User { … @@map("users") }` is reached at `db.orm.users`, not `db.orm.public.User`. The SQL builder lane (`db.sql.<ns>.<table>`) doesn't exist on Mongo at all (`db.sql` is `undefined`). See `references/queries.md` § *MongoDB ORM addressing* for the full rule and a rewrite recipe for SQL-target examples.

## Workflow — Running as a script (teardown)

The concept: short scripts that connect, query, then expect the process to exit will **hang on Postgres** because the `pg.Pool` owned by `postgres()` keeps Node's event loop alive. The data round-trip succeeds; the script never exits. Call `await db.close()` before the script returns (or use `await using` **at the top of a script module** so teardown runs when the module exits — see the block-scope warning below for why this matters).

**Plain shape** — export `db` from `db.ts`, import it in the script, close at the end:

```typescript
// src/scripts/hello.ts
import { db } from '../prisma/db';

const created = await db.orm.public.User.create({ email: 'alice@example.com', name: 'Alice' });
const read = await db.orm.public.User.first();
console.log({ created, read });

await db.close();
```

**TS 5.2+ idiomatic shape** — construct the client at the **top of a script module** and let `[Symbol.asyncDispose]` call `close()` when the module exits:

```typescript
// src/scripts/hello.ts — top-level await in a script module
import postgres from '@internal/postgres/runtime';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

await using db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL! });

const user = await db.orm.public.User.first();
console.log(user);
// db.close() runs automatically when the script module exits.
```

### `await using` on a `postgres()` client is **block-scoped** — do not put it inside a request handler

This rule is about the long-lived `postgres()` client. On a per-request runtime, `await using db = await postgres.connect({ url })` inside the handler is the correct pattern; see *Workflow — Serverless and per-request runtimes* below.

This is the most important rule in this section. `await using db = postgres(...)` disposes when the *enclosing block* exits. In a script module, that block is the module body and disposal fires at process exit — fine. In a request handler, the enclosing block is the handler function, so disposal fires **after every request** — a fresh `pg.Pool` per call, TCP-connect storm, hot loop tearing connections up and down.

```typescript
// DO NOT do this — closes the pool after every request.
app.get('/users', async (req, res) => {
  await using db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL! });
  const users = await db.orm.public.User.all();
  res.json(users);
});
```

The right server pattern is a **module-level singleton** in `db.ts`, imported by handlers, never closed during the process lifetime:

```typescript
// src/prisma/db.ts — constructed once, lives for the process
export const db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL });

// src/routes/users.ts
import { db } from '../prisma/db';

app.get('/users', async (req, res) => {
  const users = await db.orm.public.User.all();
  res.json(users);
});
```

Servers (HTTP handlers, workers in a request loop) **do not call `db.close()`** at all in steady state. The pool stays open for the process lifetime. `db.close()` and `await using` are for short-lived scripts — `tsx my-script.ts`, Node CLI commands, CI tasks, one-off seed runs — not for code that runs inside a request loop.

**Semantics:**

- **`close()` is idempotent.** Calling it twice is a no-op.
- **`close()` is terminal.** There is no reconnect on a closed `db` — construct a new client if you need to reach the database again. After close, `db.runtime()`, `db.connect(...)`, `db.transaction(...)`, and `db.prepare(...)` reject with `Error('<target> client is closed')` (e.g. `'Postgres client is closed'`, `'SQLite client is closed'`, `'Mongo client is closed'`).
- **`close()` waits for work already running and refuses new work.** On a Postgres client built from `{ url }`, `close()` refuses every new call at once with `DRIVER.NOT_CONNECTED` ("Postgres client is closed"), and a runtime captured with `db.runtime()` before `close()` is refused at once with "Runtime is closed"; it waits for the queries and transactions already in flight, then ends the pool. Await an ORM write such as `include(...).create()` or a nested create before `close()`, because its reload is a new call. On a serverless connection, `close()` waits until the runtime has been idle for one turn of the event loop, so a chain of queries that keeps it busy from the close onward completes, then ends the `pg.Client`; work that starts after that rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"). A lazy result such as `db.orm...all()` or `db.runtime().query(plan)` starts when it is awaited or iterated, not when it is built. A Postgres client given a caller's `pg.Pool` or `pg.Client` does not close its runtime, so work through a runtime taken before `close()` keeps running on the caller's pool. `await` outstanding work before calling `close()`.
- **Ownership.** `close()` releases only what the façade constructed (`pg.Pool` from `{ url }`, `MongoClient` from `{ url }` / `{ uri, dbName }`, SQLite handle from `{ path }`). If you supplied your own `pg.Pool` / `pg.Client` (Postgres `pg:` option), `mongodb.MongoClient` (Mongo `mongoClient:` option), or a pre-built `binding`, `db.close()` does **not** touch those — you own their lifecycle.

**`db.end()` does not exist.** The universal `node-postgres` name is `pool.end()` on a `pg.Pool`; the Prisma 8 runtime client is not a `pg.Pool`. The right call is `await db.close()`.

## Workflow — Serverless and per-request runtimes

The concept: a per-request runtime (Cloudflare Workers + Hyperdrive, AWS Lambda, Vercel Edge, Deno Deploy, Bun edge) must not keep a database connection at module scope. Use `postgresServerless()` from `@internal/postgres/serverless`. It returns a **serverless client**; name it `postgres`. It holds no database connection. In each request, open a **connection** named `db` with `await using db = await postgres.connect({ url })`. A connection owns one database connection, a `pg.Client`, and `await using` closes it when the handler returns. `db` has the members of a `postgres()` client except `connect`.

```typescript
// src/prisma/db.ts — the serverless client: module scope, built once per isolate, holds no database connection
import postgresServerless from '@internal/postgres/serverless';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const postgres = postgresServerless<Contract>({ contractJson });

// src/worker.ts
import { postgres } from './prisma/db';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString });
    const users = await db.orm.public.User.all();
    return Response.json(users);
  },
};
```

The rule to remember: inside a request, `db` does everything the `db` from `postgres()` does, so any documented `db.orm...`, `db.sql...`, `db.raw...`, `db.transaction(...)`, `db.prepare(...)` or `db.runtime().query(...)` snippet works unchanged. Await every query before the `await using` scope ends. The connection's `close()` waits until the runtime has been idle for one turn of the event loop (a `setTimeout(0)`), then refuses new work. A lazy ORM read such as `db.orm.public.User.all()`, or `db.runtime().query(plan)`, returned from the scope without `await` starts only when the caller awaits it, after the scope has closed, so it rejects with `DRIVER.NOT_CONNECTED` ("Runtime is closed"), whose `fix` names the missing `await`. Work that keeps the runtime busy from the close onward completes: a `first()`, `execute()` or `transaction()`, an ORM write and its reload, including `include(...).create()` and a nested `create()`, and an async helper whose steps go through `db.orm`, `db.transaction()` or `db.prepare()`; a transaction commits. Such work is never refused because of the close; if it fails for its own reason, it rejects like any unawaited promise. A helper that calls `db.runtime()` after the scope has ended throws "Postgres connection is closed" at that call. Work that starts after the runtime was idle for a turn is refused. Whether a query sent after waiting on something other than the database counts as idle depends on when that callback runs relative to the timer, so do not rely on it. An unawaited promise that fails then, or fails for its own reason, rejects like any unawaited promise, and Node reports it as unhandled. Write `return await db.orm...`, not `return db.orm...`.

- **`connect` connects before it returns.** When the database refuses the connection, rejects the credentials, or does not answer within 20 seconds, `postgres.connect({ url })` rejects with `DRIVER.CONNECTION_FAILED` and leaves nothing open; an empty URL, a string that is not a URL, or a scheme other than `postgres://` or `postgresql://` rejects with `RUNTIME.BINDING_INVALID`. Handle an unreachable database at the `connect` call, not at the first query. Answer a request that needs no query, such as an unknown route, before `connect`, because `connect` opens a database connection whether or not a query follows.
- **Never call `connect` at module scope.** A connection opened there is shared by every request in the isolate, and fails in four ways: its database connection goes stale after the isolate idles, concurrent requests queue behind each other on one `pg.Client`, nothing closes it when a request ends, and Cloudflare Workers reject a socket used across requests.
- **`db.orm` is the default way to use the ORM.** Build `orm({ runtime: db.runtime(), context: db.context, collections })` only for custom collection classes, and build it inside the request. See *Workflow — Custom collection classes* in [`queries-postgres.md`](queries-postgres.md).
- **Anything that takes a runtime gets `db.runtime()`.** That includes `orm({ runtime, ... })`, `withTransaction(runtime, fn)` and a prepared statement's `query(runtime, params)`. Do not pass `db` itself to `orm()`.
- **Inside `db.transaction(async (tx) => ...)`, run every query through `tx`.** A connection has one database connection, so inside `db.transaction(async (tx) => ...)` a query through `db` is not independent of the transaction; run every query through `tx`. A query that uses the connection's database connection directly, such as a `db.orm` read, a `db.orm` create of one row, an `updateAll(...)` or `deleteAll()`, or `db.runtime().query(...)`, runs inside the open transaction without saying so. An operation that asks for a database connection of its own, such as a `db.orm` `update(...)` or `delete()` of one row, `db.runtime().connection()`, a `db.orm` create that also writes related rows, or a nested `db.transaction(...)`, waits for the database connection the transaction holds, and the request hangs.
- **After `db.close()`** (or the end of the `await using` scope), `db.runtime()` throws `DRIVER.NOT_CONNECTED` ("Postgres connection is closed"), and ORM queries, `db.transaction(...)` and prepared statements that start after the runtime was idle for a turn reject with `DRIVER.NOT_CONNECTED` ("Runtime is closed"). Call `postgres.connect({ url })` again for a new connection.

How connections read rows, and the `cursor` option on the serverless client (with the Hyperdrive caveat), is in `references/queries.md` § *Streaming*.

## Workflow — Custom middleware (query log, slow-query warning)

The concept: a middleware is a plain object with `name`, `familyId: 'sql'`, and any of the hooks `beforeQuery`, `interceptQuery`, `afterQuery`, `beforeExecute`, `afterExecute`, `afterTransaction`. Row queries fire `afterQuery`; count-style writes fire `afterExecute`. `afterTransaction(plan, result, ctx)` is the last hook of every query whose before-hooks and parameter encoding succeeded (a query that fails in a before-hook or while encoding its parameters gets none), and fires once, when its effects are final: when the query ends outside a transaction, or when the enclosing transaction ends. `result.outcome` is `'committed'`, `'rolled-back'`, or `'unknown'` (a commit or statement that failed and may have landed, a row stream the caller stopped reading outside a transaction, or a committed transaction in which one of the queries failed). There is no separate telemetry package — observe queries with `afterQuery`, which fires once per execution after the rows are consumed, with `result.latencyMs`, `result.rowCount`, and `result.source` (`'driver'` or `'middleware'` for a cache hit). The `SqlMiddleware` type comes from `@prisma/orm-postgres/family-runtime`. `examples/prisma-8-demo/src/prisma/slow-query-warning.ts` is the canonical example:

```typescript
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';

export function slowQueryWarning(options?: { readonly thresholdMs?: number }): SqlMiddleware {
  const thresholdMs = options?.thresholdMs ?? 250;
  return {
    name: 'slow-query-warning',
    familyId: 'sql',
    async afterQuery(plan, result, ctx) {
      if (result.latencyMs <= thresholdMs) return;
      ctx.log.warn({
        code: 'APP.SLOW_QUERY',
        message: `Query took ${result.latencyMs}ms (threshold: ${thresholdMs}ms)`,
        details: { sql: plan.sql, rowCount: result.rowCount, source: result.source },
      });
    },
  };
}
```

A "log every query" middleware is the same shape without the threshold. The runtime also exposes its last telemetry event through `db.runtime().telemetry()`.

## Workflow — Lints and budgets middleware

The concept: lints catch authoring mistakes that survive type-check (e.g. `DELETE` without a `WHERE`, `SELECT` without a `LIMIT` on a large table); budgets enforce row-count and latency ceilings at runtime. Both surface findings through the structured-error envelope so an agent can branch on the code.

Both are exported from the façade's `family-runtime` subpath — `@prisma/orm-postgres/family-runtime` (and `@prisma/orm-sqlite/family-runtime`, `@prisma/orm-mongo/family-runtime`). `examples/prisma-8-demo/src/prisma/db.ts` shows the canonical import.

```typescript
import postgres from '@internal/postgres/runtime';
import { budgets, lints } from '@prisma/orm-postgres/family-runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],
  middleware: [
    lints({
      severities: {
        selectStar: 'warn',
        noLimit: 'error',
        deleteWithoutWhere: 'error',
        updateWithoutWhere: 'error',
        readOnlyMutation: 'error',
      },
    }),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 50_000 },
      maxLatencyMs: 1_000,
      severities: { rowCount: 'error', latency: 'warn' },
    }),
  ],
});
```

For the full option surface, read the source: `packages/2-sql/5-runtime/src/middleware/lints.ts` and `.../budgets.ts`. The `severities` keys (`selectStar`, `noLimit`, `deleteWithoutWhere`, `updateWithoutWhere`, `readOnlyMutation` for lints; `rowCount`, `latency` for budgets) are the source of truth; do not extrapolate to a key that is not in those two files. `lints()` with no argument uses the default severities.

## Workflow — Cache middleware

The concept: `@prisma/orm-extension-middleware-cache` ships an opt-in read cache built on the `interceptQuery` hook. On a hit the driver is never called; on a miss the rows are buffered and stored when the query completes. Only a plan carrying `cacheAnnotation` is cached; `cacheAnnotation({ bypass: true })` skips the cache for one call. Cache keys default to the runtime's content hash of the plan (`key` overrides), and queries inside a transaction or pinned connection bypass the cache. How long an entry lives is the store's policy: the default store keeps up to 1000 entries for 60 seconds each, and `createInMemoryCacheStore({ maxEntries, ttlMs })` changes that (`ttlMs: Infinity` never expires). `CacheStore` is the interface for a Redis-style backend. The cache never sees writes: after the write commits, call `cache.invalidate({ keys })` for reads annotated with a `key`. `cacheAnnotation({ meta })` hands any value to the store with the entry, and `cache.invalidate({ meta })` hands one to its `unset`; only a custom store that indexes `meta` can act on it, and the default store throws `RUNTIME.CACHE_STORE_META_UNSUPPORTED`.

```typescript
import {
  cacheAnnotation,
  createCacheMiddleware,
  createInMemoryCacheStore,
} from '@prisma/orm-extension-middleware-cache';

export const cache = createCacheMiddleware({
  store: createInMemoryCacheStore({ maxEntries: 1_000, ttlMs: 60_000 }),
});
export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: [cache, lints(), budgets({ maxRows: 10_000 })],
});

// Cached for the store's 60 s; an identical read in that window is served without a driver call.
const user = await db.orm.public.User.first({ id: 1 }, (meta) =>
  meta.annotate(cacheAnnotation({ key: 'user-1' })),
);
// Un-annotated queries always hit the database.

// After a write to user 1 has committed (outside the transaction, never inside it):
await cache.invalidate({ keys: ['user-1'] });
```

**Invalidate after the commit, not inside the transaction.** A read from another request can refill the cache with the old rows before the commit lands. A read that missed before the `invalidate` and finishes after it does not store its rows: the store moves the key's version on `unset`, and the read's `set` is conditional on the version it saw. This holds across processes that share a store.

**The cache key carries no identity.** The default key is the runtime's content hash of the plan — contract hash, SQL text, and bound parameters — so two callers issuing the same statement share one entry regardless of who they are. Never annotate a read whose rows depend on the caller (per-user, per-tenant, or RLS-filtered data) on the plain `postgres()` façade unless the identity is part of the key: `cacheAnnotation({ key: `user:${userId}:profile` })`, or a `where` clause that binds the identity as a parameter (the parameter is in the hash). Queries that run on a pinned connection or inside a transaction bypass the cache entirely (`ctx.scope !== 'runtime'`), which is why a Supabase `RoleBoundDb` read — executed on a connection with the role bound via `set_config` — is never served from cache; the plain façade has no such protection.

## Workflow — Compose multiple middleware

```typescript
middleware: [
  createCacheMiddleware(),                      // first — gets first claim on an interceptQuery hit
  lints({ severities: { noLimit: 'error' } }),
  budgets({ maxLatencyMs: 5_000 }),
  slowQueryWarning({ thresholdMs: 250 }),       // afterQuery fires for cache hits too (source: 'middleware')
],
```

Order matters: `beforeQuery` runs in registration order for every middleware before any `interceptQuery` is consulted, so lints and budgets still check a query the cache then answers; `afterQuery` fires for all of them either way.

## Workflow — Configure the connection

The concept: the runtime takes one of three binding shapes — `url`, `pg` (a pre-constructed `pg.Pool` or `pg.Client`), or `binding` (an explicit kind tag). They're mutually exclusive. The `pg` form is for projects that already manage their own pool (e.g. a Lambda layer); `url` is the default. Pool tuning is `poolOptions.connectionTimeoutMillis` / `poolOptions.idleTimeoutMillis` — *not* `driverOptions`. Reads are buffered by default; setting `cursor` (`{ batchSize: 100 }`; `{}` or `{ batchSize: undefined }` for batches of 100; a `batchSize` that is not a positive integer fails the factory call) makes them stream through a server-side cursor, and there is no flag that turns cursors off (see `references/queries.md` § *Streaming*). `postgresServerless()` takes the same `cursor` option.

```typescript
// Default — URL string, factory constructs the pool.
postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],
  poolOptions: {
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
  },
  // cursor: { batchSize: 100 },  // optional — stream reads in batches instead of buffering
});

// BYO pool — pass a pg.Pool you already created.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
postgres<Contract>({ contractJson, pg: pool });
```

The `url` and `pg` keys are mutually exclusive at the type level; passing both errors.

`DATABASE_URL` lives in `.env`. The CLI reads it for emit / verify / migration commands; the runtime reads it through `process.env` at `db.ts` load time.

## Workflow — Per-environment config (dev vs prod)

The concept: one `DATABASE_URL` per environment; the rest of the `db.ts` shape is the same. For middleware divergence (e.g. strict lints in dev only), branch in `db.ts` on `process.env['NODE_ENV']`.

```typescript
const isProd = process.env['NODE_ENV'] === 'production';

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware: isProd
    ? [slowQueryWarning({ thresholdMs: 250 })]
    : [
        slowQueryWarning({ thresholdMs: 250 }),
        lints({ severities: { noLimit: 'error', deleteWithoutWhere: 'error' } }),
      ],
});
```

`.env` for local; the deploy platform's secrets for prod. Never commit `.env`.

## Workflow — Transactions

The concept applies to **Postgres and SQLite**. `db.transaction(fn)` opens a transaction, gives the callback a `tx` context with the same `sql` / `orm` surfaces as `db`, and commits on successful return / rolls back on any thrown error. Inside the callback, use `tx.sql` and `tx.orm` instead of `db.sql` / `db.orm` so the writes ride the transaction. The Mongo façade does not expose `db.transaction(...)`.

```typescript
await db.transaction(async (tx) => {
  const user = await tx.orm.public.User.create({ email: 'alice@example.com' });
  await tx.orm.public.Post.create({ userId: user.id, title: 'hello' });
  // If either call throws, both inserts roll back.
});
```

The callback returns whatever you return from it — the transaction wrapper passes it through. The `tx` object exposes `query(plan)` (rows) and `execute(plan)` (affected count) for SQL-builder plans inside the transaction.

## Workflow — Switch between Postgres, SQLite, and Mongo

The concept: the façade selection is baked into `db.ts` (`@internal/postgres` or `@internal/mongo`) and `prisma.config.ts` (which target's `config` subpath `ormConfig` is imported from). To switch a project's target, re-run `prisma orm init` in the same directory and pick the other target — the init flow detects the existing scaffold and prompts to reinit (non-interactive runs grant the consent with `--confirm <directory name>`). PN re-scaffolds `prisma.config.ts` and `db.ts` for the new façade. The contract source needs to be re-authored for the new target's idioms (Mongo expresses nested documents; Postgres expresses relations).

After the switch (Mongo):

```typescript
// src/prisma/db.ts (Mongo)
import mongo from '@internal/mongo/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = mongo<Contract>({ contractJson, url: process.env['DATABASE_URL'] });
```

SQLite:

```typescript
// src/prisma/db.ts (SQLite)
import sqlite from '@internal/sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = sqlite<Contract>({ contractJson, path: 'app.db' });
```

`path` is optional at construct time (you can call `db.connect({ path })` later); omit it and the façade still returns a client. The SQLite façade exposes the same `db.sql`, `db.orm`, `db.transaction(...)`, `db.close()`, and `[Symbol.asyncDispose]` surfaces as Postgres, with one addressing difference: SQLite has no schemas, so `db.sql` and `db.orm` are the unbound namespace itself (`db.orm.User`, `db.sql.user`) instead of Postgres's `db.orm.public.User` / `db.sql.public.user`. The Mongo façade shares `db.orm`, `db.close()`, and `[Symbol.asyncDispose]` but has no `db.sql` and no `db.transaction(...)`.

The `db.sql` / `db.orm` surfaces stay the same in name; the operators each surface exposes are target-shaped (Mongo has no `JOIN`).

## Workflow — Build-system / dev-server integration

If you want contract artefacts to re-emit automatically while the dev server is running (instead of running `prisma contract emit` by hand each time the contract source changes), reach for the build-tool plugin from `references/build.md`:

- **Vite**: install `@internal/vite-plugin-contract-emit` and register `prismaVitePlugin('prisma.config.ts')` in `vite.config.ts`.
- **Next.js, Webpack, esbuild, Rollup, Turbopack**: no first-party plugin yet — the workaround is a `prebuild` script that runs `prisma contract emit`. See `references/build.md` for the walkthrough.

The runtime side (this skill) is the same regardless: `db.ts` reads `contract.json` + `contract.d.ts` from disk. The build-system plugin's job is to keep those files current during development.

## Common Pitfalls

1. **Hardcoding `DATABASE_URL` in `prisma.config.ts`.** Leaks credentials; bypasses per-environment overrides. Use `.env`.
2. **Omitting the `<Contract>` type parameter** in `postgres<Contract>(...)`. Without it, static surfaces collapse to a generic shape and you lose autocomplete for models. There is no second type parameter — the older two-param signature (`postgres<Contract, TypeMaps>`) is gone.
3. **Forgetting `with { type: 'json' }` on the contract import.** Required by Node's ESM JSON-import-attribute spec.
4. **Middleware order matters.** Registration order is hook order; put the cache first so its `interceptQuery` is consulted first.
5. **Importing middleware from a non-existent package or subpath.** There is no `@internal/postgres/middleware` subpath and no `@internal/middleware-telemetry` package. `lints` / `budgets` / `SqlMiddleware` come from `@prisma/orm-postgres/family-runtime`; the cache comes from `@prisma/orm-extension-middleware-cache`; a query log or telemetry hook is a custom `afterQuery` middleware (above).
6. **Confabulating lint / budget option names.** Lints take `severities` (with the five keys above), not `requireWhere` / `maxRowsWithoutLimit`. Budgets use `maxLatencyMs` (not `maxDurationMs`) plus `maxRows` / `defaultTableRows` / `tableRows`. When in doubt, read the source.
7. **Switching targets without re-emitting.** The contract artefacts are target-shaped; emit after the target change.
8. **Script hangs after queries finish on Postgres.** The `pg.Pool` keeps Node's event loop alive. Solution: `await db.close()` before the script returns, or `await using db = postgres<Contract>(...)` at the top of a script module. Do not put `await using db = postgres(...)` inside a request handler — it's block-scoped and would close the pool after every request. The right server pattern is a module-level singleton in `db.ts` that lives for the process lifetime. On a per-request runtime, use `postgresServerless()` and `await using db = await postgres.connect({ url })` in the handler instead (see *Workflow — Serverless and per-request runtimes*).

## What Prisma 8 doesn't do yet

- **A `/middleware` subpath or a telemetry package.** Neither exists. The middleware surface is `lints`, `budgets`, and the `SqlMiddleware` type on `@prisma/orm-postgres/family-runtime`, plus the separately installed `@prisma/orm-extension-middleware-cache`. Anything else (query log, tracing spans, metrics) is a custom `afterQuery` middleware you write. File additional gaps you hit via `references/feedback.md`.
- **Multi-database routing / read replicas.** Prisma 8 doesn't ship a built-in primary/replica router or shard-aware client. Workaround: configure separate `db.ts` instances per data store and call the right one in your application code. If you need first-class multi-database routing, file a feature request via the `references/feedback.md` skill.
- **Connection pooling as a first-class config field.** `poolOptions.connectionTimeoutMillis` and `poolOptions.idleTimeoutMillis` are wired through, but the rest of `pg.Pool`'s tuning surface (max connections, `allowExitOnIdle`, ssl options, …) is not exposed by name. Workaround: construct the `pg.Pool` yourself and pass it via `pg:`. If you need more pool fields surfaced on the façade, file a feature request via the `references/feedback.md` skill.
- **Query logger middleware as a built-in.** Prisma 8 doesn't ship a "log every query" middleware. Workaround: a custom `afterQuery` middleware (see *Workflow — Custom middleware*). If you need a built-in query log, file a feature request via the `references/feedback.md` skill.

## Reference Files

This skill is intentionally body-only; `prisma orm init --help`, the target `defineConfig` (`ormConfig`) factory in `packages/3-extensions/postgres/src/config/define-config.ts`, the `postgres()` factory in `packages/3-extensions/postgres/src/runtime/postgres.ts`, the middleware sources in `packages/2-sql/5-runtime/src/middleware/{lints,budgets}.ts`, and `packages/3-extensions/middleware-cache/README.md` are the authoritative surfaces for option-level detail. When in doubt, read the source.

## Checklist

- [ ] `db.ts` imports the runtime factory from `@internal/<target>/runtime` (`postgres`, `sqlite`, or `mongo`) and the `Contract` type from `./contract.d`.
- [ ] `with { type: 'json' }` on the contract JSON import.
- [ ] `<Contract>` is the single type parameter on `postgres<Contract>(...)` (no second parameter).
- [ ] `DATABASE_URL` lives in `.env`, not in `prisma.config.ts`.
- [ ] Middleware ordered intentionally (cache first when used).
- [ ] `lints` / `budgets` imported from `@prisma/orm-postgres/family-runtime` and using the verified option keys (`severities`, `maxLatencyMs`, `maxRows`, `tableRows`).
- [ ] Per-env divergence (if any) gated by `NODE_ENV` or similar.
- [ ] Did NOT hardcode credentials in any committed file.
- [ ] Did NOT confabulate a `@internal/postgres/middleware` subpath, a `@internal/middleware-telemetry` package, a `@internal/postgres-extension-audit` package, or a second type parameter on `postgres<...>`.
- [ ] Did NOT claim `db.transaction(...)` exists on the Mongo façade — only Postgres and SQLite expose it.
- [ ] Did NOT confabulate read-replica / multi-DB / extra pool config — pointed at *What Prisma 8 doesn't do yet* and routed to `references/feedback.md`.
- [ ] For build-system / dev-server prompts (Vite plugin, Next.js plugin, …) routed to `references/build.md`.
