# @prisma/orm-target-sqlite

The concrete SQLite target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the SQLite adapter, and the driver.

> **From `8.0.0` this package is Early Access.** It is released so that people can try it, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A SQLite application lists this package beside `@prisma/orm-sqlite`, at the version that target package names it at, because it names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the target package. Extension authors targeting SQLite and decomposed installs (for example, replacing the adapter while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | SQLite adapter: column types, codec types, runtime wiring |
| `/driver` | SQLite driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-sqlite/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. Only the `/target/control` entry loads it, as a fallback `Temporal` when the runtime has none; no entry an application loads at run time does. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

Everything SQLite-specific: native type normalization, DDL generation, control tables, and the database connection. Shared SQL semantics live in `@prisma/orm-family-sql`.
