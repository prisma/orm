# @prisma/orm-target-postgres

The concrete PostgreSQL target of Prisma Next: the target descriptor (DDL planning, codecs, migration rendering), the Postgres adapter, and the `pg`-based driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-postgres`; app developers install that facade. Extension authors targeting Postgres and decomposed installs (for example, replacing the adapter with a custom one while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | Postgres adapter: column types, operation types, runtime wiring |
| `/driver` | `pg`-based driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-postgres/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

## Responsibilities

Everything Postgres-specific: native type normalization, DDL generation, schema diffing, RLS canonicalization, and the wire connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
