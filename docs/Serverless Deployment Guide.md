# Serverless Deployment Guide

How to deploy Prisma Next to per-request runtimes — Cloudflare Workers + Hyperdrive as the primary worked path, with pointers for AWS Lambda (Node), Vercel Edge / Vercel Serverless, Deno Deploy, and Bun edge.

This guide covers the per-request facade `@internal/postgres/serverless`. If you are deploying to a long-lived Node process (a server, a container, a non-edge Vercel function with bundling that keeps the process warm), use the existing `@internal/postgres/runtime` facade — the long-lived shape is unchanged and not in scope here.

## Two facades, one driver

`@internal/postgres` exports two facades that compose the same execution stack and differ only in lifecycle ergonomics:

| Surface              | `postgres()` — `/runtime`                        | `postgresServerless()` — `/serverless`                              |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Lifecycle            | Long-lived process                               | Per-request invocation                                              |
| `sql`                | yes                                              | yes                                                                 |
| `context`            | yes                                              | yes                                                                 |
| `stack`              | yes                                              | yes                                                                 |
| `contract`           | yes                                              | yes                                                                 |
| `orm`                | closure-cached on the client                     | constructed per request via `createOrmClient(runtime)`              |
| `runtime()`          | closure-cached `Runtime`                         | (no member) acquired per request via `db.connect({ url })`          |
| `transaction(...)`   | closure-cached entrypoint                        | (no member) used per request via `withTransaction(runtime, ...)`    |
| Cursor default       | disabled                                         | enabled                                                             |
| Disposal             | (none — process owns the lifetime)               | `Symbol.asyncDispose` on the runtime; `await using` disposes        |

The static authoring surface (`sql`, `context`, `stack`, `contract`) is identical on both sides — it is a pure function of the contract and is closure-cached safely per isolate. The runtime-bound surface differs because long-lived and per-request lifecycles have different invariants. See [ADR 207 — Per-environment facade asymmetry](./architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md) for the architectural rationale and the rejected alternatives.

The practical version: closure-caching a `Runtime` (and the `pg.Client` wired into it) across `fetch` invocations is two flavors of unsafe in per-request runtimes — stale-connection failures after isolate idle, and concurrent-`fetch` races on a single shared `pg.Client`. The per-request facade makes the lifetime explicit at every call site:

```ts
export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
    // ... use runtime, ORM, transactions ...
    // runtime.close() runs automatically when the fetch body returns
    // (including on the throw-and-rethrow path).
  },
};
```

## Cloudflare Workers + Hyperdrive (worked example)

Cloudflare Workers + [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) is the primary tested path. Hyperdrive is Cloudflare's managed Postgres connection pooler at the edge: the Worker connects to it with the standard Postgres wire protocol via the `pg` library, Hyperdrive terminates that connection at the edge and pools connections to your origin Postgres. The Worker reads the connection string off `env.HYPERDRIVE.connectionString`.

A complete worked example lives at `examples/prisma-8-cloudflare-worker/`. This section documents the pattern; the example documents the example.

### Architecture

```
┌─────────────────┐      ┌────────────────┐      ┌─────────────────┐
│ Worker isolate  │ ───→ │   Hyperdrive   │ ───→ │ Origin Postgres │
│ (per fetch)     │  pg  │ (edge pooler)  │  pg  │ (PPg, RDS, ...) │
│   db.connect()  │      │   pgbouncer-   │      │                 │
│   one pg.Client │      │   equivalent   │      │                 │
└─────────────────┘      └────────────────┘      └─────────────────┘
        ▲                                                 ▲
        │                                                 │
        │ runtime queries                       Node-side migrations
        │ (per fetch)                           run from Node directly
        │                                       against the origin URL,
        │                                       NOT through Hyperdrive
        │                                       (see Migrations below).
```

The runtime path goes Worker → Hyperdrive → origin. The control-plane (migrations) path goes Node → origin directly.

### Setup

#### 1. Provision the origin

Any Postgres-compatible origin works (Prisma Postgres / PPg, AWS RDS, Neon, Supabase, etc.). Hyperdrive holds the origin credentials; the Worker never sees them.

#### 2. Provision Hyperdrive

```bash
pnpm exec wrangler hyperdrive create my-hyperdrive \
  --connection-string="postgres://USER:PASS@HOST:PORT/DBNAME"
```

Wrangler prints a binding ID. Wire it into `wrangler.jsonc`:

