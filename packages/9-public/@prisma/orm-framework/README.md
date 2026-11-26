# @prisma/orm-framework

The target-agnostic core of Prisma 8: the contract model, the component/registry system, and the authoring surface that emitted contracts and application code reach at runtime.

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

Every application lists this package beside its database package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-mongo`). The database package requires it as a peer dependency and says which versions it accepts, and `prisma orm init` writes the line for you. Application code imports from the database package, not from this package. Extension authors and decomposed installs (applications replacing part of the default wiring) import it directly.

## Entrypoints

Each subpath namespace consolidates one internal framework module; a bare namespace import (e.g. `@prisma/orm-framework/contract`) aggregates that module's full surface, and deeper paths (e.g. `@prisma/orm-framework/contract/hashing`) select individual modules.

| Namespace | Surface |
| --- | --- |
| `/contract` | contract types, validation, hashing, domain resolution |
| `/components` | component descriptors, control stack, registries, codecs |
| `/contract-authoring` | authoring-time contract construction |
| `/psl-parser`, `/psl-printer` | PSL parsing, formatting, printing |
| `/config` | configuration types and validation |
| `/errors` | control, execution, and migration error types |
| `/ids`, `/operations`, `/ts-render`, `/utils` | identifiers, operation model, TypeScript rendering, shared utilities |
| `/type-implementations` | value logic that more than one target's codecs, data types and `now()` generators share |
| `/target-package-config` | what a database package uses to restate its components' type declarations with its own module |

## Responsibilities

Everything runtime and authoring code needs independently of a concrete database: contract representation and validation, component wiring, PSL handling, and shared utilities. No database drivers, no build tooling (that is `@prisma/orm-toolchain`).
