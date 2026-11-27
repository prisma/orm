# @prisma/orm-target-mongo

The concrete MongoDB target of Prisma 8: the target descriptor (migration rendering, codec types, control), the Mongo adapter, and the `mongodb`-based driver.

> **Maturity level: Early Access.** This package is published so that you can try it. It may have known failures, and any new version may change it. At each new release you edit the Prisma lines in your `package.json` by hand, and [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga) shows how. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes.

A MongoDB application lists this package beside `@prisma/orm-mongo`. The database package requires it as a peer dependency and says which versions it accepts, and `prisma orm init` writes the line for you. Application code imports from the database package. Extension authors targeting MongoDB and decomposed installs (for example, replacing the adapter while keeping the target and driver) import this package directly.

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
