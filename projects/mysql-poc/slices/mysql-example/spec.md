# Slice 2c — The MySQL example app and the public packages

**Linear:** [TML-3723](https://linear.app/prisma-company/issue/TML-3723) · **Branch:** `tml-3723-mysql-example-app` (stacked on 2b) · **Project:** [`../../spec.md`](../../spec.md)

## At a glance

A new example that an application developer would recognise, using only the published facade:

```text
examples/prisma-8-demo-mysql/
  package.json           depends on @prisma/orm-mysql only
  prisma.config.ts
  prisma/contract.prisma the project's example contract (User, Post, Role)
  migrations/            written by `prisma migration plan`
  src/prisma/            contract.json, contract.d.ts
  test/                  runs against MYSQL_URL
```

```text
$ cd examples/prisma-8-demo-mysql
$ pnpm emit                 # prisma contract emit
$ pnpm migration:plan --name init   # prisma migration plan (committed)
$ pnpm db:migrate           # prisma db migrate
$ pnpm db:verify            # prisma db verify
$ pnpm test                 # the same, end to end, against a fresh database
```

From this slice on, every MySQL slice extends this example with what it delivers, and is done only when the example runs it in CI: reads in slice 3, writes in slice 4, MariaDB in slice 6. That is how the Postgres, SQLite and Mongo examples grew (Will, 2026-10-23).

## Chosen design

- **Public packages first.** `packages/9-public/@prisma/orm-mysql` (the facade) and `@prisma/orm-target-mysql` (target, adapter and driver entrypoints), shaped like `orm-sqlite` and `orm-target-sqlite`, wired in `packages/0-shared/publish-surface/src/shells.ts`, with `src-gen/` generated the way the other shells are. They expose only the entrypoints that exist today (config, contract builder, control, migration); `./runtime` and `./static` follow in slice 3 when the facade gains them. `pnpm lint:publishability` passes.
- **The example depends on `@prisma/orm-mysql` alone,** like `prisma-8-demo-sqlite` depends on `@prisma/orm-sqlite`. It has no `@repo/test-utils` (the facade-only rule in `use-timeouts-helper-in-tests.mdc`), so it carries its own small `test/` helpers: a timeout constant scaled by `TEST_TIMEOUT_MULTIPLIER`, as `examples/mongo-blog-leaderboard/test/timeouts.ts` does, and a helper that creates and drops a uniquely named database on the server at `MYSQL_URL`.
- **What the example proves now:** the contract emits and the committed `contract.json`/`contract.d.ts` stay stable (`pnpm emit:check`, picked up by `fixtures:check` if the other examples are); the committed migration applies to an empty database; `db verify` passes; `db sign` passes; adding nothing and planning again writes no migration. The test drives the `prisma` CLI the way the other examples' migration tests do, and asserts the database's tables through the CLI's own output, not through internal packages.
- **CI.** The "Test Examples" job gets a `mysql:8.4` service with a health check and `MYSQL_URL`, matching the Package Tests job. Without `MYSQL_URL` the example's tests skip, so local runs without MySQL still pass.
- **README** like the SQLite demo's: what it shows, setup, the commands, and that it grows with each slice.

## Coherence rationale

One reviewer reads this as "MySQL has a public package and a real example that migrates": a new example, two thin public shells and one CI service. It is the base later slices extend.

## Scope

**In:** the two public packages, the example with its contract, committed migration and tests, the CI service, README, registration and publishability.

**Out:** queries (slice 3 adds reads to the example, slice 4 writes), MariaDB (slice 6).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Examples may not import `@repo/test-utils` or name two import roots | Local helpers in `test/`; `scripts/lint-single-import-root.mjs` passes |
| Upgrade coverage counts `examples/` as `app` audience | Add a no-op `app` declaration if the check asks for one |
| A new publishable package | Lives in `packages/9-public/@prisma/`, `lint:publishability` passes, `turbo.json` and `shells.ts` list it like the SQLite shells |
| Shared code that names a target | Never add one |
| Destructive git operations | Forbidden without orchestrator approval |

## Done when

`pnpm test:examples` runs the MySQL example against MySQL 8.4 in CI and it passes: emit, migrate, verify, sign and a no-op re-plan; the public packages pass `lint:publishability`; and build, typecheck, lint, `lint:deps`, `fixtures:check` and upgrade coverage pass.
