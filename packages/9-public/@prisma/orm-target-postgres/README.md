# @prisma/orm-target-postgres

The concrete PostgreSQL target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the Postgres adapter, and the `pg`-based driver.

> **Maturity level: Generally Available.** A later release in the same major version does not break its users. Until release 8.0 every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from release 8.0 the version shows the level. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A PostgreSQL application lists this package beside `@prisma/orm-postgres`, at the version that database package names it at, because it names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the database package. Extension authors targeting Postgres and decomposed installs (for example, replacing the adapter with a custom one while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | Postgres adapter: column types, operation types, runtime wiring |
| `/driver` | `pg`-based driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-postgres/adapter`) aggregates that layer's full surface; deeper paths select individual modules. An application imports the runtime entries (`/target/runtime`, `/adapter/runtime`, `/driver/runtime`), not the bare namespaces, because each aggregate includes the control-plane entries.

`pg` and `@types/pg` are peer dependencies: the driver is the application's, so a `pg.Pool` the application creates and the `pg` types this package declares come from one copy. It supports `pg` 8.22.0 and later within major version 8.

`temporal-polyfill` is a required peer dependency. The `/target/control` entry loads it as a fallback `Temporal` when the runtime has none. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

Everything Postgres-specific: native type normalization, DDL generation, schema diffing, RLS canonicalization, and the wire connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
