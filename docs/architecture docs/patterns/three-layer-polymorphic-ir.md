# Pattern: Three-layer polymorphic IR (framework → family → target)

**Status:** Emerging — adopted by migration ops on every target. The framework-level commitment exists in code, and second and third adopters (Contract IR, Schema IR) are committed but not yet shipped. Promotes to **Stable** once those land.

**Maintainer:** architect

## Intent

Postgres needs `CreateExtensionCall` to model `CREATE EXTENSION`. Mongo doesn't, and shouldn't have to invent a stub `CreateExtensionCall` just because Postgres has one. But the framework still has to walk every target's migration ops generically — for hashing, for display, for "what factory produced this?" — without knowing the per-target kind set ahead of time.

The pattern layers the IR three ways: the **framework** declares an interface that every kind on every target must satisfy (e.g. `OpFactoryCall` with `factoryName`, `operationClass`, `label`); the **family** layer (SQL-shaped, document-shaped) extends that with persistence-shaped abstractions (`SqlMigrationOpNode`, `DocumentMigrationOpNode`); the **target** layer ships concrete classes for the kinds it cares about — including target-only kinds with no family parent. Consumers above the framework dispatch through the framework interface; consumers inside a family dispatch through the family base; the target is the only layer that knows its full kind set.

## When to use

- The IR is consumed at multiple layers (framework tooling, family-level lowering, target-specific rendering).
- Targets must extend the framework's set of kinds with target-only kinds — the framework cannot enumerate them ahead of time.
- The framework needs a stable contract to walk the IR (validation, hashing, display) without knowing the target's full kind set.
- The IR is already a [Frozen-class AST + visitor](./frozen-class-ast.md). This pattern is the layering rule for that one when it crosses the framework/target boundary.

## When NOT to use

- **IRs that are inherently target-uniform.** The unified Plan model is the canonical counter-example: every target lowers _into_ this shape; no target extends it. See [ADR 011 — Unified Plan Model](../adrs/ADR%20011%20-%20Unified%20Plan%20Model.md).
- **Framework-only types** with no target-specific extension surface — the family and target layers are dead weight; skip them.
- **Target-internal types** that the framework never touches — keep them inside the target package; this pattern is for shapes that cross layers.
- **Stateful services** — see [Interface + factory function](./interface-plus-factory.md). Layering services this way over-engineers the contract.

## Structure

```
┌─────────────────────────────────────────────────────────────┐
│ framework layer (target-agnostic)                           │
│   interface OpFactoryCall { factoryName; operationClass; …} │
│   — the minimum contract every target must satisfy           │
└────────────────────────────┬────────────────────────────────┘
                             │ extends
┌────────────────────────────▼────────────────────────────────┐
│ family layer (SQL-shaped, document-shaped, …)               │
│   abstract class SqlMigrationOpNode  implements OpFactoryCall│
│   — refines for the family's persistence model               │
└────────────────────────────┬────────────────────────────────┘
                             │ extends
┌────────────────────────────▼────────────────────────────────┐
│ target layer (Postgres, MySQL, Mongo, …)                    │
│   abstract class PostgresOpFactoryCallNode extends … (or     │
│   directly implements the framework interface for             │
│   target-only kinds)                                          │
│   class CreateTableCall extends PostgresOpFactoryCallNode    │
│   class CreateExtensionCall extends PostgresOpFactoryCallNode│
│   — concrete classes; free to add kinds the framework        │
│     cannot anticipate                                         │
└─────────────────────────────────────────────────────────────┘
```

The framework layer's contract is intentionally minimal — `factoryName`, `operationClass`, `label`. Anything richer requires lifting concepts the framework has no business knowing about. Family-specific or target-specific consumers narrow downward to the layer they actually need.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Framework `OpFactoryCall` interface | [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts) (search for `export interface OpFactoryCall`) | The minimum contract every target's migration-op IR satisfies. |
| Postgres target concrete classes | [`packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts`](../../../packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts) | `PostgresOpFactoryCallNode` abstract base implementing the framework interface; concrete `CreateTableCall`, `AddColumnCall`, etc.; **plus** target-only kinds like `CreateExtensionCall` with no family analog. |
| Mongo target concrete classes | [`packages/3-targets/mongo/1-target/src/core/op-factory-call.ts`](../../../packages/3-targets/mongo/1-target/src/core/op-factory-call.ts) | The same layering on the document side; demonstrates the pattern is family-shaped, not Postgres-shaped. |

## Related ADRs

- [ADR 195 — Planner IR with two renderers](../adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md) — establishes the IR shape this pattern layers.
- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the architecture principle this pattern operationalises.
- [ADR 011 — Unified Plan Model](../adrs/ADR%20011%20-%20Unified%20Plan%20Model.md) — the canonical counter-example: a target-uniform IR that does **not** layer this way.

## Related patterns

- [Frozen-class AST + visitor](./frozen-class-ast.md) — the in-class shape this pattern layers across framework / family / target.
- [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md) — the persistence pattern that target-extensible IRs typically also adopt.
- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — the alternative when the variation is _behaviour_ (lowering, error mapping) rather than _data shape_.

## Cautions / common mistakes

- **Lifting target concepts to the framework layer to "share code".** If the framework interface gains a field that only one target uses, the layering is leaking; either move the field to the family layer or accept that the framework's contract is wider than it should be.
- **Family layer as dead weight.** A family layer that adds nothing beyond `extends` is noise. If the family doesn't refine the contract, drop the layer for that IR.
- **Target-only kinds with no framework parent.** This is **expected**, not a violation — Postgres `CreateExtensionCall` is intentionally a target-only kind. Target-only kinds should still satisfy the framework interface (`factoryName`, `label`, etc.) so framework-level walks don't have to special-case them.
