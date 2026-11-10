# Pattern: SPI at the lowest consuming layer

**Status:** Stable
**Maintainer:** architect

## Intent

The framework's emitter needs to call into family-specific behaviour — a SQL emitter does one thing, a Mongo emitter does another. Naively, the framework would import from the family packages. But families are layered _above_ the framework (the framework knows about both; neither family knows the other), so a framework-imports-family edge would invert the layering and `pnpm lint:deps` would refuse to compile it.

The pattern: the framework declares an `EmissionSpi` interface in its own layer; both families implement it; the framework calls into the SPI without ever importing the implementer. Imports flow downward (the family imports the SPI it implements; the framework imports nothing from the family). The SPI is the meeting point — not at the top, not at the bottom, but at the **lowest layer whose types it can name**. (SPI = Service Provider Interface, but you rarely need to expand it; everyone who works with one knows what it is.)

## When to use

- A lower-layer component needs to call into a higher-layer implementation (the framework needs target-specific behaviour; the runner needs driver-specific behaviour; the emitter needs family-specific behaviour).
- The variation point cannot be expressed as a method on a class hierarchy the framework already owns. (If it can, prefer extending the hierarchy — see [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md).)
- The same SPI is implemented by more than one layer above (one per family, or one per target).
- Without the SPI, `pnpm lint:deps` would force a circular import; the SPI breaks the cycle by inverting the dependency.

## When NOT to use

- **The framework can model the variation directly** via abstract methods on a class hierarchy — then use [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md). An SPI declared just to avoid extending a class is over-abstraction.
- **The variation is target-specific behaviour** (dialect emission, capability discovery, error mapping) — that's [Adapter SPI](./adapter-spi.md), a specialised application of this pattern with a stronger naming convention.
- **There is exactly one implementer and no plausible second one.** An SPI with a single permanent implementer is a misnamed concrete type.

## Structure

```
┌────────────────────────────────────────────────────┐
│ tooling / orchestration layer (the caller)         │
│   imports the SPI; calls it; knows nothing about   │
│   who implements it                                 │
└──────────────────────┬─────────────────────────────┘
                       │ imports
┌──────────────────────▼─────────────────────────────┐
│ lowest consuming layer (where the SPI lives)       │
│   export interface EmissionSpi { … }               │
└──────────────────────▲─────────────────────────────┘
                       │ imports
┌──────────────────────┴─────────────────────────────┐
│ family / target layer (the implementer)            │
│   export const sqlEmission: EmissionSpi = { … }    │
│   export const mongoEmission: EmissionSpi = { … }  │
└────────────────────────────────────────────────────┘
```

The SPI module imports only types that exist at its layer or below. The caller imports only the SPI. The implementer imports the SPI and depends on whatever it needs from above. The dependency arrows form a stable Y-shape, not a cycle. The visitor-as-SPI variant ([ADR 198](../adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md)) follows the same shape: the visitor interface lives at the lowest consuming layer; renderers and runners implement it.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| `EmissionSpi` interface | [`packages/1-framework/1-core/framework-components/src/control/emission-types.ts`](../../../packages/1-framework/1-core/framework-components/src/control/emission-types.ts), re-exported from [`exports/emission.ts`](../../../packages/1-framework/1-core/framework-components/src/exports/emission.ts) | The canonical example named in [ADR 185](../adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md). Defined in the lowest layer that can host it (core, alongside `OperationRegistry`); not in foundation (where it would have nothing to bind to). |
| `sqlEmission` implementer | [`packages/2-sql-family/3-tooling/emitter/src/index.ts`](../../../packages/2-sql-family/3-tooling/emitter/src/index.ts) | The SQL family's implementation; tooling-layer package, depends on the SPI. |
| `mongoEmission` implementer | [`packages/2-mongo-family/3-tooling/emitter/src/index.ts`](../../../packages/2-mongo-family/3-tooling/emitter/src/index.ts) | The Mongo family's implementation; symmetric to `sqlEmission`. |
| Family registration site | [`packages/2-sql-family/9-family/src/core/control-descriptor.ts`](../../../packages/2-sql-family/9-family/src/core/control-descriptor.ts) | Where the family wires its `EmissionSpi` implementer into the family descriptor; the framework consumes via this descriptor. |

## Related ADRs

- [ADR 185 — SPI types live at the lowest consuming layer](../adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — the codifying decision; reads as the canonical reference for this pattern.
- [ADR 198 — Runner decoupled from driver via visitor SPIs](../adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) — the visitor variant: the SPI is a visitor interface, the implementers are renderers and runners.

## Related patterns

- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — a specialised application of this pattern for target-specific behaviour, with a stronger naming convention (Adapter, not just SPI).
- [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md) — the alternative when the variation point can be expressed as abstract methods on a class hierarchy the framework already owns.
- [Interface + factory function](./interface-plus-factory.md) — the SPI's implementer is often itself an [Interface + factory](./interface-plus-factory.md)-shaped service; the two patterns compose cleanly.

## Related rules

- [`.cursor/rules/import-validation.mdc`](../../../.cursor/rules/import-validation.mdc) — `pnpm lint:deps` enforces the layering rule that makes this pattern necessary in the first place. If an SPI's module imports something it shouldn't, `lint:deps` catches the leak.

## Cautions / common mistakes

- **Hosting the SPI too high.** If the SPI lives at the same layer as the implementer (or higher), the caller has to depend upward — the inversion is broken. The SPI's layer should be the lowest layer whose types appear in the SPI's signature.
- **Hosting the SPI too low.** If the SPI lives in foundation (or another layer below where its types resolve), it has to import upward to bind to the types it references. That's the symptom of "too low" — the SPI module's imports should be a subset of the layer's allowed imports.
- **Sneaking implementer-only types into the SPI.** Any type the SPI exports forces every implementer to know about it. Every type referenced from the SPI should be something the caller actually consumes.
- **Single-implementer SPIs.** An SPI with one permanent implementer is a misnamed concrete type — surface as a typology defect and rename to the concrete shape.
