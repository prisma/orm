# @internal/framework-components

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Framework component types, authoring logic, control stack assembly, and emission SPI for Prisma 8.

## What this package provides

- **Component types** (`./components`): Base descriptor and instance interfaces for framework components (family, target, adapter, driver, extension), pack refs, and type renderer system
- **Authoring types** (`./authoring`): Declarative authoring contribution types, template resolution, and validation for type constructors and field presets
- **Codec base interface** (`./codec`): The cross-family `Codec` base type that SQL `Codec` and Mongo `MongoCodec` extend
- **Control stack** (`./control`): Assembly functions that combine component descriptors into a unified `ControlStack` with derived state (codec imports, renderers, authoring contributions)
- **Emission SPI** (`./emission`): Types for the emission pipeline — `TargetFamilyHook`, `ValidationContext`, `GenerateContractTypesOptions`, `TypeRenderEntry`, `TypeRenderer`, `ParameterizedCodecDescriptor`, and related types
- **Execution types** (`./execution`): Execution-plane stack and instance interfaces
- **Runtime SPI** (`./runtime`): Abstract `RuntimeCore<TPlan, TExec, TMiddleware>` base class, `RuntimeMiddleware` interface, and the canonical `runQueryWithMiddleware` and `runExecuteWithMiddleware` orchestrator helpers. Family runtimes (`@internal/sql-runtime`, `@internal/mongo-runtime`) extend `RuntimeCore` directly per [ADR 204](../../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-tier%20runtime.md).

## Subpath exports

```typescript
import { ComponentMetadata, FamilyDescriptor, normalizeRenderer } from '@internal/framework-components/components';
import { AuthoringContributions, instantiateAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import type { Codec } from '@internal/framework-components/codec';
import { createControlStack, ControlStack } from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { RuntimeCore, runQueryWithMiddleware, runExecuteWithMiddleware, type RuntimeMiddleware } from '@internal/framework-components/runtime';
```

## `Codec` interface

The base `Codec` interface lands on the seam between **query-time** methods (per-row, IO-relevant) and **build-time** methods (per-contract-load):

- Query-time: `encode(value): Promise<TWire>` and `decode(wire): Promise<TInput>` are required and **Promise-returning at the public boundary**. Codec authors extend `CodecImpl` (per [ADR 208 — Higher-order codecs for parameterized types](../../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md)); a logically synchronous body still has to return a `Promise`-compatible value (mark the method `async`, or return `Promise.resolve(...)` explicitly). The runtime always awaits the result.
- Build-time: `encodeJson`, `decodeJson`, and the optional `renderOutputType` are **synchronous** so `family.deserializeContract` and client construction stay synchronous.

There is no `runtime` / `kind` / equivalent async marker on the interface and no `TRuntime` generic. The runtime always awaits the query-time methods. See [ADR 204 — Single-Path Async Codec Runtime](../../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) for the full design.

### Codec call context (`ctx`)

Codecs receive a second `ctx` options argument; you may ignore it. The runtime allocates one `CodecCallContext` per `query()` or `execute()` call and threads the same reference to every codec dispatch site as a non-optional argument — when no `signal` is supplied the runtime still threads an empty `{}`, never `undefined`. The framework `CodecCallContext` is signal-only:

```ts
export interface CodecCallContext {
  readonly signal?: AbortSignal;
}
```

The internal `Codec` interface declares the parameter as required:

```ts
encode(value: TInput, ctx: CodecCallContext): Promise<TWire>;
decode(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
```

Codec authors who write `(value) => …` continue to compile via TypeScript's bivariance for trailing parameters; nothing at the author surface changes.

Family layers extend the context where they have a per-call concept that doesn't generalise. SQL declares `SqlCodecCallContext extends CodecCallContext { column?: SqlColumnRef }` (see `@internal/sql-relational-core`); Mongo continues to use the framework type directly. Codec authors that take a `(value, ctx)` author signature can forward `ctx.signal` to network SDKs:

