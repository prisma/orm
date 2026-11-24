# @prisma/orm-target-mysql

The concrete MySQL target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the MySQL adapter, and the driver.

> **From `8.0.0` this package is Early Access.** It is released so that people can try it, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A MySQL or MariaDB application lists this package beside its target package (`@prisma/orm-mysql`, `@prisma/orm-mariadb`), at the version the target package names it at, because the target package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the target package. Extension authors targeting MySQL and decomposed installs import this package directly.

This package carries the control plane (emitting contracts, planning and applying migrations, `db verify`, `db sign` and introspection) and the runtime: the SQL renderer and the runtime driver, which runs every statement on the `mariadb` package. The package writes each value into the statement with its own escaping, in one round trip, under the session settings the driver sets and checks: no `NO_BACKSLASH_ESCAPES`, and `utf8mb4`. The renderer writes inserts, updates, deletes and upserts (`INSERT … AS new ON DUPLICATE KEY UPDATE`), and refuses `RETURNING`, row locks and `LATERAL` joins.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control and runtime |
| `/adapter` | MySQL adapter: codec types, SQL renderer, control and runtime wiring |
| `/driver` | MySQL driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-mysql/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. Only the `/target/control` entry loads it, as a fallback `Temporal` when the runtime has none; no entry an application loads at run time does. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

Everything MySQL-specific: native type normalization, DDL generation, control tables, and the database connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
