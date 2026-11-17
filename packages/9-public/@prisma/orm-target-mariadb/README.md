# @prisma/orm-target-mariadb

The concrete MariaDB target of Prisma 8: the target descriptor, the control adapter and the driver, under the target id `mariadb`.

Applications receive it as an exact-pinned dependency of `@prisma/orm-mariadb`; app developers install that facade. Extension authors targeting MariaDB and decomposed installs import this package directly.

MariaDB support is early, and is built on MySQL's. This package publishes only the MariaDB parts: the target metadata and the control target, the control adapter with its catalog reader, and the drivers. MySQL's planner, codecs, data types and SQL come from `@prisma/orm-target-mysql`, an exact-pinned dependency, so each module has one published home. The package covers the control plane: emitting contracts, planning and applying migrations, `db verify`, `db sign` and introspection, on MariaDB 10.11 and later. There is no query runtime yet.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: metadata, control target and the `Migration` class for MariaDB |
| `/adapter` | control adapter and codec types |
| `/driver` | MariaDB driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-mariadb/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. The control target loads it, through MySQL's, as a fallback `Temporal` when the runtime has none. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

What MariaDB changes from MySQL: the target id, the session settings, and reading MariaDB's catalog into MySQL's form. Everything else is MySQL's, in `@prisma/orm-target-mysql`.
