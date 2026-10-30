# @prisma/orm-target-mongo

The concrete MongoDB target of Prisma 8: the target descriptor (migration rendering, codec types, control), the Mongo adapter, and the `mongodb`-based driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-mongo`; app developers install that facade. Extension authors targeting MongoDB and decomposed installs (for example, replacing the adapter while keeping the target and driver) import this package directly.

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
