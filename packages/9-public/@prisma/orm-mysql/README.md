# @prisma/orm-mysql

The one package a MySQL application installs. It wires the framework, the SQL family, and the MySQL target together, and brings the rest of the stack along as exact-pinned dependencies:

```sh
pnpm add @prisma/orm-mysql
```

```
@prisma/orm-mysql
├── @prisma/orm-framework    contracts, components
├── @prisma/orm-family-sql   SQL contract and control plane
├── @prisma/orm-target-mysql target descriptor + adapter + driver
└── @prisma/orm-toolchain    ORM command family for the `prisma` CLI, emitter, config loader
```

MySQL support is early. It supports MySQL 8.4 and later. The package covers contracts and migrations (`prisma contract emit`, `prisma migration plan`, `prisma db migrate`, `prisma db verify` and `prisma db sign`) and queries: `mysql({ contract, url })` from `/runtime` runs ORM and SQL builder reads and writes, raw SQL and transactions. MySQL has no `RETURNING`, so an ORM write that returns rows reads them back by key with a `SELECT` in the same transaction. The `mariadb` package writes each value into the statement with its own escaping, so Prisma's code never puts a value into SQL. Row locks such as `FOR UPDATE`, `LATERAL` joins, `RETURNING` and skipping rows that collide with a unique constraint are refused as not supported on MySQL, and so is an update or delete whose filter reads the table it writes, which MySQL refuses: `updateAll`, `deleteAll`, `updateAndCount` and `deleteAndCount` on a variant stored in its own table, and updates and deletes filtered through a relation from a model to itself. Read the keys with a query first, then update or delete by key through the base model's collection. MariaDB runs these writes.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/contract-builder` | `defineContract` and MySQL contract authoring |
| `/migration`, `/control` | migration planning and the control client |
| `/runtime` | `mysql({ contract, url })`, the query client |
| `/static` | `contractFromJson` and the statically composed runtime |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. The facade also forwards the namespaces of the packages it is built from, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-mysql/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mysql/adapter` |

These forward; they do not copy. `@prisma/orm-mysql/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
