
# Prisma Next — Runtime (`db.ts` Wiring)

> **Edit your data contract. Prisma handles the rest.**

This skill covers the **runtime entry point** — `db.ts` — and how to compose the database client with extensions, middleware, and environment configuration.

## When to Use

- User is wiring up `db.ts` for the first time (post-init).
- User wants to add middleware (telemetry, lints, budgets, custom).
- User wants per-environment config (dev vs prod, multi-region).
- User wants to switch between the Postgres, SQLite, and Mongo façades.
- User wants to wrap operations in `db.transaction(...)` (Postgres and SQLite).
- User is running a one-off script (`tsx my-script.ts`, Node CLI, CI task) and the process won't exit after queries finish, or they need script teardown (`db.close()`, `await using`).
- User mentions: *db.ts, postgres(), mongo(), middleware, telemetry, lints, budgets, DATABASE_URL, .env, connection pool, poolOptions, dev vs prod, transactions, read replicas, multi-database, script won't exit, hangs, db.close, db.end, close connection, pool.end, await using*.

## When Not to Use

- User wants to write queries → `references/queries.md`.
- User is on Supabase — the `supabase()` role-first factory, `asUser(jwt)` / `asAnon()` / `asServiceRole()`, JWT config, RLS → `references/supabase.md`.
- User wants to edit the contract → `references/contract.md`.
- User wants to wire Prisma Next into a build tool (Vite plugin, Next.js, …) → `references/build.md`.
- User wants to debug a connection / runtime error → `references/failure-modes.md`.
- User wants to file a bug or feature request → `references/feedback.md`.

## Key Concepts

- **`db.ts` is the runtime entry point.** Imports the runtime factory from the `@prisma/orm-<target>` façade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or `@prisma/orm-mongo/runtime`), the contract artefacts (`contract.json` + the `Contract` type from `contract.d.ts`), and any middleware. Exports a `db` value the rest of your app imports.
- **The façade's runtime factory is the only surface user-authored `db.ts` imports from.** Each factory is a *default* export. For Postgres: `import postgres from '@prisma/orm-postgres/runtime'`; SQLite: `import sqlite from '@prisma/orm-sqlite/runtime'`; Mongo: `import mongo from '@prisma/orm-mongo/runtime'`. The factory signature is `<Target><Contract>(options)` — a single type parameter (the `Contract` type from `contract.d.ts`), and one options object.
- **Lazy connect.** The factory does not connect to the database synchronously. Static query surfaces (`db.sql`, `db.orm`) are available immediately; the driver / pool is instantiated on the first call that needs a runtime (or when you explicitly call `await db.connect({ url })`). This is why `db.ts` can be imported in modules that load before the env is ready.
- **Middleware composes in order.** The first middleware in the `middleware: [...]` array runs *outermost* — it sees the operation first on the way in and last on the way out. Telemetry first means budget / lint failures show up inside telemetry spans.
- **`prisma.config.ts` vs `.env`.** The config — `definePrismaConfig({ orm: ormConfig({ contract, db, extensions, migrations }) })`, composing `definePrismaConfig` from `@prisma/cli-engine` with the façade's `defineConfig` (imported as `ormConfig`) — is for static project shape: contract path, installed extensions, migrations directory, default connection string. `.env` is for per-environment values (`DATABASE_URL`, secrets). The config reads `.env` automatically via `dotenv/config`. Hardcoding `DATABASE_URL` in the config file leaks credentials and bypasses per-env overrides.
- **Build-system / dev-server integration is a separate skill.** `vite dev` auto-emit lives in `references/build.md`. The runtime side (this skill) reads `contract.json` / `contract.d.ts` regardless of how they got onto disk, so the two skills compose cleanly.

## Workflow — Basic `db.ts`

The concept: `db.ts` is the seam between the emitted contract artefacts (target-shaped) and the runtime that executes queries against them. Three imports are load-bearing — the runtime factory, the `Contract` type (so the static query surfaces are typed), and the JSON artefact (so the runtime validates the structure at construct time).

`init` scaffolds something like this (for `--target postgres`):

```typescript
// src/prisma/db.ts
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],
});
```

(`init` currently scaffolds at `prisma/db.ts` instead — see TML-2532 in `references/quickstart.md`. The canonical path is `src/prisma/db.ts`; the rest of `src/` imports from `./prisma/db` or `../prisma/db` depending on depth.)

Three things to know:

- **`<Contract>` type parameter is load-bearing.** Without it, the static surfaces collapse to a generic shape and you lose autocomplete on model names. Always import `Contract` from the emitted `./contract.d.ts`.
- **`with { type: 'json' }` is required.** Node's ESM JSON-import-attribute spec. Without it, the import errors.
- **`url` is optional at construct time.** If `DATABASE_URL` is not set when `db.ts` loads, the factory still returns a client; you can call `await db.connect({ url })` later. The factory throws lazily — only when a runtime is actually needed.

