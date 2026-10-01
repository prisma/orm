# prisma-8-cloudflare-worker

End-to-end example for the serverless client from `@prisma/orm-postgres/serverless`, running on a Cloudflare Worker against a Hyperdrive-fronted Postgres origin.

This example mirrors `examples/prisma-8-demo` (the Node demo), minus pgvector — the Worker example exists to exercise the per-request `postgresServerless` lifecycle, not vector search.

## What this example demonstrates

- **Serverless client `postgres`** at module scope, built once per isolate via `postgresServerless<Contract>({ contractJson, middleware })`. It holds no database connection.
- **Connection `db`**, opened in each request via `await using db = await postgres.connect({ url: env.HYPERDRIVE.connectionString })`. `db` has the members of a `postgres()` client except `connect`. The `[Symbol.asyncDispose]` ensures the underlying `pg.Client` is `end()`-ed when the `fetch` handler returns.
- **All query surfaces** through the connection `db`:
  - SQL DSL: `db.runtime().query(db.sql.public.user.select(...).build())`
  - Default ORM client: `db.orm.public.Post.where({ userId }).limit(10).all()`
  - Custom ORM client with collection classes: `createOrmClient(db).User.newestFirst().limit(10).all()`, built from `db.runtime()` and `db.context`
  - Transactions: `db.transaction(async (tx) => …)`
- **Cursor early-break** over a streamed result set (`for await … break`). Cursors are off by default; only the `/cursor/large` route opens its connection from a separate serverless client, `streamingPostgres`, with `cursor: { batchSize: 100 }`. The integration test runs the same read through a connection from `postgres` and checks that the server sends the whole result before the first row.

Routes implemented in [`src/worker.ts`](src/worker.ts):

| Route               | Surface           | Notes                                                    |
| ------------------- | ----------------- | -------------------------------------------------------- |
| `GET /health`       | —                 | DB-free liveness check                                   |
| `GET /sql/users`    | SQL DSL           | `db.sql.public.user.select(...).limit(?)`                       |
| `GET /orm/users`    | Custom ORM client | `User.newestFirst().limit(?)`                             |
| `GET /orm/posts`    | `db.orm`          | `Post.where({ userId }).orderBy(...).limit(?)`            |
| `GET /tx/commit`    | `db.transaction`  | INSERT post + UPDATE user atomically                     |
| `GET /tx/rollback`  | `db.transaction`  | Throws inside the body; verifies ROLLBACK propagates     |
| `GET /cursor/large` | Cursor stream     | `for await … break` after N rows; cursor cancels cleanly |

An unknown route and a missing `userId` are answered before `postgres.connect(...)`, so those requests open no database connection.

## Layout

```
examples/prisma-8-cloudflare-worker/
├── src/prisma/contract.prisma                # Demo schema minus pgvector
├── src/
│   ├── worker.ts                       # `fetch` handler — all routes
│   ├── prisma/db.ts                    # Serverless clients (postgresServerless)
│   ├── prisma/contract.{json,d.ts}     # Emitted by `pnpm emit`
│   └── orm-client/                     # ORM extensions (collections + factory)
├── scripts/
│   ├── setup-schema.ts                 # `prisma db init`, then the pg_stat_statements extension
│   ├── seed.ts                         # Empty the tables, then insert sample users + posts
│   └── seed-posts.ts                   # The generated posts for /cursor/large (shared with the tests)
├── test/
│   ├── global-setup.ts                 # Connects to Docker Postgres, applies schema, seeds
│   ├── worker.integration.test.ts      # vitest-pool-workers integration suite
│   ├── rows-sent.ts                    # Counts rows the server sent, through pg_stat_statements
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

`.env` ships preset to the docker-compose URL (`postgres://postgres:postgres@127.0.0.1:5433/prisma_8_cloudflare_worker`). Wrangler reads `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to populate the `HYPERDRIVE` binding's local connection string ([Cloudflare docs](https://developers.cloudflare.com/hyperdrive/configuration/local-development)). Note: this goes in **`.env`**, not `.dev.vars` — `.dev.vars` is for runtime worker secrets, not Wrangler configuration. The `WRANGLER_*` prefix is being deprecated in favour of `CLOUDFLARE_*` in newer Wrangler; either works as of `wrangler@4.87`.

### Per-session: bring up Postgres, init schema, seed

