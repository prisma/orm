# @prisma/orm-target-mysql

The concrete MySQL target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the MySQL adapter, and the driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-mysql`; app developers install that facade. Extension authors targeting MySQL and decomposed installs import this package directly.

MySQL support is early. This package carries the control plane only: emitting contracts, planning and applying migrations, `db verify`, `db sign` and introspection. Query execution has not landed yet.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | MySQL adapter: codec types, control wiring |
| `/driver` | MySQL driver: control |

A bare namespace import (e.g. `@prisma/orm-target-mysql/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. Only the `/target/control` entry loads it, as a fallback `Temporal` when the runtime has none; no entry an application loads at run time does. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

Everything MySQL-specific: native type normalization, DDL generation, control tables, and the database connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
