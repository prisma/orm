# @prisma/orm-target-sqlite

The concrete SQLite target of Prisma Next: the target descriptor (DDL planning, codecs, migration rendering), the SQLite adapter, and the driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-sqlite`; app developers install that facade. Extension authors targeting SQLite and decomposed installs (for example, replacing the adapter while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | SQLite adapter: column types, codec types, runtime wiring |
| `/driver` | SQLite driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-sqlite/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

## Responsibilities

Everything SQLite-specific: native type normalization, DDL generation, control tables, and the database connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
