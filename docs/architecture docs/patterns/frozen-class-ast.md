# Pattern: Frozen-class AST + visitor

**Status:** Stable
**Maintainer:** architect

## Intent

Migration ops are a tree of kinds: `CreateTableCall`, `AddColumnCall`, `DropIndexCall`, and a Postgres-only `CreateExtensionCall`. Several walks consume that tree — the renderer that prints TypeScript, the runner that applies ops, the differ that compares two op sets. When a new kind lands (say a Postgres `CreateMaterializedViewCall`), every walk needs to know about it; quietly forgetting one is a bug that won't surface until production.

The pattern: every kind is a small concrete class extending an abstract base; the base declares an `accept(visitor)` method; consumers dispatch through the visitor instead of through `switch (node.kind)`. Adding a new kind is a compile error in every walk that hasn't handled it. Each instance is `Object.freeze`'d in its constructor so the tree is immutable once built.

## When to use

- The tree has more than two kinds and consumers need exhaustive kind-narrow dispatch.
- The tree round-trips through JSON (pairs naturally with [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md)).
- Targets need to extend the framework's set of kinds with target-only kinds (pairs with [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md)).
- Multiple distinct walks exist (planning, lowering, rendering, diffing) and each wants a checked exhaustiveness signal when a new kind lands.

## When NOT to use

- **Stateful services** (registries, runtimes, adapters, drivers) — use [Interface + factory function](./interface-plus-factory.md). Services have lifecycle and behaviour, not polymorphic data. The catalogue's deliberate split: services hide their classes; AST nodes _are_ their classes.
- **Single-instance value objects** that nobody dispatches over polymorphically — a plain `interface` plus a frozen literal is enough.
- **Trees that never need polymorphic dispatch** — if the only consumer is a single switch, a discriminated union of plain objects is cheaper to read.
- **Hot-path data structures where allocation dominates** — class instances per node have measurable overhead vs. plain objects; profile before adopting in tight loops.

## Structure

```
abstract class FooAstNode {                      // package-private base
  abstract readonly kind: string;                 // literal discriminator
  abstract accept<R>(visitor: FooVisitor<R>): R;  // exhaustive dispatch
  abstract rewrite(rewriter: FooRewriter): FooAst; // optional: transform
  protected freeze(): void { Object.freeze(this); }
}

export class FooLiteral extends FooAstNode {     // concrete class per kind
  readonly kind = 'literal' as const;
  readonly value: string;
  constructor(value: string) {
    super();
    this.value = value;
    this.freeze();                                // frozen at construction
  }
  accept<R>(v: FooVisitor<R>): R { return v.literal(this); }
  rewrite(_: FooRewriter): FooAst { return this; }
}

export interface FooVisitor<R> {                  // exhaustive contract
  literal(node: FooLiteral): R;
  binary(node: FooBinary): R;
  // ...one method per kind
}
```

The base is package-private; consumers see only the framework-level interface (e.g. `OpFactoryCall`) and the discriminated union of concrete classes (e.g. `PostgresOpFactoryCall`). The `kind` field lets a non-visitor consumer narrow ad hoc; the visitor lets the type system prove exhaustiveness across kinds.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Postgres migration ops IR | [`packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts`](../../../packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts) | Abstract `PostgresOpFactoryCallNode` base + one concrete `*Call` class per pure factory; `freeze()` in constructor; polymorphic `toOp()` and inherited `renderTypeScript()` hooks. |
| Mongo migration ops IR | [`packages/3-targets/mongo/1-target/src/core/op-factory-call.ts`](../../../packages/3-targets/mongo/1-target/src/core/op-factory-call.ts) | Same shape on the Mongo target; demonstrates the pattern's portability across SQL- and document-shaped targets. |
| Mongo schema IR | [`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts) (with siblings `schema-ir.ts`, `schema-collection.ts`, `schema-index.ts`, `schema-validator.ts`) | Visitor extracted into a dedicated [`visitor.ts`](../../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/visitor.ts) — `MongoSchemaVisitor<R>` with one method per node kind. |
| Mongo filter expressions | [`packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts) | Both the **visitor** (`MongoFilterVisitor<R>`) and the **rewriter** (`MongoFilterRewriter`) variants on the same hierarchy; brand-tagged via non-enumerable `Object.defineProperty`. |
| Mongo aggregation expressions, stages, wire commands | [`aggregation-expressions.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts), [`stages.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/stages.ts), [`wire-commands.ts`](../../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts) | The pattern scales across the full Mongo query stack, not just one IR layer. |

## Related ADRs

- [ADR 195 — Planner IR with two renderers](../adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md) — the framing decision that established the visitor-driven IR shape.
- [ADR 187 — MongoDB schema representation for migration diffing](../adrs/ADR%20187%20-%20MongoDB%20schema%20representation%20for%20migration%20diffing.md) — first application to a target-extensible schema IR.
- [ADR 188 — MongoDB migration operation model](../adrs/ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) — extension to the migration-ops IR on the document side.
- [ADR 193 — Class-flow as the canonical migration authoring strategy](../adrs/ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md) — locks in classes (not plain-object IR) as the authoring shape.

## Related patterns

- [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md) — almost always paired with this pattern when the AST persists.
- [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md) — the framework/family/target layering this pattern adopts when targets need to extend the kind set.
- [Interface + factory function](./interface-plus-factory.md) — the alternative when the thing being modelled is a stateful service rather than a polymorphic data tree. See its "When NOT to use" for the inverse boundary.

## Cautions / common mistakes

- **Forgetting `freeze()` in the constructor.** A class that allows post-construction mutation breaks the round-trip invariant and the visitor's "data is final after `accept`" contract.
- **Storing non-JSON-clean fields** (`Map`, `Set`, `Date`, methods on properties) on a class that round-trips through JSON. The catalogue's [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md) entry spells out the constraint; this pattern alone does not.
- **Skipping the visitor and dispatching with `switch (node.kind)` everywhere.** That works until a new kind lands and the compiler cannot tell you which switches need a new arm. The visitor interface is the cheap way to make exhaustiveness a build error.
- **Exporting the abstract base class.** Consumers should see the framework-level interface and the discriminated union of concrete classes; the abstract base is an implementation detail.
