# prisma-8-cloudflare-worker

End-to-end example for the `@prisma/orm-postgres/serverless` facade, running on a Cloudflare Worker against a Hyperdrive-fronted Postgres origin.

This example mirrors `examples/prisma-8-demo` (the Node demo), minus pgvector — the Worker example exists to exercise the per-request `postgresServerless` lifecycle, not vector search.

## What this example demonstrates

- **Module-scope `db`** built once per isolate via `postgresServerless<Contract>({ contractJson, middleware })`.
- **Per-request `runtime`** via `await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString })`. The `[Symbol.asyncDispose]` ensures the underlying `pg.Client` is `end()`-ed when the `fetch` handler returns.
- **All three query surfaces** through `Runtime`:
  - SQL DSL: `runtime.query(db.sql.public.user.select(...).build())`
  - ORM client: `createOrmClient(runtime).User.newestFirst().limit(10).all()`
  - Transactions: `withTransaction(runtime, async (tx) => …)`
- **Cursor early-break** over a streamed result set (`for await … break`), exercising the cursor path that `postgresServerless` enables by default.

Routes implemented in [`src/worker.ts`](src/worker.ts):

| Route               | Surface           | Notes                                                    |
| ------------------- | ----------------- | -------------------------------------------------------- |
| `GET /health`       | —                 | DB-free liveness check                                   |
| `GET /sql/users`    | SQL DSL           | `db.sql.public.user.select(...).limit(?)`                       |
| `GET /orm/users`    | ORM client        | `User.newestFirst().limit(?)`                             |
| `GET /orm/posts`    | ORM client        | `Post.forUser(?).orderBy(...).limit(?)`                   |
| `GET /tx/commit`    | `withTransaction` | INSERT post + UPDATE user atomically                     |
| `GET /tx/rollback`  | `withTransaction` | Throws inside the body; verifies ROLLBACK propagates     |
| `GET /cursor/large` | Cursor stream     | `for await … break` after N rows; cursor cancels cleanly |

## Layout

```
examples/prisma-8-cloudflare-worker/
├── src/prisma/contract.prisma                # Demo schema minus pgvector
├── src/
│   ├── worker.ts                       # `fetch` handler — all routes
│   ├── prisma/db.ts                    # Module-scope postgresServerless client
│   ├── prisma/contract.{json,d.ts}     # Emitted by `pnpm emit`
│   └── orm-client/                     # ORM extensions (collections + factory)
├── scripts/
│   ├── setup-schema.ts                 # `prisma db init`
│   └── seed.ts                         # Insert sample users + posts
├── test/
│   ├── global-setup.ts                 # Connects to Docker Postgres, applies schema, seeds
│   ├── worker.integration.test.ts      # vitest-pool-workers integration suite
│   └── cloudflare-test.d.ts            # Pulls in `cloudflare:test` ambient types
├── docker-compose.yml                  # Local Postgres origin (port 5433)
├── wrangler.jsonc                      # Hyperdrive binding declaration
├── prisma.config.ts               # Contract emit config
├── vitest.config.ts                    # cloudflareTest plugin + globalSetup
└── .env.example                        # Copy → .env (Hyperdrive local URL)
```

## Setup (local development)

### Prerequisites