The Mongo façade has the same construction shape — `import mongo from '@prisma/orm-mongo/runtime'` — and the same `db.connect(...)` / `db.close()` lifecycle methods. **The Mongo façade does not expose `db.transaction(...)`.** See *What Prisma Next doesn't do yet* for the workaround. **The ORM surface differs in one place: keys.** On Mongo, `db.orm` is keyed by the collection's storage name (from `@@map(...)`, or the lowercased model name if no `@@map` is set), not by the PSL model name — so `model User { … @@map("users") }` is reached at `db.orm.users`, not `db.orm.public.User`. The SQL builder lane (`db.sql.<ns>.<table>`) doesn't exist on Mongo at all (`db.sql` is `undefined`). See `references/queries.md` § *MongoDB ORM addressing* for the full rule and a rewrite recipe for SQL-target examples.

## Workflow — Running as a script (teardown)

The concept: short scripts that connect, query, then expect the process to exit will **hang on Postgres** because the façade-owned `pg.Pool` keeps Node's event loop alive. The data round-trip succeeds; the script never exits. Call `await db.close()` before the script returns (or use `await using` **at the top of a script module** so teardown runs when the module exits — see the block-scope warning below for why this matters).

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
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };

await using db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL! });

const user = await db.orm.public.User.first();
console.log(user);
// db.close() runs automatically when the script module exits.
```

### `await using` is **block-scoped** — do not put it inside a request handler

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
- **`close()` is terminal.** There is no reconnect on a closed `db` — construct a new client if you need another connection. After close, `db.runtime()`, `db.connect(...)`, `db.transaction(...)`, and `db.prepare(...)` reject with `Error('<target> client is closed')` (e.g. `'Postgres client is closed'`, `'SQLite client is closed'`, `'Mongo client is closed'`).
- **`close()` does not abort in-flight queries.** `await` outstanding work before calling `close()`. Async iterators from `db.runtime().execute(plan)` and `PreparedStatement` handles held after `close()` fail on their next call.
- **Ownership.** `close()` releases only what the façade constructed (`pg.Pool` from `{ url }`, `MongoClient` from `{ url }` / `{ uri, dbName }`, SQLite handle from `{ path }`). If you supplied your own `pg.Pool` / `pg.Client` (Postgres `pg:` option), `mongodb.MongoClient` (Mongo `mongoClient:` option), or a pre-built `binding`, `db.close()` does **not** touch those — you own their lifecycle.

**`db.end()` does not exist.** The universal `node-postgres` name is `pool.end()` on a `pg.Pool`; the Prisma Next runtime client is not a `pg.Pool`. The right call is `await db.close()`.

## Workflow — Observability middleware (custom)

The concept: Prisma Next ships no first-party telemetry middleware (see *What Prisma Next doesn't do yet*). A middleware is a plain `SqlMiddleware`-shaped object — a `name` plus one or more hooks (`beforeCompile`, `beforeQuery`, `interceptQuery`, `onRow`, `afterQuery`) — so a small custom one covers logging and event forwarding:

```typescript
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const queryLog: SqlMiddleware = {
  name: 'query-log',
  async afterQuery(plan, result) {
    // forward to your collector, log, etc.
    console.log(plan.sql, { rowCount: result.rowCount, latencyMs: result.latencyMs });
  },
};

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],
  middleware: [queryLog],
});
```

## Workflow — Lints and budgets middleware

The concept: lints catch authoring mistakes that survive type-check (e.g. `DELETE` without a `WHERE`, `SELECT` without a `LIMIT` on a large table); budgets enforce row-count and latency ceilings at runtime. Both surface findings through the structured-error envelope so an agent can branch on the code.

`lints` and `budgets` are importable from the façade's `/family-runtime` subpath. The example apps under `examples/prisma-8-demo/src/prisma/db.ts` show the canonical composition.

```typescript
import { budgets, lints } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
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

For the full option surface, read the source: `packages/2-sql/5-runtime/src/middleware/lints.ts` and `.../budgets.ts`. The `severities` keys (`selectStar`, `noLimit`, `deleteWithoutWhere`, `updateWithoutWhere`, `readOnlyMutation` for lints; `rowCount`, `latency` for budgets) are the source of truth; do not extrapolate to a key that ripgrep can't find.

## Workflow — Compose multiple middleware

```typescript
middleware: [
  queryLog,                          // outermost — sees all sub-failures as inner errors
  lints({ severities: { noLimit: 'error' } }),
  budgets({ maxLatencyMs: 5_000 }),  // innermost — runs closest to the driver
],
```

