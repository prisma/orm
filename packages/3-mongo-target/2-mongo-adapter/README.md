# @internal/adapter-mongo

MongoDB adapter for Prisma Next. Lowers abstract MongoDB commands into wire-protocol documents.

## Responsibilities

- **Command lowering**: `MongoAdapter.lower(plan)` converts a `MongoCommand` (find, aggregate, …) into a wire-protocol document. The method is `async` so it can await codec encode work on parameter values; the runtime (`MongoRuntime.execute`) awaits `adapter.lower(plan)` before issuing the command to the driver.
- **Codec application on encode**: `resolveValue` walks parameter trees and dispatches codec-encoded leaves concurrently via `Promise.all`. The codec's `encode` is awaited (whether the codec body is sync or async), and the resolved wire value is placed into the lowered document.

Mongo does not currently decode rows — documents pass through from the driver directly — so this adapter has no decode-side codec application today. See [ADR 204 — Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the codec runtime's async boundary contract.
