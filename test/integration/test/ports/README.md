# Ported test corpus

Behavioral-compatibility corpus for prisma-next, ported faithfully from the two upstream Prisma suites pinned for the [`port-all-tests`](../../../../projects/port-all-tests/spec.md) project:

- `prisma/prisma` @ `a6d01554528e016bea1467a072776b0e2b94dcba`
- `prisma/prisma-engines` @ `e922089b7d7502aff4249d5da3420f6fa55fc6ad`

Every in-scope upstream test lands in exactly one bucket (the accounting invariant):

1. **Ported & passing** — a vitest test here using the same schema, logically the same query through prisma-next's nearest public API, and the same assertions.
2. **Ported & failing** — a faithful port that hits a real prisma-next gap: `test.fails` + an entry in the corpus `failing.md`.
3. **Non-portable** — an individual line in the suite's `non-ported/functional/<suite>/<suite>.md` (source location + what it tests + the specific reason it cannot be expressed).

The per-test ledger is the checklist corpus at [`projects/port-all-tests/checklists/`](../../../../projects/port-all-tests/checklists/README.md); the reviewer checks a box only once its disposition is verified.

## Layout

```
ports/
  _harness/        shared test harnesses (withPostgresPort, withMongoPort)
  prisma/          ports of prisma/prisma
    functional/
      <suite>/                  one directory per ported suite
        <suite>.test.ts         the port (runtime + inline type assertions)
        _fixture/               co-located contract fixture
          contract.prisma       faithful PSL translation of the upstream schema
          prisma.config.ts
          generated/            emitted contract.json + contract.d.ts
    non-ported/
      functional/
        <suite>/<suite>.md      non-portable tests, one file per suite (mirrors functional/<suite>/)
    failing.md                  all test.fails entries (single file)
  engines/         ports of prisma/prisma-engines (same shape)
```

## Adding a suite

Each suite is its own directory. Author the schema as **PSL** in `prisma/functional/<suite>/_fixture/contract.prisma` (faithful translation of the upstream `schema.prisma`) plus a `prisma.config.ts` (`definePrismaConfig` from `@prisma/cli-engine` with an `orm` section built by `defineConfig` from `@internal/postgres/config`: `contract: './contract.prisma'`, `output: 'generated'` — copy an existing suite's). Then emit:

```bash
node packages/1-framework/3-tooling/cli/dist/bin.mjs contract emit \
  --config test/integration/test/ports/prisma/functional/<suite>/_fixture/prisma.config.ts
```

Commit the generated `contract.json` + `contract.d.ts`. The test (`prisma/functional/<suite>/<suite>.test.ts`) imports the typed `Contract` + JSON from `./_fixture/generated/…` and the harness from `../../../_harness/postgres`, and passes the JSON to `withPostgresPort`. **The harness builds the public `postgres(...)` facade over a PGlite dev database after pushing the contract via prisma-next's own plan→apply path (the same mechanism `db init` uses) — no hand-written DDL.** Seed and query through the ORM (`ctx.db.public.<Model>...`); interactive transactions use `ctx.transaction(async (tx) => tx.orm.public.<Model>...)`. See `prisma/functional/distinct/` for the reference pattern.

Notes: prisma-next PSL lowercases table names (model `User` → table `user`) but keeps column names verbatim; scalar lists (`String[]`, `Int[]`) are supported and emit native pg arrays. MongoDB suites port against prisma-next's dedicated mongo ORM (`mongoOrm()`) with a `mongodb-memory-server` harness — not marked non-ported.

## Roll-up

_Totals are finalised at project close-out. Live progress is tracked in the checklist corpus._

| Corpus | Ported & passing | Ported & failing (`test.fails`) | Non-portable |
| --- | --- | --- | --- |
| prisma/prisma | in progress | in progress | in progress |
| prisma-engines | in progress | in progress | in progress |
