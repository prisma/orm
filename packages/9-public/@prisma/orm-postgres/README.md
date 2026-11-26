# @prisma/orm-postgres

The package a PostgreSQL application installs for its database. It wires the framework, the SQL family, and the Postgres target into a single lazy client. It names the platform packages it is built on as peer dependencies, each at this package's own exact version, so the application lists them beside it, every `@prisma/orm-*` line naming the same version. `prisma orm init` writes that list, in the form the project's package manager writes a version it is given. To install them by hand, give every `@prisma/orm-*` package the same version, the release you want:

```sh
pnpm add @prisma/orm-postgres@<version> @prisma/orm-framework@<version> @prisma/orm-family-sql@<version> @prisma/orm-target-postgres@<version> @prisma/orm-toolchain@<version>
pnpm add pg
pnpm add -D @types/pg
```

```
@prisma/orm-postgres
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-postgres target descriptor + adapter + driver
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the platform packages recognise a data-type value by which copy made it. A data-type value made by a second copy is refused with an error that does not name the cause, and TypeScript reports errors where the two copies' types meet. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-postgres` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

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

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

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

These forward; they do not copy. `@prisma/orm-postgres/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

## Lower-level entry points

Beneath the client factories the facade also publishes the layers they are built from, as stable subpaths code names directly when it needs the layer beneath the client: an expression the raw-SQL lane cannot infer a codec for, a caller-owned pool, a decomposed install, a script that audits migrations.

| Entrypoint | Surface |
| --- | --- |
| `/relational-core/expression` | the expression helpers: `param(value, { codecId })` wraps a literal value whose codec the raw-SQL lane cannot infer (the fix `RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION` names; a query fragment interpolates directly and must not be wrapped), `toExpr(value, codec?)` lifts an expression or a raw value into an AST expression — a raw value requires `codec` (without one it throws `RUNTIME.PARAM_REF_CODEC_REQUIRED`), an expression does not, `buildOperation(spec)` builds a custom operation's AST |
| `/relational-core/ast` | the relational AST classes a plan's query is built from (`ColumnRef`, `ParamRef`, `LiteralExpr`, `BinaryExpr`, `TableSource`, …) |
| `/relational-core/types` | the plan and scope types: `SqlOrmPlan`, the shape `db.query(plan)` and `db.execute(plan)` accept |
| `/driver/runtime` | `createPgPool(config, sessionSettings)` and `createPgClient(config, sessionSettings)` — a pool or client whose every session starts with the session settings the target declares |
| `/target/runtime` | the Postgres runtime target descriptor (the default export), with `sessionSettings` and the codec, query-operation and collection-method contributions a decomposed install composes |
| `/migration-tools/io` | the migration package reader: `readMigrationPackage(dir, options)` reads one package, `readMigrationsDir(root, options)` reads the graph directory, returns per-package load problems in `problems`, skips directories without `migration.json` silently, returns empty `packages` and `problems` when the root does not exist, and throws for any other filesystem error while listing the root or stat-ing an entry |

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

Every application lists the four platform packages, so an application that outgrows the default wiring already has them. It imports from them directly and recomposes them — for example replacing `@prisma/orm-target-postgres/adapter` with a pooled adapter of its own while keeping the target and driver — and drops this package. Because every package is at one exact version, the decomposed application gets exactly what this package would have provided, minus the replaced part.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
