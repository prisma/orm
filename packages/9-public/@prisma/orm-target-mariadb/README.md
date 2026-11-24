# @prisma/orm-target-mariadb

The concrete MariaDB target of Prisma 8: the target descriptor, the control adapter and the driver, under the target id `mariadb`.

> **From `8.0.0` this package is Early Access.** It is released so that people can try it, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A MariaDB application lists this package beside `@prisma/orm-mariadb`, at the same version, because that target package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the target package. Extension authors targeting MariaDB and decomposed installs import this package directly.

MariaDB support is built on MySQL's. This package publishes only the MariaDB parts: the target metadata and the control target, the control adapter with its catalog reader, and the drivers. MySQL's planner, codecs, data types and SQL come from `@prisma/orm-target-mysql`, a peer dependency at the same version, so each module has one published home. The package covers the control plane: emitting contracts, planning and applying migrations, `db verify`, `db sign` and introspection, on MariaDB 10.11 and later. It also carries the runtime target and the runtime adapter, with MariaDB's SQL renderer, which `mariadb()` in `@prisma/orm-mariadb` runs on.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: metadata, control and runtime targets, and the `Migration` class for MariaDB |
| `/adapter` | control and runtime adapters and codec types |
| `/driver` | MariaDB driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-mariadb/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. The control target loads it, through MySQL's, as a fallback `Temporal` when the runtime has none. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

What MariaDB changes from MySQL: the target id and display name, reading MariaDB's catalog into MySQL's form, the capabilities that make the ORM load includes with a query per relation, and the upsert SQL MariaDB takes. Everything else is MySQL's, in `@prisma/orm-target-mysql`.