- Node satisfying the root `package.json` `engines.node` (`>=24`).
- `pnpm`. Install workspace deps from the repo root with `pnpm install`.
- `docker` + `docker compose` (Docker Desktop, OrbStack, Colima, or Rancher Desktop). The local Postgres origin runs in a container — see [why not `prisma dev`](#why-not-prisma-dev) below.

### One-time bootstrap

```bash
cd examples/prisma-8-cloudflare-worker
pnpm emit                        # generate src/prisma/contract.{json,d.ts}
cp .env.example .env             # gitignored
```

`.env` ships preset to the docker-compose URL (`postgres://postgres:postgres@127.0.0.1:5433/prisma_next_cloudflare_worker`). Wrangler reads `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to populate the `HYPERDRIVE` binding's local connection string ([Cloudflare docs](https://developers.cloudflare.com/hyperdrive/configuration/local-development)). Note: this goes in **`.env`**, not `.dev.vars` — `.dev.vars` is for runtime worker secrets, not Wrangler configuration. The `WRANGLER_*` prefix is being deprecated in favour of `CLOUDFLARE_*` in newer Wrangler; either works as of `wrangler@4.87`.

### Per-session: bring up Postgres, init schema, seed

```bash
pnpm db:up                       # docker compose up -d --wait (postgres:16 on :5433)
pnpm db:init                     # prisma db init → CREATE TABLE …
pnpm seed                        # Insert Alice + Bob + 50 posts
```

Tear down with `pnpm db:down` (drops the container + volume — data is `tmpfs`-backed for fast restarts), or `pnpm db:reset` to do everything in one command.

### Run the Worker locally

```bash
pnpm dev                         # wrangler dev → http://localhost:8787
curl http://localhost:8787/health
curl http://localhost:8787/orm/users?limit=5
```

## Deploy

`wrangler.jsonc` carries a placeholder Hyperdrive `id` (`00000000…`). To deploy to a real Cloudflare account, provision a Hyperdrive config first:

```bash
pnpm exec wrangler hyperdrive create my-hyperdrive --connection-string="postgres://…"
# Replace the "id" in wrangler.jsonc with the printed binding id.
pnpm run deploy
```

> Use `pnpm run deploy` (not `pnpm deploy`). The latter collides with pnpm's built-in `deploy` command and fails with `ERR_PNPM_INVALID_DEPLOY_TARGET`.

> If your origin sits behind Cloudflare Hyperdrive, also pass `cursor: { disabled: true }` to `postgresServerless({...})` in `src/prisma/db.ts`. Hyperdrive currently rejects the `Close portal` message that `pg-cursor` (the default streaming path) sends after an extended-query Execute, leaving the connection wedged. See the deployment guide's "Known limitations" for details.

## Bundle size

`pnpm deploy:dry-run` (`wrangler deploy --dry-run --outdir dist`) reports:

```
Total Upload: 1289.96 KiB / gzip: 254.14 KiB
```

(254 KiB compressed, well under the 1 MB AC-19 budget.)

The bundle includes `pg`, `pg-protocol`, `pg-types`, `pg-cursor`, `pg-pool` (statically imported by the Postgres driver the facade wires in even though `postgresServerless` does not construct a `Pool` at runtime), `pg-cloudflare` (auto-pulled by `pg` when `navigator.userAgent === 'Cloudflare-Workers'`), and `@cloudflare/unenv-preset` polyfills.

## Cold-start benchmark (AC-20 / TC-23)

Best-effort `wrangler dev` benchmark against the local Docker Postgres origin (`GET /orm/users?limit=10`):

| Run                    | Latency  |
| ---------------------- | -------- |
| Cold start (run 0)     | ~35 ms   |
| Warm p50 (runs 1–5)    | ~13 ms   |

Both well inside the 200 ms ceiling in AC-20. Production cold-start over a real Hyperdrive will be slower (TLS handshake, region-vs-origin RTT) — re-measure during M4 deployment validation.

## Integration tests (`vitest-pool-workers`)

The suite under `test/` boots the Worker under `workerd` via `vitest-pool-workers`, points the Hyperdrive binding at the local Docker Postgres, and exercises the SQL DSL, ORM, transactions, and cursor early-break paths.

```bash
pnpm db:up                       # ensure container is running
pnpm test                        # vitest run --config vitest.config.ts
```

The test's `globalSetup` (`test/global-setup.ts`) reads `.env`, asserts the container is reachable, applies the schema (idempotent — uses the same `prisma db init` as the dev workflow), truncates and reseeds. There is no per-test isolation: the suite is read-mostly, the `/tx/commit` test mutates `Bob`'s display name and the next test's reseed restores it on the next `pnpm test`.

The canonical workspace invocation is `pnpm test:examples --filter prisma-8-cloudflare-worker` from the repo root (depends on the container being up — that's a local-dev precondition, not a CI one).

### `pg` resolution under Vite 8

`vitest.config.ts` includes a `test.deps.optimizer.ssr.{include, rolldownOptions.external}` workaround for [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984), which mis-resolves `pg`'s dual ESM/CJS exports under Vite 8 when loaded by `vitest-pool-workers`. Pre-bundling `pg`/`pg-protocol`/`pg-cursor`/`pg-cloudflare` and externalising Node built-ins keeps `workerd`'s loader on the right entries.

### Why not `prisma dev`?

The first attempt at the local origin used `@prisma/dev` (PGlite-backed Postgres reachable over TCP) — same pattern as `examples/prisma-8-demo` for everything else. It hung in both `wrangler dev` and `vitest-pool-workers`: every DB-touching route would call `pg.Client.connect()` through miniflare's Hyperdrive emulator, the `pg-cloudflare` socket reported "Connection terminated unexpectedly", and the runtime never recovered. The hang reproduces in plain `wrangler dev`, so it's not a test-infra problem — it appears to be specific to PGlite's TCP shim interacting with `pg-cloudflare`'s socket layer in `workerd`. The third sub-issue in [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984) ("Cannot perform I/O on behalf of a different Durable Object") may be the same root cause; upstream PR #13062 covers the bundling regressions but not this one.

The M1 audit's "this works in `wrangler dev`" claim was empirically validated against a real Postgres on `localhost`, not against `prisma dev` — so the audit's conclusion still holds for real-Postgres origins. M3 uses Docker Postgres for that reason. The PPg-on-Workers story will pick back up in M4 against a real deployed Hyperdrive + PPg.

## Troubleshooting

- **`pnpm db:up` fails with `Cannot connect to the Docker daemon`.** Start your container runtime (Docker Desktop, OrbStack, …) and retry.
- **`pnpm db:init` fails with a connection error.** Confirm `pnpm db:up` succeeded and the container is healthy: `docker compose ps`. Port 5433 (not 5432) — port collision with `examples/prisma-8-demo`'s Postgres.app would surface here.
- **`wrangler dev` boots but `/orm/users` returns `500 / connection error`.** The container probably stopped (or you forgot `pnpm db:up`). `pnpm db:reset` brings everything back from a clean slate.
- **Bundle includes `pg-cloudflare` even though I'm running on Node.** Expected — `pg` static-imports `pg-cloudflare` via `lib/stream.js`, and runtime detection (`navigator.userAgent === 'Cloudflare-Workers'`) picks the right socket implementation.

## Known limitations

- **Transaction affinity** — every `withTransaction` body must run on the same `runtime` instance (the per-request one). Crossing `runtime` boundaries inside a transaction body is undefined.
- **Isolate memory** — large result sets bound through cursor by default (`postgresServerless` enables cursor unconditionally). For ORM `findMany`-style operations the result set is materialised; size your `limit(...)` accordingly.
- **`pg.Pool` not used** — the serverless facade routes through `PostgresDirectDriverImpl` (`pgClient` binding kind). No connection pooling within the isolate; that's Hyperdrive's job in production.
- **Production `id`** — the committed `wrangler.jsonc` has a zero-stuffed Hyperdrive `id`. Deploy will fail until a real id is wired in (M4).
- **Class-table-inheritance ORM queries** — the schema declares `Bug` and `Feature` as `@@base(Task)` discriminator variants for parity with `examples/prisma-8-demo`. The earlier `column "bug.id" does not exist` failure is now resolved: the emitted contract materialises the base-PK link column (`bug.id` / `feature.id`) on each variant table, so the variant join the ORM emits resolves. These queries are not yet exercised by this worker's routes or integration test; `examples/prisma-8-demo` covers the polymorphic-include path end-to-end.
