# bundle-size

Bundle-size fixture for `@internal/postgres` and `@internal/mongo`,
plus a Cloudflare Workers variant for `@internal/postgres/serverless`.

For each shape there is a **no-emit** entry that builds the contract at
runtime from a TypeScript-authored DSL and an **emit** entry that consumes
the canonical `contract.json` + `contract.d.ts` produced by
`prisma contract emit`. All entries do the same thing: connect to a
real database, run a single `SELECT id FROM "Note" LIMIT 10` (Postgres /
cf-worker) or `db.notes.find().limit(10)` (Mongo) equivalent, and print or
return the rows.

No extensions, no ORM client surface, no middleware — just the runtime
factory and one query, so the number reflects the floor of each shape.

## Layout

```text
src/
├── postgres/                        # Node target, @internal/postgres/runtime
│   ├── contract.ts                  # single Note model with a single id column
│   ├── main.ts                      # no-emit:  postgres({ contract })
│   ├── main-emit.ts                 # emit:     wraps src/postgres/generated/db.ts
│   └── generated/                   # produced by `pnpm emit:pg`
│       ├── contract.json
│       ├── contract.d.ts
│       └── db.ts                    # postgres<Contract>({ contractJson })
├── mongo/                           # Node target, @internal/mongo/runtime
│   ├── contract.ts                  # single Note model with a single _id field
│   ├── main.ts                      # no-emit:  mongo({ contract })
│   ├── main-emit.ts                 # emit:     wraps src/mongo/generated/db.ts
│   └── generated/                   # produced by `pnpm emit:mongo`
│       ├── contract.json
│       ├── contract.d.ts
│       └── db.ts                    # mongo<Contract>({ contractJson })
└── postgres-worker/                 # CF Workers target, @internal/postgres/serverless
    ├── worker.ts                    # no-emit:  postgresServerless({ contract }) + fetch handler
    └── worker-emit.ts               # emit:     postgresServerless<Contract>({ contractJson })
                                       # reuses ../postgres/{contract.ts, generated/}

prisma.config.postgres.ts       # `--config` for emit:pg
prisma.config.mongo.ts          # `--config` for emit:mongo
wrangler.worker.jsonc                # wrangler config: src/postgres-worker/worker.ts
wrangler.worker-emit.jsonc           # wrangler config: src/postgres-worker/worker-emit.ts
scripts/bundle.ts                    # builds all 6 entries (esbuild + wrangler), reports sizes
test/example.test.ts                 # runs the 4 Node entries end-to-end (worker entries
                                       # are bundle-only — no runtime test against miniflare)
```

## Run

```sh
# Postgres
DATABASE_URL=postgres://… pnpm start:pg          # no-emit
DATABASE_URL=postgres://… pnpm start:pg:emit     # emit

# Mongo
MONGODB_URL=mongodb://… MONGODB_DB=… pnpm start:mongo
MONGODB_URL=mongodb://… MONGODB_DB=… pnpm start:mongo:emit
```

## Emit

```sh
pnpm emit:pg     # writes src/postgres/generated/{contract.json,contract.d.ts}
pnpm emit:mongo  # writes src/mongo/generated/{contract.json,contract.d.ts}
pnpm emit        # both
```

## Bundle

```sh
pnpm bundle
```

For each of the four Node entries the script writes an unminified
(`*.bundle.mjs`) and a minified (`*.bundle.min.mjs`) artefact to `dist/` via
esbuild; only `pg`, `pg-native`, and `mongodb` are marked external,
everything Prisma 8 owns is inlined.

For each of the two cf-worker entries the script runs
`wrangler deploy --dry-run --metafile [--minify]` which uses esbuild
internally with the Workers configuration (`workerd` / `worker` /
`browser` conditions, `nodejs_compat` polyfills via
[`unenv`](https://github.com/unjs/unenv)). The Node `pg` driver is inlined
(it's not externalisable in the Workers runtime). Bundles land at
`dist/cf-worker-{no-emit,emit}.worker{,.min}.mjs`.

A `.gz` (gzip level 9) sits next to each artefact, and an esbuild metafile
is emitted alongside each bundle (`*.meta.json`) so `scripts/why.ts` (or
[esbuild.github.io/analyze](https://esbuild.github.io/analyze/)) can
inspect the per-bundle reachability graph. The script prints a sizes table
plus top-10 input contributors per minified bundle.

Note on metafile granularity: wrangler's `--minify` step clears the
per-output `inputs[].bytesInOutput` map. The global `inputs[].bytes` map
stays populated in both variants. For per-output-byte attribution analysis
on a cf-worker bundle, read the unminified metafile (`*.worker.mjs.meta.json`).

## Test (no external DB required)

```sh
pnpm test
```

Postgres tests boot PGlite via `@repo/test-utils.createDevDatabase`.
Mongo tests boot `mongodb-memory-server` (downloads a `mongod` binary on first
run). On unsupported host distros (e.g. NixOS) the Mongo tests will fail
because the binary downloader has no matching artefact — this is an upstream
limitation, not a regression in the example.

The cf-worker entries are bundle-only: there is no miniflare runtime test in
this example. The Cloudflare Workers + Prisma 8 functional coverage lives
in [`examples/prisma-8-cloudflare-worker`](../prisma-8-cloudflare-worker/)
which runs against `@cloudflare/vitest-pool-workers`.

## CI reporting

[`.github/workflows/bundle-size.yml`](../../.github/workflows/bundle-size.yml)
runs [`andresz1/size-limit-action`](https://github.com/andresz1/size-limit-action)
on every PR. It executes `pnpm size:build` (workspace `turbo build` + the
esbuild + wrangler `bundle` script above) for both the head and the base
ref, runs `size-limit --json` against the six minified artefacts (four
`dist/*.bundle.min.mjs` from esbuild and two `dist/cf-worker-*.worker.min.mjs`
from wrangler), and posts a PR comment with the gzipped sizes side by side.
The configuration lives in [`.size-limit.json`](./.size-limit.json) and uses
`@size-limit/file`, so the reported number is the size of the artefact this
`bundle` script already produces — size-limit does not re-bundle.

See [`docs/oss/ci-pipeline.md`](../../docs/oss/ci-pipeline.md#adjacent-workflows)
for why this workflow is intentionally not a required check.
