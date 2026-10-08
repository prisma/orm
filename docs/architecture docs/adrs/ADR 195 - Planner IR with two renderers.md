# ADR 195 — Planner IR with two renderers (OpFactoryCall pattern)

> **Note (2026-10-07).** A MongoDB validator change and a change-stream image setting are now classed `widening` whatever they change, because neither removes a document; the planner no longer runs `classifyValidatorUpdate`. The planner still chooses the class where it depends on the origin: a Postgres type change is `widening` when it keeps every value and `destructive` otherwise, so `AlterColumnTypeCall` carries a computed `operationClass` too.

## At a glance

The planner diffs two contracts and determines that a unique ascending index on `users.email` needs to be created. Rather than directly constructing the full operation ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)), it produces an IR node:

```ts
const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true });
```

Two renderers interpret this node.

The **operation renderer** calls the `createIndex` factory function and produces a `MongoMigrationPlanOperation` — precheck, execute, postcheck — ready to serialize to `ops.json` and be executed by the runner:

```ts
renderOps([call]);
// → [{ id: 'index.users.create(email:1)', operationClass: 'additive',
//      precheck: [...], execute: [...], postcheck: [...] }]
```

The **TypeScript renderer** produces a line of source code that calls the same factory:

```ts
renderCallsToTypeScript([call], meta);
// → ...
//   createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })
//   ...
```

Both outputs derive from the same `CreateIndexCall` instance. The factory function that backs both paths is the same `createIndex` from `migration-factories.ts` — one is called at plan time, the other is rendered as a call site the developer can edit.

## Decision

The planner produces an intermediate representation — `OpFactoryCall[]` — instead of constructing operations directly. Two renderers consume the IR: one materializes runnable operations, the other emits TypeScript source. The IR is a discriminated union of frozen AST classes with a visitor interface for exhaustive dispatch.

This pattern is **target-agnostic**. Mongo is the first implementation, but the same structure — planner → factory-call IR → operation renderer + TypeScript renderer — applies to any target. A Postgres planner could produce `SqlOpFactoryCall[]` with its own factories and renderers.

## The IR

`OpFactoryCall` is a union of five frozen classes, one per factory function:

```ts
abstract class OpFactoryCallNode {
  abstract readonly factory: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract accept<R>(visitor: OpFactoryCallVisitor<R>): R;
}

class CreateIndexCall extends OpFactoryCallNode {
  readonly factory = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  // collection, keys, options — matches the createIndex factory signature
}
class DropIndexCall    extends OpFactoryCallNode { readonly factory = 'dropIndex' as const;    /* ... */ }
class CreateCollectionCall extends OpFactoryCallNode { readonly factory = 'createCollection' as const; /* ... */ }
class DropCollectionCall   extends OpFactoryCallNode { readonly factory = 'dropCollection' as const;   /* ... */ }
class CollModCall          extends OpFactoryCallNode { readonly factory = 'collMod' as const;          /* ... */ }

type OpFactoryCall = CreateIndexCall | DropIndexCall | CreateCollectionCall | DropCollectionCall | CollModCall;
```

Each class carries the factory name as a literal-typed `factory` discriminant, the factory's arguments as readonly fields, and planner-derived metadata (`operationClass`, `label`). Instances are frozen at construction. The `OpFactoryCallVisitor<R>` interface provides compile-time exhaustiveness: adding a sixth variant forces every dispatch site to handle it.

### Why planner-derived semantics ride on the IR

`operationClass` and `label` are not syntactic properties of the factory call — they're semantic classifications that only the planner can make. Consider `CollModCall`: the same `collMod` factory call might be `'widening'` (relaxing a validator) or `'destructive'` (tightening one). The planner knows because it runs `classifyValidatorUpdate` over the origin and destination validators. No other site has that context.

Storing the classification on the call keeps each node self-describing. `renderOps` reads `call.operationClass` without re-deriving — it stays purely structural, mapping call arguments to factory invocations. The alternative would be threading origin-validator context through the rendering pipeline to a component that otherwise only needs argument values.

For most variants the classification is constant (`CreateIndexCall` is always `'additive'`, `DropCollectionCall` is always `'destructive'`). Only `CollModCall` carries a computed `operationClass` via an optional `meta` parameter.

## Two renderers

### Operation renderer (`renderOps`)

A visitor that calls the factory functions with the arguments from each IR node:

```ts
const renderVisitor: OpFactoryCallVisitor<MongoMigrationPlanOperation> = {
  createIndex(call) {
    return createIndex(call.collection, call.keys, call.options);
  },
  dropIndex(call) {
    return dropIndex(call.collection, call.keys);
  },
  // ... one case per variant
};

function renderOps(calls: ReadonlyArray<OpFactoryCall>): MongoMigrationPlanOperation[] {
  return calls.map((call) => call.accept(renderVisitor));
}
```

The result is an array of `MongoMigrationPlanOperation` — the same three-phase envelopes from [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md), serializable to `ops.json`.

