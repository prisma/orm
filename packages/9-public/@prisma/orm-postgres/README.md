# @prisma/orm-postgres

The one package a PostgreSQL application installs. It wires the framework, the SQL family, and the Postgres target into a single lazy client, and brings the rest of the stack along as exact-pinned dependencies:

```sh
pnpm add @prisma/orm-postgres pg
pnpm add -D @types/pg
```

```
@prisma/orm-postgres
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-postgres target descriptor + adapter + driver
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

`pg` and `@types/pg` are peer dependencies: the driver is the application's, so a `pg.Pool` the application creates and the `pg` types Prisma 8 declares come from one copy. Prisma 8 supports `pg` 8.22.0 and later within major version 8.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands and the Vite plugin, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `postgres(url)` — the lazy query client |
| `/serverless` | the serverless runtime variant |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/contract-builder` | `defineContract`, Postgres enums, RLS authoring |
| `/target`, `/family` | the Postgres target pack and the SQL family pack |
| `/migration`, `/control` | migration planning and the control client |
| `/init` | the init contribution `prisma orm init` writes a project from |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. The facade also forwards the namespaces of the packages it is built from, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-postgres/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-postgres/adapter` |
| `/driver`, `/driver/*` | `@prisma/orm-target-postgres/driver` |
| `/relational-core`, `/relational-core/*` | `@prisma/orm-family-sql/relational-core` |
| `/migration-tools/*` | `@prisma/orm-toolchain/migration-tools` |

These forward; they do not copy. `@prisma/orm-postgres/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## Lower-level entry points

Beneath the client factories the facade also publishes the layers they are built from, as stable subpaths code names directly when it needs the layer beneath the client: an expression the raw-SQL lane cannot infer a codec for, a caller-owned pool, a decomposed install, a script that audits migrations.

| Entrypoint | Surface |
| --- | --- |
| `/relational-core/expression` | the expression helpers: `param(value, { codecId })` wraps a literal value whose codec the raw-SQL lane cannot infer (the fix `RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION` names; a query fragment interpolates directly and must not be wrapped), `toExpr(value, codec?)` lifts an expression or a raw value into an AST expression — a raw value requires `codec` (without one it throws `RUNTIME.PARAM_REF_CODEC_REQUIRED`), an expression does not, `buildOperation(spec)` builds a custom operation's AST |
| `/relational-core/ast` | the relational AST classes a plan's query is built from (`ColumnRef`, `ParamRef`, `LiteralExpr`, `BinaryExpr`, `TableSource`, …) |
| `/relational-core/types` | the plan and scope types: `SqlOrmPlan`, the shape `db.query(plan)` and `db.execute(plan)` accept |
| `/driver/runtime` | `createPgPool(config, sessionSettings)` and `createPgClient(config, sessionSettings)` — a pool or client whose every session starts with the session settings the target declares |
| `/target/runtime` | the Postgres runtime target descriptor (the default export), with `sessionSettings` and the codec, query-operation and collection-method contributions a decomposed install composes |
| `/migration-tools/io` | the migration package reader: `readMigrationPackage(dir, options)` reads one package, `readMigrationsDir(root, options)` reads the graph directory, returns per-package load problems in `problems`, skips directories without `migration.json` silently, and throws for filesystem errors while listing the root or stat-ing an entry |

```ts
import { param } from '@prisma/orm-postgres/relational-core/expression';
import { createPgPool } from '@prisma/orm-postgres/driver/runtime';
import postgresTarget from '@prisma/orm-postgres/target/runtime';

// A value the raw-SQL lane would refuse (anything not number, bigint, string,
// boolean or Uint8Array) is wrapped with an explicit codec:
const plan = db.raw
  .sql`SELECT id FROM event WHERE at > ${param(myTimestamp, { codecId: 'pg/timestamptz-temporal@1' })}`
  .returnsRow({ id: 'pg/int8@1' })
  .build();

// A caller-owned pool whose sessions start with the same settings the
// facade-owned pool gets:
const pool = createPgPool(
  { connectionString: process.env['DATABASE_URL'] },
  postgresTarget.sessionSettings ?? {},
);
```

A decomposed install (see *Decomposing* below) composes the runtime stack from the descriptors these entry points carry: the target, the driver, and the adapter of its choice passed to `createSqlExecutionStack`. Under the facade the stack builder is `@prisma/orm-postgres/family-runtime`; a decomposed install composes the same modules through the platform packages (`@prisma/orm-target-postgres/target/runtime`, `@prisma/orm-target-postgres/driver/runtime`, `@prisma/orm-family-sql/runtime`), which are the exact-pinned dependencies the facade would have installed.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Decomposing

An application that outgrows the default wiring installs the four platform packages directly and recomposes them — for example replacing `@prisma/orm-target-postgres/adapter` with a pooled adapter of its own while keeping the target and driver. Because everything is pinned to one lockstep version, the decomposed install reproduces exactly what the facade would have provided, minus the replaced part.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
