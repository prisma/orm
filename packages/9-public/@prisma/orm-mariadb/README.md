# @prisma/orm-mariadb

The package a MariaDB application installs for its database. It wires the framework, the SQL family and the MariaDB target together. It names the MySQL package and the platform packages it is built on as peer dependencies, each at this package's own exact version, so the application lists them beside it, every `@prisma/orm-*` line naming the same version. `prisma orm init` writes that list, in the form the project's package manager writes a version it is given. To install them by hand, give every `@prisma/orm-*` package the same version, the release you want:

```sh
pnpm add @prisma/orm-mariadb@<version> @prisma/orm-framework@<version> @prisma/orm-family-sql@<version> @prisma/orm-target-mariadb@<version> @prisma/orm-target-mysql@<version> @prisma/orm-mysql@<version> @prisma/orm-toolchain@<version>
```

```
@prisma/orm-mariadb
├── @prisma/orm-framework       contracts, components
├── @prisma/orm-family-sql      SQL contract and control plane
├── @prisma/orm-target-mariadb  target descriptor + control adapter + driver
├── @prisma/orm-target-mysql    MySQL's target, which MariaDB's extends
├── @prisma/orm-mysql           MySQL's configuration, which MariaDB's builds on
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the platform packages recognise a data-type value by which copy made it. A data-type value made by a second copy is refused with an error that does not name the cause, and TypeScript reports errors where the two copies' types meet. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-mariadb` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

MariaDB support is early. The package covers contracts, migrations and queries on MariaDB 10.11 and later: `prisma contract emit`, `prisma migration plan`, `prisma db migrate`, `prisma db verify`, `prisma db sign`, and `mariadb({ contract, url })`, the query client, which reads and writes through the ORM, the SQL builder and raw SQL as `mysql()` does on MySQL. The contract is a `.prisma` schema or a TypeScript contract written with `defineContract` from `@prisma/orm-mariadb/contract-builder`.

```ts
import mariadb from '@prisma/orm-mariadb/runtime';
import { contractFromJson } from '@prisma/orm-mariadb/static';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

const url = process.env['MARIADB_URL'];
if (url === undefined) throw new Error('Set MARIADB_URL');
const db = mariadb({ contract: contractFromJson<Contract>(contractJson), url });
const users = await db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.id.desc()).limit(3)).all();
```

The URL may use `mariadb://` or `mysql://`. MariaDB loads each include with a query of its own, after the parent rows.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Requirements

These hold on MariaDB 10.11 as on MySQL 8.4; each was checked on a live MariaDB 10.11 server.

- **Transactions the ORM owns run at READ COMMITTED.** The driver starts each with `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`. A `db.transaction()` without an isolation level, and a statement outside a transaction, run at the server's default, REPEATABLE READ on MariaDB 10.11. Prisma sets no session isolation level.
- **Binary logging, when it is on, must be row-based or mixed (`binlog_format = ROW` or `MIXED`, MariaDB 10.11's default being `MIXED`).** With `binlog_format = STATEMENT`, InnoDB refuses a write at READ COMMITTED with error 1665, "Cannot execute statement: impossible to write to binary log", so every ORM write fails.
- **`session_track_system_variables` must keep `character_set_client`,** as MariaDB 10.11's default does. The driver confirms from it that the connection reads statements as utf8mb4 before it sends values, and refuses them otherwise (`RUNTIME.CHARACTER_SET_UNSUPPORTED`).
- **The session's `sql_mode` must not contain `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`.** The driver removes both on every connection; raw SQL, stored procedures and triggers must not set them again. The MySQL driver's [environment requirements](https://github.com/prisma/orm/blob/main/packages/3-targets/mysql/1-mysql/3-driver/README.md#environment-requirements) give the detail, and hold on MariaDB too.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract` and its helpers, for a contract written in TypeScript |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/migration`, `/control` | migration classes and the control client |
| `/runtime` | `mariadb({ contract, url })`, the query client |
| `/static` | `contractFromJson` and the statically composed runtime |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-mariadb/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mariadb/adapter` |
| `/driver`, `/driver/*` | `@prisma/orm-target-mariadb/driver` |

These forward; they do not copy. `@prisma/orm-mariadb/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