### TypeScript renderer (`renderCallsToTypeScript`)

A visitor that emits the source text of each factory call:

```ts
const renderCallVisitor: OpFactoryCallVisitor<string> = {
  createIndex(call) {
    return `createIndex(${renderLiteral(call.collection)}, ${renderLiteral(call.keys)}, ${renderLiteral(call.options)})`;
  },
  // ...
};
```

The outer function wraps the rendered calls in a complete `migration.ts` file: shebang, imports from `@internal/family-mongo/migration` and `@internal/target-mongo/migration`, a `Migration` subclass with `describe()` and `operations`, and `Migration.run(import.meta.url, M)`. The result is a runnable file the developer can edit, then execute to emit `ops.json` ([ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)).

### Wiring

`PlannerProducedMongoMigration` holds the `OpFactoryCall[]` and wires both renderers:

- `operations` (the `Migration` contract) delegates to `renderOps(this.calls)`.
- `renderTypeScript()` delegates to `renderCallsToTypeScript(this.calls, meta)`, implementing the `MigrationPlanWithAuthoringSurface` interface so the CLI can uniformly ask any planner result for its TypeScript source.

### Why rendering is external to the IR nodes

TypeScript rendering is compositional: `renderCallsToTypeScript` doesn't just render individual call expressions — it wraps them in a complete file (shebang, imports, `Migration` subclass skeleton, `Migration.run(...)`). That file structure depends on the *collection* of calls and the migration metadata, context no individual node has. Each node could own a `renderExpression(): string` method for just its call site, but the outer composition step would remain, so the split would add surface area without eliminating anything. Keeping all rendering in the visitor also means the IR stays a pure data description of "which factory, which arguments" — rendering opinions stay in the renderer, which is target-specific.

## Factory alignment

Factory function signatures in `migration-factories.ts` are aligned 1:1 with `OpFactoryCall` argument shapes. `CreateIndexCall` carries `(collection, keys, options?)` — exactly the parameters of `createIndex(collection, keys, options?)`. Factories are "dumb": they take arguments and produce a `MongoMigrationPlanOperation` directly, assembling DDL commands, inspection commands, and filter expressions. They do not produce another IR.

This alignment is what makes the TypeScript renderer possible. The rendered source code calls the same functions with the same argument shapes, so a user reading or editing `migration.ts` is working with the same API that the planner uses internally.

## References

- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md): the three-phase envelope that `renderOps` produces.
- [ADR 191 — Generic three-phase migration operation envelope](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md): the framework generic that both SQL and Mongo operations implement.
- [ADR 192 — ops.json is the migration contract](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md): `renderTypeScript` produces the authoring surface that emits `ops.json`; `renderOps` produces the operations that serialize to `ops.json` directly.

## Alternatives considered

### Planner constructs operations directly, TypeScript renderer reverse-engineers them

The planner could produce `MongoMigrationPlanOperation[]` as before, and a separate renderer could inspect the DDL commands inside each operation to generate TypeScript. This avoids introducing an IR, but:

- **Lossy.** The operation envelope does not carry the factory name or argument boundaries. A `CreateIndexCommand` inside an execute step could have been produced by `createIndex(...)` or by hand-assembled code. The renderer would have to pattern-match on command types and reconstruct arguments — fragile, incomplete, and impossible for `collMod` where the same command serves multiple factory signatures.
- **Couples rendering to operation internals.** The renderer must understand the structure of prechecks, postchecks, and commands — the exact details that factories encapsulate.

### Plain data objects instead of frozen classes

`OpFactoryCall` could be a plain discriminated union (`{ factory: 'createIndex'; collection: string; ... }`) rather than a class hierarchy with a visitor. Plain data is simpler and serializes naturally. We chose classes because:

- **Exhaustiveness.** The visitor interface forces every dispatch site to handle every variant at compile time. With plain data and `switch`, a missing case is a runtime error unless the developer remembers to enable `noUncheckedIndexedAccess` or a lint rule. Since dispatch sites are spread across modules (`renderOps`, `renderCallsToTypeScript`, planner label derivation), compile-time enforcement is worth the ceremony.
- **Consistency.** The codebase's DDL commands, inspection commands, and filter expressions already use the same frozen-class/visitor pattern. Using it here keeps the AST layer uniform.

### Separate metadata type alongside the call

Instead of `operationClass` and `label` living on each `OpFactoryCall` instance, they could live in a parallel structure — e.g., `{ call: OpFactoryCall; operationClass: MigrationOperationClass; label: string }[]`. This keeps the IR purely syntactic. We chose to embed them because:

- **Simplicity.** One array, one type, one visitor — no zipping, no alignment bugs.
- **Self-describing nodes.** Each call carries everything the renderers need. `renderOps` reads `call.operationClass`; `renderCallsToTypeScript` reads `call.meta`. No second lookup.
- **The impurity is small.** Only `CollModCall` has a computed `operationClass`. The other four variants bake it as a literal constant, indistinguishable from a syntactic property.
