# @internal/adapter-mongo

MongoDB adapter for Prisma 8. Lowers abstract MongoDB commands into wire-protocol documents.

## Responsibilities

- **Command lowering**: `MongoAdapter.lower(plan)` converts a `MongoCommand` (find, aggregate, …) into a wire-protocol document. The method is `async` so it can await codec `toWire` work on parameter values; the runtime (`MongoRuntime.execute`) awaits `adapter.lower(plan)` before issuing the command to the driver.
- **Codec registration**: The runtime descriptor's `create(stack)` encodes writes with the codecs of the stack's target, adapter and every extension, assembled from their codec descriptors with `assembleMongoCodecRegistry` from `@internal/mongo-codec`, the same registry the execution context decodes with. The control descriptor's `create(stack)` does the same for the control stack, so migrations write values with extension codecs too; the control descriptor contributes the PSL scalar map and points emitted contracts at `@internal/target-mongo/codec-types`. The codecs themselves live in `@internal/target-mongo`.
- **Codec application on write**: `resolveValue` walks parameter trees and dispatches codec leaves concurrently via `Promise.all`. The codec's `toWire` is awaited (whether the codec body is sync or async), and the resolved wire value is placed into the lowered document.

The adapter only encodes. The runtime decodes the documents the driver returns with the execution context's codec registry, which holds the same codecs. See [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract.