```bash
pnpm db:up                       # docker compose up -d --wait (postgres:16 on :5433)
pnpm db:init                     # prisma db init → CREATE TABLE …, then CREATE EXTENSION pg_stat_statements
pnpm seed                        # Empty the tables, then insert Alice + Bob, 8 posts of theirs, and 10 000 generated posts for /cursor/large
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

> Cursors are off by default. The example's `/cursor/large` route opens its connection from a separate serverless client, `streamingPostgres` in `src/prisma/db.ts`, with `cursor: { batchSize: 100 }` to show an early `break` over a streamed result. That route hangs behind real Cloudflare Hyperdrive, and the other routes do not; see the deployment guide's "Known limitations" for details.

## Bundle size

`pnpm deploy:dry-run` (`wrangler deploy --dry-run --outdir dist`) reports:

```
Total Upload: 1981.92 KiB / gzip: 399.05 KiB
```

(399 KiB compressed, well under the 1 MB budget.)

The bundle includes `pg`, `pg-protocol`, `pg-types`, `pg-cursor`, `pg-pool` (statically imported by the Postgres driver the serverless client wires in even though `postgresServerless` does not construct a `Pool` at runtime), `pg-cloudflare` (auto-pulled by `pg` when `navigator.userAgent === 'Cloudflare-Workers'`), and `@cloudflare/unenv-preset` polyfills.

## Cold-start benchmark

Best-effort `wrangler dev` benchmark against the local Docker Postgres origin (`GET /orm/users?limit=10`):

| Run                    | Latency  |
| ---------------------- | -------- |
| Cold start (run 0)     | ~35 ms   |
| Warm p50 (runs 1–5)    | ~13 ms   |

Both well inside the 200 ms ceiling. Production cold start over a real Hyperdrive will be slower (TLS handshake, region-to-origin round trip); measure again on a deployed Worker.

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

The earlier check that `pg` works in `wrangler dev` ran against a real Postgres on `localhost`, not against `prisma dev`, so it holds for real-Postgres origins. This example uses Docker Postgres for that reason. Prisma Postgres behind a deployed Hyperdrive has not been tried yet.

## Troubleshooting

- **`pnpm db:up` fails with `Cannot connect to the Docker daemon`.** Start your container runtime (Docker Desktop, OrbStack, …) and retry.
- **`pnpm db:init` fails with a connection error.** Confirm `pnpm db:up` succeeded and the container is healthy: `docker compose ps`. Port 5433 (not 5432) — port collision with `examples/prisma-8-demo`'s Postgres.app would surface here.
- **`wrangler dev` boots but `/orm/users` returns `500 / connection error`.** The container probably stopped (or you forgot `pnpm db:up`). `pnpm db:reset` brings everything back from a clean slate.
- **Bundle includes `pg-cloudflare` even though I'm running on Node.** Expected — `pg` static-imports `pg-cloudflare` via `lib/stream.js`, and runtime detection (`navigator.userAgent === 'Cloudflare-Workers'`) picks the right socket implementation.

## Known limitations

- **Transaction affinity** — every `db.transaction` body must run its queries through `tx`. A query through `db` inside the body runs inside the open transaction or waits forever, depending on the operation, and a second connection opened inside the body is not part of the transaction; the deployment guide's "Known limitations" lists which operations do what.
- **Isolate memory** — on the `/cursor/large` route, which uses `cursor: { batchSize: 100 }`, `for await` reads large result sets in batches. The other routes buffer their results. For ORM `findMany`-style operations the result set is materialised; size your `limit(...)` accordingly.
- **`pg.Pool` not used** — each connection routes through `PostgresDirectDriverImpl` (`pgClient` binding kind). No connection pooling within the isolate; that's Hyperdrive's job in production.
- **Production `id`** — the committed `wrangler.jsonc` has a zero-stuffed Hyperdrive `id`. Deploy fails until a real id is wired in.
- **Class-table-inheritance ORM queries** — the schema declares `Bug` and `Feature` as `@@base(Task)` discriminator variants for parity with `examples/prisma-8-demo`. The earlier `column "bug.id" does not exist` failure is now resolved: the emitted contract materialises the base-PK link column (`bug.id` / `feature.id`) on each variant table, so the variant join the ORM emits resolves. These queries are not yet exercised by this worker's routes or integration test; `examples/prisma-8-demo` covers the polymorphic-include path end-to-end.