Order matters: outermost wraps. Logging/telemetry first means budget / lint failures are observed by it (the agent can correlate the lint code with the operation in the same trace).

## Workflow — Configure the connection

The concept: the runtime takes one of three binding shapes — `url`, `pg` (a pre-constructed `pg.Pool` or `pg.Client`), or `binding` (an explicit kind tag). They're mutually exclusive. The `pg` form is for projects that already manage their own pool (e.g. a Lambda layer); `url` is the default. Pool tuning is `poolOptions.connectionTimeoutMillis` / `poolOptions.idleTimeoutMillis` — *not* `driverOptions`.

```typescript
// Default — URL string, factory constructs the pool.
postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL'],
  poolOptions: {
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
  },
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
  url: process.env['DATABASE_URL'],
  middleware: isProd
    ? [queryLog]
    : [
        queryLog,
        lints({ severities: { noLimit: 'error', deleteWithoutWhere: 'error' } }),
      ],
});
```

`.env` for local; the deploy platform's secrets for prod. Never commit `.env`.

## Workflow — Transactions

The concept applies to **Postgres and SQLite**. `db.transaction(fn)` opens a transaction, gives the callback a `tx` context with the same `sql` / `orm` surfaces as `db`, and commits on successful return / rolls back on any thrown error. Inside the callback, use `tx.sql` and `tx.orm` instead of `db.sql` / `db.orm` so the writes ride the transaction. The Mongo façade does not expose `db.transaction(...)`.

```typescript
await db.transaction(async (tx) => {
  const user = await tx.orm.User.create({ email: 'alice@example.com' });
  await tx.orm.Post.create({ userId: user.id, title: 'hello' });
  // If either call throws, both inserts roll back.
});
```

The callback returns whatever you return from it — the transaction wrapper passes it through. The `tx` object exposes `execute(plan)` for SQL-builder plans inside the transaction.

## Workflow — Switch between Postgres, SQLite, and Mongo

The concept: the façade selection is baked into `db.ts` (`@prisma/orm-postgres` or `@prisma/orm-mongo`) and `prisma.config.ts` (which `defineConfig` you import from). To switch a project's target, re-run `prisma orm init` in the same directory and pick the other target — the init flow detects the existing scaffold and prompts to reinit (non-interactive runs grant the consent with `--confirm <directory name>`). PN re-scaffolds `prisma.config.ts` and `db.ts` for the new façade. The contract source needs to be re-authored for the new target's idioms (Mongo expresses nested documents; Postgres expresses relations).

After the switch (Mongo):

```typescript
// src/prisma/db.ts (Mongo)
import mongo from '@prisma/orm-mongo/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = mongo<Contract>({ contractJson, url: process.env['DATABASE_URL'] });
```

SQLite:

```typescript
// src/prisma/db.ts (SQLite)
import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = sqlite<Contract>({ contractJson, path: 'app.db' });
```

`path` is optional at construct time (you can call `db.connect({ path })` later); omit it and the façade still returns a client. The SQLite façade exposes the same `db.sql`, `db.orm`, `db.transaction(...)`, `db.close()`, and `[Symbol.asyncDispose]` surfaces as Postgres. The Mongo façade shares `db.orm`, `db.close()`, and `[Symbol.asyncDispose]` but has no `db.sql` and no `db.transaction(...)`.

The `db.sql` / `db.orm` surfaces stay the same in name; the operators each surface exposes are target-shaped (Mongo has no `JOIN`).

## Workflow — Build-system / dev-server integration

If you want contract artefacts to re-emit automatically while the dev server is running (instead of running `prisma contract emit` by hand each time the contract source changes), reach for the build-tool plugin from `references/build.md`:

- **Vite**: install `@prisma/orm-postgres/vite-plugin-contract-emit` and register `prismaVitePlugin('prisma.config.ts')` in `vite.config.ts`.
- **Next.js, Webpack, esbuild, Rollup, Turbopack**: no first-party plugin yet — the workaround is a `prebuild` script that runs `prisma contract emit`. See `references/build.md` for the walkthrough.

The runtime side (this skill) is the same regardless: `db.ts` reads `contract.json` + `contract.d.ts` from disk. The build-system plugin's job is to keep those files current during development.

## Common Pitfalls

