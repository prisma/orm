# Pattern: Interface + factory function (stateful services)

**Status:** Stable
**Maintainer:** architect

## Intent

A consumer holds a `Runtime` and calls `runtime.execute(plan)`. They never see `RuntimeImpl`, never `new RuntimeImpl()`, never `runtime instanceof RuntimeImpl`. The package exports two things: the `Runtime` interface and a `createRuntime()` factory; the implementation class is private to the module. If a test wants to substitute the runtime, it implements the interface — it does not subclass `RuntimeImpl`.

The pattern: stateful services (registries, runtimes, adapters, drivers) are exposed through an exported interface plus a factory function. The implementing class stays package-private. Consumers depend on the interface; the implementation is hidden. The factory's return type is the interface, never the implementation.

## When to use

- The thing being modelled is a **stateful service** with a lifecycle — a registry, a runtime, an adapter, a driver, a connection pool, a session manager.
- Consumers hold an opaque handle and never need to construct the implementation by hand.
- The implementation has internal state (private fields, mutable maps, connection state) that consumers should never touch directly.
- A future implementation swap (in tests, in a different runtime, behind a feature flag) is plausible.

## When NOT to use

- **AST or IR nodes that need polymorphic dispatch and JSON round-trip.** Use [Frozen-class AST + visitor](./frozen-class-ast.md) plus [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md). The catalogue's deliberate split: services hide their classes; AST nodes _are_ their classes.
- **Pure value objects** with no internal state — a frozen plain object plus an exported type is simpler.
- **Single-method "service" with no lifecycle** — that's a function. Don't dress it up.
- **An SPI declared at a lower layer** — that's [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md), which has stricter rules about where the interface can live (this pattern is permissive about layer; SPIs are not).

## Structure

```typescript
// public surface — what consumers see
export interface Runtime {
  execute<Row>(plan: Plan<Row>): AsyncIterable<Row>;
  close(): Promise<void>;
}

// private implementation — never exported from the public entrypoint
class RuntimeImpl implements Runtime {
  #adapter: Adapter;
  #driver: Driver;
  // …state…
  execute<Row>(plan: Plan<Row>): AsyncIterable<Row> { /* … */ }
  close(): Promise<void> { /* … */ }
}

// the only construction path
export function createRuntime(options: CreateRuntimeOptions): Runtime {
  return new RuntimeImpl(options);
}
```

The factory's return type is the interface; the class identity does not leak into the public type. Tests that need to substitute can implement the interface; consumers that need to swap implementations can pass a different factory; nobody needs to know `RuntimeImpl` exists.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| `Runtime` → `createRuntime()` | [`packages/2-sql-family/5-runtime/src/sql-runtime.ts`](../../../packages/2-sql-family/5-runtime/src/sql-runtime.ts) | The SQL runtime; private `RuntimeImpl`, factory exported from `exports/index.ts`. |
| `PostgresAdapter` → `createPostgresAdapter()` | [`packages/3-targets/postgres/2-adapter/src/core/adapter.ts`](../../../packages/3-targets/postgres/2-adapter/src/core/adapter.ts) | The Postgres adapter; private `PostgresAdapterImpl` class, factory wraps with `Object.freeze`. |
| `PostgresRuntimeDriver` → `postgresRuntimeDriverDescriptor.create() + connect(binding)` | [`packages/3-targets/postgres/3-driver/src/exports/runtime.ts`](../../../packages/3-targets/postgres/3-driver/src/exports/runtime.ts) | The Postgres driver; private `PostgresUnboundDriverImpl`, factory exposed via the driver descriptor's `create` method. |

## Related ADRs

- [ADR 007 — Types Only Emission](../adrs/ADR%20007%20-%20Types%20Only%20Emission.md) — informs the broader principle that the public surface is types, not class identities.

## Related patterns

- [Frozen-class AST + visitor](./frozen-class-ast.md) — the **boundary case**. AST/IR nodes intentionally violate this pattern: they expose class instances directly because the pattern they need is polymorphic dispatch through `accept(visitor)`. The two patterns split cleanly along the axis: services hide their classes; AST nodes _are_ their classes.
- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the layered variant for inversion-of-control SPIs. An SPI is an interface plus a contract about layer placement; this pattern is an interface plus a contract about implementation privacy.
- [Adapter SPI](./adapter-spi.md) — the canonical adapter shape combines this pattern with the SPI pattern: `Adapter` is an interface (this pattern) and an SPI (that pattern).

## Related rules

- [`.cursor/rules/interface-factory-pattern.mdc`](../../../.cursor/rules/interface-factory-pattern.mdc) — the tactical rule enforcing this pattern.
- [`.cursor/rules/typescript-patterns.mdc`](../../../.cursor/rules/typescript-patterns.mdc) — the broader TypeScript-patterns rule that covers this and related shapes.
- See also [`docs/reference/typescript-patterns.md`](../../reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" — the catalogue entry is the source of truth for the architectural pattern; the reference doc retains the TypeScript-mechanical caveat about classes with private properties in exported types ("Exception: Classes with Private Properties in Exported Types").

## Cautions / common mistakes

- **Exporting `XxxImpl` from the package's public entrypoint.** Even one re-export leaks the class identity and lets consumers construct or check `instanceof XxxImpl`. Only the interface and the factory should appear in `exports/`.
- **Returning the `Impl` type from the factory.** The factory's return type must be the interface. If the inferred return type is `RuntimeImpl`, the consumer's type position now references the implementation; rename to the interface explicitly.
- **Adding methods to `XxxImpl` and forgetting to declare them on the interface.** The interface is the contract. If a method exists on the implementation but not on the interface, it's invisible to typed consumers and a maintenance trap.
- **Using `instanceof` checks against the implementation class.** A consumer or test that `instanceof XxxImpl`s a value depends on a class identity the pattern says is private.
- **Confusing this with AST nodes.** This pattern says "hide the class". The catalogue's [Frozen-class AST + visitor](./frozen-class-ast.md) pattern says "the class instances _are_ the AST". The two are deliberately different shapes for deliberately different problems; mixing them produces neither.
