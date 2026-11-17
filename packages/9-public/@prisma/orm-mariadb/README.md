# @prisma/orm-mariadb

The one package a MariaDB application installs. It wires the framework, the SQL family and the MariaDB target together, and brings the rest of the stack along as exact-pinned dependencies:

```sh
pnpm add @prisma/orm-mariadb
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

MariaDB support is early. The package covers contracts, migrations and queries on MariaDB 10.11 and later: `prisma contract emit`, `prisma migration plan`, `prisma db migrate`, `prisma db verify`, `prisma db sign`, and `mariadb({ contract, url })`, the query client, which reads and writes through the ORM, the SQL builder and raw SQL as `mysql()` does on MySQL. The contract must be a `.prisma` schema.

```ts
import mariadb from '@prisma/orm-mariadb/runtime';
import { contractFromJson } from '@prisma/orm-mariadb/static';

const db = mariadb({ contract: contractFromJson<Contract>(contractJson), url: process.env.MARIADB_URL });
const users = await db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.id.desc()).limit(3)).all();
```

The URL may use `mariadb://` or `mysql://`. MariaDB loads each include with a query of its own, after the parent rows.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/migration`, `/control` | migration classes and the control client |
| `/runtime` | `mariadb({ contract, url })`, the query client |
| `/static` | `contractFromJson` and the statically composed runtime |

Generated contract files and migrations import from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-mariadb/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mariadb/adapter` |
| `/driver`, `/driver/*` | `@prisma/orm-target-mariadb/driver` |

These forward; they do not copy. `@prisma/orm-mariadb/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