1. **Hardcoding `DATABASE_URL` in `prisma.config.ts`.** Leaks credentials; bypasses per-environment overrides. Use `.env`.
2. **Omitting the `<Contract>` type parameter** in `postgres<Contract>(...)`. Without it, static surfaces collapse to a generic shape and you lose autocomplete for models. There is no second type parameter — the older two-param signature (`postgres<Contract, TypeMaps>`) is gone.
3. **Forgetting `with { type: 'json' }` on the contract import.** Required by Node's ESM JSON-import-attribute spec.
4. **Middleware order matters.** Outermost wraps. Put telemetry first if you want it to capture inner-middleware errors.
5. **Importing middleware from a non-existent façade subpath.** `@prisma/orm-postgres/middleware` does *not* exist. `lints` / `budgets` (and the `SqlMiddleware` type) come from `@prisma/orm-postgres/family-runtime`; there is no first-party telemetry middleware (see *What Prisma Next doesn't do yet*).
6. **Confabulating lint / budget option names.** Lints take `severities` (with the five keys above), not `requireWhere` / `maxRowsWithoutLimit`. Budgets use `maxLatencyMs` (not `maxDurationMs`) plus `maxRows` / `defaultTableRows` / `tableRows`. When in doubt, read the source.
7. **Switching targets without re-emitting.** The contract artefacts are target-shaped; emit after the target change.
8. **Script hangs after queries finish on Postgres.** The `pg.Pool` keeps Node's event loop alive. Solution: `await db.close()` before the script returns, or `await using db = postgres<Contract>(...)` at the top of a script module. Do not put `await using db = postgres(...)` inside a request handler — it's block-scoped and would close the pool after every request. The right server pattern is a module-level singleton in `db.ts` that lives for the process lifetime.

## What Prisma Next doesn't do yet

- **`@prisma/orm-postgres/middleware` subpath.** The postgres façade exposes the runtime factory (`./runtime`), config (`./config`), contract-builder (`./contract-builder`), control (`./control`), and serverless (`./serverless`) — but no `./middleware`. Import `lints`, `budgets`, and the `SqlMiddleware` type from `./family-runtime` instead. File additional gaps you hit via `references/feedback.md`.
- **First-party telemetry middleware.** No published telemetry middleware package ships with Prisma Next. Workaround: write a small custom `SqlMiddleware` (see *Workflow — Observability middleware*) that forwards events to your collector. If you want a first-party telemetry middleware, file a feature request via `references/feedback.md`.
- **Multi-database routing / read replicas.** Prisma Next doesn't ship a built-in primary/replica router or shard-aware client. Workaround: configure separate `db.ts` instances per data store and call the right one in your application code. If you need first-class multi-database routing, file a feature request via the `references/feedback.md` skill.
- **Connection pooling as a first-class config field.** `poolOptions.connectionTimeoutMillis` and `poolOptions.idleTimeoutMillis` are wired through, but the rest of `pg.Pool`'s tuning surface (max connections, `allowExitOnIdle`, ssl options, …) is not exposed by name. Workaround: construct the `pg.Pool` yourself and pass it via `pg:`. If you need more pool fields surfaced on the façade, file a feature request via the `references/feedback.md` skill.
- **Query logger middleware as a built-in.** Prisma Next doesn't ship a "log every query" middleware. Workaround: write a small custom `SqlMiddleware` that logs from its hooks (see *Workflow — Observability middleware*). If you need a built-in query log, file a feature request via the `references/feedback.md` skill.

## Reference Files

This skill is intentionally body-only; `prisma orm init --help`, the `defineConfig` factory in `packages/3-extensions/postgres/src/config/define-config.ts`, the `postgres()` factory in `packages/3-extensions/postgres/src/runtime/postgres.ts`, and the middleware sources in `packages/2-sql/5-runtime/src/middleware/{lints,budgets}.ts` are the authoritative surfaces for option-level detail. When in doubt, read the source.

## Checklist

- [ ] `db.ts` imports the runtime factory from `@prisma/orm-<target>/runtime` (`postgres`, `sqlite`, or `mongo`) and the `Contract` type from `./contract.d`.
- [ ] `with { type: 'json' }` on the contract JSON import.
- [ ] `<Contract>` is the single type parameter on `postgres<Contract>(...)` (no second parameter).
- [ ] `DATABASE_URL` lives in `.env`, not in `prisma.config.ts`.
- [ ] Middleware ordered intentionally (telemetry outermost typically).
- [ ] `lints` / `budgets` use the verified option keys (`severities`, `maxLatencyMs`, `maxRows`, `tableRows`).
- [ ] Per-env divergence (if any) gated by `NODE_ENV` or similar.
- [ ] Did NOT hardcode credentials in any committed file.
- [ ] Did NOT confabulate a `@prisma/orm-postgres/middleware` subpath, a first-party telemetry middleware package, or a second type parameter on `postgres<...>`.
- [ ] Did NOT claim `db.transaction(...)` exists on the Mongo façade — only Postgres and SQLite expose it.
- [ ] Did NOT confabulate read-replica / multi-DB / extra pool config — pointed at *What Prisma Next doesn't do yet* and routed to `references/feedback.md`.
- [ ] For build-system / dev-server prompts (Vite plugin, Next.js plugin, …) routed to `references/build.md`.