```ts
// Sketch — codec authors extend `CodecImpl`; class methods receive `(value, ctx)`.
async encode(v: string, ctx: CodecCallContext): Promise<EncryptedWire> {
  return kms.encrypt({ plaintext: v }, { signal: ctx.signal });
}
```

Aborts surface to the caller as `RUNTIME.ABORTED` with `details.phase ∈ { 'encode', 'decode', 'stream' }`. Codec bodies that ignore the signal complete in the background (cooperative cancellation). The `runtimeAborted(phase, cause?)` envelope helper and the `raceAgainstAbort(work, signal, phase)` race helper are exported from `@internal/framework-components/runtime`.

See [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) for the full design.

## Higher-order codecs (`CodecDescriptor`, `CodecInstanceContext`)

Codec metadata, parameterized-codec registration, and runtime materialization live on a unified `CodecDescriptor<P>` — the only registration shape framework consumers see:

```ts
import type { CodecDescriptor, CodecInstanceContext } from '@internal/framework-components/codec';
import { voidParamsSchema } from '@internal/framework-components/codec';
```

- `CodecDescriptor<P = void>` carries `codecId`, `traits`, `targetTypes`, `meta`, `paramsSchema: StandardSchemaV1<P>`, optional `renderOutputType`, and a curried `factory: (P) => (CodecInstanceContext) => Codec`. Non-parameterized codecs use `P = void` (with the framework-supplied `voidParamsSchema`) and a constant factory; parameterized codecs use a non-empty `P` (e.g. `{ length: number }` for pgvector).
- `CodecInstanceContext` (family-agnostic, `{ name }` only) is supplied by the runtime when materializing a per-instance codec. Pack authors close over it inside the factory; they never construct it. This is the **per-materialization** context, sibling to the **per-call** `CodecCallContext` documented above. Family-specific extensions augment it — the SQL family ships `SqlCodecInstanceContext extends CodecInstanceContext` in `@internal/sql-relational-core/ast`, adding `usedAt: ReadonlyArray<{ table; column }>` for SQL-domain codecs that need column-set metadata.
- Contributors expose their descriptors through `ComponentMetadata.types.codecTypes.codecDescriptors` and the unified `codecs: () => ReadonlyArray<CodecDescriptor>` slot. `extractCodecLookup` reads `targetTypes` / `meta` / `renderOutputType` directly off the descriptors — there is no parameterized vs. non-parameterized split and no synthesis bridge.

`paramsSchema` is typed as Standard Schema (`StandardSchemaV1<P>`), not arktype-specific. arktype `Type`s satisfy the shape via their `~standard` getter, so existing arktype-typed descriptors satisfy the new shape transparently while `framework-components` itself takes no dependency on arktype.

See [ADR 208 — Higher-order codecs for parameterized types](../../../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) for the full design.

## Why SPI types live here (dependency inversion)

This package sits in the **core** layer — below the tooling layer where family-specific emitters and control implementations live. SPI interfaces like `EmissionSpi` define the contract between framework orchestration code (control-plane emission, CLI) and family-specific implementations (SQL emitter, Mongo emitter).

By placing these interfaces in the core layer rather than alongside their implementations:

- **Orchestration code** (control-plane, CLI) can depend on the SPI interfaces without pulling in family-specific packages.
- **Family implementations** (SQL emitter, Mongo emitter) implement these interfaces and depend on this package — the dependency arrow points inward toward the core.
- **The contract package** (`@internal/contract`) remains a true leaf in the `foundation` layer with zero framework-domain dependencies.

This is the [dependency inversion principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle) applied to package layering. The same pattern applies to component descriptors, control-plane types, and execution-plane types in this package.

See [ADR 185 — SPI types live at the lowest consuming layer](../../../../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md).

## Relationship to other packages

This package is the canonical source for framework component types, assembly logic, and emission SPI types. New code should import directly from `@internal/framework-components`.
