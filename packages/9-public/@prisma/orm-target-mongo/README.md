# @prisma/orm-target-mongo

The concrete MongoDB target of Prisma 8: the target descriptor (migration rendering, codec types, control), the Mongo adapter, and the `mongodb`-based driver.

> **From `8.0.0` this package is in Preview.** Its tests block a release for what it supports, its reference documentation lists what it does not support yet, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A MongoDB application lists this package beside `@prisma/orm-mongo`, at the same version, because that target package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the target package. Extension authors targeting MongoDB and decomposed installs (for example, replacing the adapter while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: migration, pack, runtime, control |
| `/adapter` | Mongo adapter: codecs, codec ids, runtime wiring |
| `/driver` | `mongodb`-based driver, plus `/driver/control` |

A bare namespace import (e.g. `@prisma/orm-target-mongo/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

`temporal-polyfill` is a required peer dependency. Only the `/target/control` entry, and the `/target` aggregate that includes it, load it, as a fallback `Temporal` when the runtime has none; no entry an application loads at run time does. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Responsibilities

Everything MongoDB-target-specific: adapter wiring, codec registration, and the wire connection. Shared Mongo semantics live in `@prisma/orm-family-mongo`.
