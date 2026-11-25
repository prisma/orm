# @prisma/orm-mysql

The package a MySQL application installs for its database. It wires the framework, the SQL family, and the MySQL target together. It names the platform packages it is built on as peer dependencies: until release 8.0 at this package's own exact version, and from release 8.0 at a range within this package's release, such as `~8.1.0`. The application lists them beside it, and `prisma orm init` writes that list. To install them by hand, give every `@prisma/orm-*` package the same `8.0.0-rc.N` until release 8.0, and from release 8.0 the lines [the versioning page](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#what-an-application-writes) gives for the release you want:

> **Maturity level: Early Access.** It is released so that people can try it, and it may change in any release. Until release 8.0 every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from release 8.0 the version shows the level. At each new minor, edit every `@prisma/orm-*` line to the new minor by hand and run the install; a package manager's command that updates to the latest version is not a substitute ([why](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga)). See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```sh
pnpm add @prisma/orm-mysql@<version> @prisma/orm-framework@<version> @prisma/orm-family-sql@<version> @prisma/orm-target-mysql@<version> @prisma/orm-toolchain@<version>
```

```
@prisma/orm-mysql
├── @prisma/orm-framework    contracts, components
├── @prisma/orm-family-sql   SQL contract and control plane
├── @prisma/orm-target-mysql target descriptor + adapter + driver
└── @prisma/orm-toolchain    ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the platform packages recognise a data-type value by which copy made it. A data-type value made by a second copy is refused with an error that does not name the cause, and TypeScript reports errors where the two copies' types meet. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-mysql` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

It supports MySQL 8.4 and later. The package covers contracts and migrations (`prisma contract emit`, `prisma migration plan`, `prisma db migrate`, `prisma db verify` and `prisma db sign`) and queries: `mysql({ contract, url })` from `/runtime` runs ORM and SQL builder reads and writes, raw SQL and transactions. MySQL has no `RETURNING`, so an ORM write that returns rows reads them back by key with a `SELECT` in the same transaction. The `mariadb` package writes each value into the statement with its own escaping, so Prisma's code never puts a value into SQL. Row locks such as `FOR UPDATE`, `LATERAL` joins, `RETURNING` and skipping rows that collide with a unique constraint are refused as not supported on MySQL, and so is an update or delete whose filter, or a value it sets, reads the table it writes, which MySQL refuses. A SQL builder `update` reaches this through either; the ORM only through a filter. In the ORM, that is `updateAll`, `deleteAll`, `updateAndCount` and `deleteAndCount` on a variant stored in its own table or filtered through a relation from a model to itself, and an `update` or `delete` filtered through such a relation whose filter names a unique key. An `update` or `delete` whose filter names no unique key reads the row first and writes it by key, so it runs. Instead, read the keys of the rows, and any values the write takes from the table, with a query first, then update or delete those rows by key with those values (for a variant, one row at a time with `update` or `delete`). The filter is checked only when that query runs, so a row another transaction changes in between is still written. MariaDB runs these writes. The ORM cannot yet update a field stored only on a variant's own table, on any database: `update`, `updateAll` and `updateAndCount` refuse it with `ORM.FIELD_UNKNOWN` (a variant's `create` does set such fields).

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
| `/init` | the init contribution `prisma orm init --target @prisma/orm-mysql` writes a project from |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-mysql/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mysql/adapter` |

These forward; they do not copy. `@prisma/orm-mysql/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