```jsonc
{
  "name": "my-worker",
  "main": "src/worker.ts",
  "compatibility_date": "2025-07-18",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<the-id-printed-by-wrangler-hyperdrive-create>"
    }
  ]
}
```

`nodejs_compat` is required: the Postgres driver (`pg`) uses several Node built-ins that workerd polyfills under that flag. The M1 audit confirmed `pg` + `pg-cursor` work under `nodejs_compat` end-to-end (open / read / cursor early-break / close) when validated against a localhost Postgres origin and against `vitest-pool-workers`'s miniflare emulator — i.e., paths that do not put real Hyperdrive in front of the origin.

> **Production caveat — read this before deploying.** Against real Hyperdrive, the default cursor path hangs (`pg-cursor`'s extended-query named portal trips a Hyperdrive parser bug — full diagnostic in the [Cursor mode hangs on Cloudflare Hyperdrive](#known-limitations) entry below). Until the upstream fix lands, pass `cursor: { disabled: true }` to `postgresServerless({...})`. The miniflare emulator and localhost Postgres paths above don't reproduce the hang, so the example's local tests pass with cursor enabled — the bug only surfaces against a real deployed Hyperdrive config.

#### 3. Local dev

For `wrangler dev` and `vitest-pool-workers`, the Hyperdrive binding needs a local connection string. Wrangler reads it from a `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING_NAME>` environment variable in `.env` ([Cloudflare docs](https://developers.cloudflare.com/hyperdrive/configuration/local-development)). For a binding named `HYPERDRIVE`:

```bash
# .env (gitignored)
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://user:pass@127.0.0.1:5432/mydb"
```

This goes in `.env`, not `.dev.vars`. `.dev.vars` is for runtime worker secrets; the `WRANGLER_*_LOCAL_CONNECTION_STRING_*` variable is consumed by Wrangler itself when it builds the Hyperdrive binding for local dev. The `WRANGLER_*` prefix is being deprecated in favour of `CLOUDFLARE_*` in newer Wrangler — both work as of `wrangler@4.87`.

### Worker code shape

Module-scope construction; per-request runtime acquisition; three query surfaces; cursor streaming. The full file is `examples/prisma-8-cloudflare-worker/src/worker.ts`.

#### Module scope

```ts
// src/prisma/db.ts
import postgresServerless from '@internal/postgres/serverless';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// Constructed once per isolate. Only the static authoring surface
// (sql / context / stack / contract) is closure-cached — those are
// pure functions of the contract and are safe to cache. The
// runtime-bound surface is acquired per fetch via db.connect(...).
export const db = postgresServerless<Contract>({
  contractJson,
  // middleware: [...],   // optional — telemetry, lints, budgets, ...
  // extensions: [...],   // optional
  // cursor: { disabled: true },  // REQUIRED if your origin is behind Cloudflare
                                  // Hyperdrive — see Production caveat above.
                                  // Default is enabled; safe to leave as-is on
                                  // any non-Hyperdrive origin.
});
```

#### Per request

```ts
// src/worker.ts
import { withTransaction } from '@internal/sql-runtime';
import { createOrmClient } from './orm-client/client';
import { db } from './prisma/db';

interface Env {
  HYPERDRIVE: { connectionString: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Fresh runtime per fetch. AsyncDisposable: when the fetch body
    // returns (or throws), runtime.close() runs and ends the
    // underlying pg.Client. No closure cache, no shared state across
    // concurrent fetches in this isolate.
    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });

    const url = new URL(request.url);

    // SQL DSL plan — runtime.execute returns AsyncIterable<row>.
    if (url.pathname === '/sql/users') {
      const rows = await runtime.execute(
        db.sql.user.select('id', 'email').limit(10).build(),
      );
      return Response.json(rows);
    }

    // ORM — constructed against the per-request runtime.
    if (url.pathname === '/orm/users') {
      const orm = createOrmClient(runtime);
      const rows = await orm.User.newestFirst().take(10).all();
      return Response.json(rows);
    }

    // Transactions — withTransaction takes the per-request runtime.
    // BEGIN/COMMIT/ROLLBACK happen on the same underlying pg.Client.
    if (url.pathname === '/tx/example') {
      const result = await withTransaction(runtime, async (tx) => {
        await tx.execute(db.sql.user.update({ /* ... */ }).where(/* ... */).build());
        await tx.execute(db.sql.post.insert({ /* ... */ }).build());
        return { ok: true };
      });
      return Response.json(result);
    }

    return new Response('not found', { status: 404 });
  },
};
```

#### Cursor streaming

`postgresServerless` enables `pg-cursor` by default. The `for-await ... break` shape exits early without materializing the rest of the result; the cursor closes cleanly on `break`:

```ts
if (url.pathname === '/cursor/large') {
  const consumed: { id: string; title: string }[] = [];
  // Bounded SELECT (see budgets middleware). Cursor-on means the driver
  // opens a server-side cursor and streams ~100-row batches — early
  // break only fetches one batch and closes the cursor. Cursor-off
  // would buffer all 10_000 rows before yielding the first one.
  const iter = runtime.execute(
    db.sql.post.select('id', 'title').orderBy((f) => f.createdAt, { direction: 'asc' }).limit(10_000).build(),
  );
  for await (const row of iter) {
    consumed.push(row);
    if (consumed.length >= 50) break;
  }
  return Response.json({ consumed: consumed.length });
}
```

The cursor default is the inverse of the long-lived `postgres()` facade's default (off) because the dominant per-request shape is "stream and return early"; isolate memory pressure makes buffering a 10k-row result before yielding the first row a foot-gun. Both facades expose a `cursor` option for opt-out / opt-in.

### Wiring the ORM client

`createOrmClient(runtime)` is the existing pattern from `examples/prisma-8-demo/src/orm-client/`; the per-request facade reuses it unchanged:

```ts
// src/orm-client/client.ts
import type { Runtime } from '@internal/sql-runtime';
import { orm } from '@internal/sql-orm-client';
import { db } from '../prisma/db';
import { UserCollection, PostCollection } from './collections';

export function createOrmClient(runtime: Runtime) {
  return orm({
    runtime,
    context: db.context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
}
```

Custom collections, repositories, and ORM extensions work the same way they do on Node — the only difference is that you call the factory inside `fetch` against the per-request `runtime` instead of reading a closure-cached `db.orm`.

## Other per-request runtimes

The `postgresServerless` facade is generic across per-request runtimes. The only thing that differs per runtime is how you source the connection string — the facade itself is environment-shaped, not Cloudflare-product-shaped.

This guide does not ship worked examples or CI for non-Cloudflare runtimes. The pattern is identical; only the connection-string source changes.

| Runtime                    | Connection-string source                                              |
| -------------------------- | --------------------------------------------------------------------- |
| AWS Lambda (Node)          | `process.env.DATABASE_URL` (set via Lambda env vars / secrets layer)  |
| Vercel Serverless (Node)   | `process.env.DATABASE_URL`                                            |
| Vercel Edge                | `process.env.DATABASE_URL` (per Vercel edge runtime conventions)      |
| Deno Deploy                | `Deno.env.get('DATABASE_URL')`                                        |
| Bun edge                   | `process.env.DATABASE_URL` (Bun's Node-compat env shim)               |

The Worker code shape is the same on all of them: module-scope `db = postgresServerless({...})`, per-request `await using runtime = await db.connect({ url: <sourced URL> })`. Hyperdrive is Cloudflare-specific; on other runtimes the URL points directly at the origin or at whatever pooler your platform exposes (RDS Proxy on Lambda, Vercel Postgres pooler, etc.).

## Migrations

Migrations stay on Node, against the **origin** database connection string (not Hyperdrive).

There is no per-request migration story and there is no Hyperdrive control-plane driver. The reasons:

- Migration commands (`prisma db migrate`, `prisma db init`) are control-plane operations: they speak to the `migration` plane through the control-plane Postgres driver, run in long-lived Node processes (CI runners, dev workstations, deploy hooks), and are inherently long-lived shapes — DDL does not benefit from per-request lifecycle.
- Hyperdrive caches query results at the edge. That is desirable for many runtime read patterns and undesirable for DDL: a stale read of the migration ledger or marker leads to duplicate-apply or skipped-apply confusion. The Cloudflare-recommended pattern is to bypass Hyperdrive for control-plane operations, and we follow that.

The existing migration commands accept a connection string (typically via `DATABASE_URL`) and use the `@internal/driver-postgres/control` driver. Run them from CI / your deploy pipeline / a one-shot Node task pointed at the origin URL — see the existing migration docs and the [Getting Started guide](./onboarding/Getting-Started.md) for the command surface. Nothing about deploying to a per-request runtime changes that.

## Known limitations

- **Transaction affinity within a single underlying connection.** A `withTransaction(runtime, async (tx) => ...)` body runs all of its statements on the per-request runtime's single underlying `pg.Client`. Crossing runtime boundaries inside a transaction body is undefined; constructing a second `await using runtime2 = await db.connect(...)` inside a transaction body and routing some statements through it will not be transactional with the outer body. This is the same invariant Hyperdrive itself documents — transactions need to land on one client connection — and the per-request facade enforces it by structure (one `runtime` per `connect()`, one client per `runtime`).

- **Isolate memory limits.** Workers isolates have bounded memory (128 MiB by default; higher on Workers Unbound). ORM `findMany`-style operations materialize the result set into a JS array before returning; `take(...)` is your hard memory cap on those. If you need to stream, use the SQL DSL with `runtime.execute(...)` — the iterator is cursor-backed by default and yields rows as they arrive, with `for-await ... break` cancelling cleanly without buffering the rest of the result set.

- **Cursor enabled by default.** The default for `postgresServerless` is `cursor: { /* enabled */ }`. Long-lived `postgres()` defaults to `cursor: { disabled: true }`. The asymmetry is intentional (see [ADR 207](./architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md) and the cursor section above). To opt out on the per-request side, pass `cursor: { disabled: true }` to `postgresServerless({...})`.

- **Cursor mode hangs on Cloudflare Hyperdrive — pass `cursor: { disabled: true }` if your origin sits behind Hyperdrive.** Empirically verified during the May 2026 production smoke. The default cursor path uses `pg-cursor`'s extended-query named-portal protocol; after rows are returned and the client sends `Close portal + Sync`, Hyperdrive emits `Protocol Error: Unexpected protocol code: C` (SQLSTATE `58000`) and never follows up with the expected `ReadyForQuery`. The connection wedges; Cloudflare's runtime kills the request at 30 s with error 1101. This affects every read path (SQL DSL, ORM `.all()` / `.first()`, `for await`) — there is no per-call short-circuit, the cursor decision is made at the driver layer for every read. Wrapping the read in `withTransaction(...)` does not help: the failure is in Hyperdrive's protocol parser state, not in connection pinning. The driver's catch-block fallback to simple-query mode does **not** save you either — it only fires on certain thrown errors, and a hang doesn't throw. Workaround: pass `cursor: { disabled: true }` to `postgresServerless({...})` to force the simple-protocol path. Tracking upstream as a Cloudflare Hyperdrive bug.

- **The `@internal/postgres` package statically imports `pg-pool` and `pg-cloudflare`.** The serverless facade does not construct a `pg.Pool` and does not exercise the pool path, but the `pg` library imports both at module load. The bundle includes them. This is not a correctness concern — `pg-cloudflare` activates only when `navigator.userAgent === 'Cloudflare-Workers'` is true at runtime — but it adds bundle weight. The example's full bundle measures around 254 KiB gzipped including these.

- **Migrations run from Node.** As above — no per-request migration story, no Hyperdrive control-plane driver. If your deploy pipeline expects to apply migrations from the same surface that runs the Worker, you need a separate Node task (CI step, deploy hook, one-shot script).

## Validating end-to-end

The `examples/prisma-8-cloudflare-worker/` example provides a `vitest-pool-workers` integration test that boots the Worker under `workerd`, points the Hyperdrive binding at a local Docker Postgres, and exercises SQL DSL, ORM, transactions, and cursor streaming. That suite is the canonical "does my pattern work end-to-end" reference and is the one you should mirror when bootstrapping your own deployment.

The example is intentionally minimal — minimum schema, minimum routes — so you can compare your setup against it side-by-side. See its README for the local-dev workflow (`pnpm db:up` / `pnpm db:init` / `pnpm seed` / `pnpm dev`) and the bundle-size / cold-start measurements.

## See also

- [ADR 207 — Per-environment facade asymmetry](./architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md) — the architectural rationale for the two-facade design.
- [ADR 159 — Runtime Driver Lifecycle](./architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md) — how the underlying driver lifecycle works (both facades inherit it unchanged).
- [Architecture Overview](./Architecture%20Overview.md) — Prisma Next's broader plane / target / adapter / driver model.
- [Cloudflare Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/) — Hyperdrive setup, configuration, and observability.
- The example: `examples/prisma-8-cloudflare-worker/` (in this repo).
