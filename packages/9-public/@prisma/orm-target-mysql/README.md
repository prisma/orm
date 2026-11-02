# @prisma/orm-target-mysql

The concrete MySQL target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the MySQL adapter, and the driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-mysql`; app developers install that facade. Extension authors targeting MySQL and decomposed installs import this package directly.

MySQL support is early. This package carries the control plane (emitting contracts, planning and applying migrations, `db verify`, `db sign` and introspection) and the runtime that reads: the SQL renderer and the runtime driver, which runs every statement on the `mariadb` package. The package writes each value into the statement with its own escaping, in one round trip, under the session settings the driver sets and checks: no `NO_BACKSLASH_ESCAPES`, and `utf8mb4`. Writing rows through the ORM or the SQL builder is not supported on MySQL yet.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control and runtime |
| `/adapter` | MySQL adapter: codec types, SQL renderer, control and runtime wiring |
| `/driver` | MySQL driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-mysql/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

## Responsibilities

Everything MySQL-specific: native type normalization, DDL generation, control tables, and the database connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
