# ADR 207 — Family-instance capability views for the framework CLI

## Context

The framework CLI under `packages/1-framework/3-tooling/cli/` reads configuration, dispatches to the `ControlClient`, and renders results. It is meant to be **family-agnostic**: it should not import family-specific types, branch on `familyId`, or carry knowledge of any particular target's IR shapes.

Two distinct kinds of feature live on family instances:

- Mandatory features every supported family must expose (introspection, validate-contract, marker read/write, schema verification, signing). These are part of the base `ControlFamilyInstance<TFamilyId, TSchemaIR>` interface.
- **Optional features** that some families implement and others don't, surfaced to specific CLI commands or subsystems. Examples that have accumulated in the framework so far:
  - **Schema view rendering** (`db schema` consumes a tree representation of the introspected schema). SQL and Mongo families implement it; a family without a sensible tree representation could legitimately omit it.
  - **PSL contract inference** (`prisma-next contract infer` writes a PSL file derived from a live database). Only SQL families implement it. Mongo could not implement it without a PSL-for-document model and there is no plan to provide one.
  - **Operation preview** (`prisma-next migration plan / show / db update / db init` in plan mode print a human-readable preview of the migration operations). Both SQL and Mongo implement it; a future family that has no useful textual rendering of its migration operations could omit it.

When these capabilities first appeared, the only one in place was schema-view rendering, and the framework CLI handled it via a `familyId === 'sql'` branch in `inspect-live-schema.ts` plus a SQL-specific `validatePrintableSqlSchemaIR` import. As MongoDB support landed and additional optional capabilities accumulated, the branches and SQL-specific imports multiplied. The dispatch surface in `cli/src/control-api/operations/extract-operation-statements.ts` was a switch on `familyId`. Migration result types carried a `sql?: readonly string[]` field whose name embedded a family.

The base `ControlFamilyInstance` interface cannot grow each new optional feature: that would force every family to implement everything, which is incompatible with their varying levels of fit, and which makes the interface a moving target every time a new tooling surface lands.

## Decision

Optional family-instance features are exposed via **capability-gated views**, following a uniform five-step structure. Each capability is independent; families opt in by implementing the capability interface, and the framework discovers participation via a runtime predicate.

The five-step structure:

1. **View type** — a family-agnostic shape that lives in a framework-domain package (e.g. `framework-components`) and has no knowledge of any specific family. Examples: `CoreSchemaView` (`@internal/framework-components/control`), `OperationPreview` (same), `PslDocumentAst` (`@internal/framework-components/psl-ast`).
2. **Capability interface** — declares the method that produces the view from the family's opaque schema IR or operation list. Lives in `framework-components/src/control-capabilities.ts` alongside other capability declarations. Generic over `TSchemaIR` when the input is the family's IR.
3. **Type predicate** — a runtime guard `hasFooCapable(instance): instance is ControlFamilyInstance<...> & FooCapable` that the framework uses to detect participation. Always defined alongside the capability and exported from the same module.
4. **Family implementation** — each family that opts in implements the capability on its `ControlFamilyInstance` (concretely: extends the family-instance interface and provides the method on the factory's return value). Families that do not opt in simply do not implement the method.
5. **Client delegation** — `ControlClient` exposes a method that runs the predicate against the resolved family instance and returns the view, or `undefined` when the family does not implement the capability. This insulates command code from the predicate and keeps capability dispatch consistent across commands.

Commands that need a capability gate on `client.toFooView(...)` returning `undefined`. When the view is present, the command renders or consumes it. When it is absent, the command emits a structured error whose wording references the missing capability, not the family identifier.

```ts
// framework-components/src/control-capabilities.ts
export interface FooCapable<TSchemaIR = unknown> {
  toFooView(input: TSchemaIR): FooView;
}

export function hasFooCapable<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & FooCapable<TSchemaIR> {
  return (
    'toFooView' in instance &&
    typeof (instance as Record<string, unknown>)['toFooView'] === 'function'
  );
}

// cli/src/control-api/client.ts (ControlClient)
toFooView(input: unknown): FooView | undefined {
  this.init();
  if (this.familyInstance && hasFooCapable(this.familyInstance)) {
    return this.familyInstance.toFooView(input);
  }
  return undefined;
}

// cli/src/commands/uses-foo.ts — each capability command registers its own
// domain `*_UNSUPPORTED` code; the shipped exemplar is `CONTRACT.INFER_UNSUPPORTED`
// in contract-infer.ts.
const view = client.toFooView(schema);
if (!view) {
  return notOk(errorRuntime('CONTRACT.INFER_UNSUPPORTED', 'contract infer is not supported for this family', {
    why: 'The configured family does not implement the PslContractInferCapable capability.',
    fix: 'Use a family that supports contract inference (e.g. SQL/Postgres).',
  }));
}
```

## Design principles

1. **The base interface stays minimal.** Every family must implement introspection, marker read/write, validate-contract, schema verification, and signing. Anything beyond that — schema view, PSL inference, operation preview, future view types — is opted into via a capability and is not part of the base contract.
2. **Capabilities are independent.** Implementing one does not commit a family to implementing another. A family may implement zero, one, or many. The framework discovers participation per capability.
3. **The predicate is the discovery mechanism.** The framework does not maintain a registry of which families implement which capability. It asks the family instance directly (via `hasFooCapable`) at the moment it needs the view, and falls back gracefully when absent.
4. **Capability error wording references the capability, not the family.** Users see "the configured family does not support this", not "family X is not supported"; the latter conflates the cause (missing capability) with a particular family identifier and dates poorly when a capability gains a second or third implementer.
5. **`ControlClient` is the single dispatch point.** Commands do not call `hasFooCapable` directly; they call `client.toFooView(...)`. This keeps the discovery logic centralised, gives a uniform `undefined`-return contract for absent capabilities, and means a future change to how capabilities are detected (e.g. moving from runtime predicates to declared capability registration) only touches the client.
6. **View types do not encode family identity.** `OperationPreview.statements[].language` is `'sql'` or `'mongodb-shell'`, but those identifiers describe the dialect of the rendered text, not the family that produced it. A future family producing both flavours (theoretical, but allowed) faces no obstacle.

## Consequences

**Predictable extension path.** Adding a new optional feature is a five-step change with a known shape. New views ship behind new capabilities; the framework does not need to know what the families plan to add next. Adding a feature to a family that didn't have it is purely additive (extend the family-instance interface, add the method, add the client delegation) — no other family is touched.

**Layer-clean.** All view types live in framework-domain packages. Family packages depend on framework but not on each other. The CLI depends on framework only. Cross-domain imports remain unidirectional.

**`familyId` strings stay out of the framework CLI.** No command branches on family. All dispatch is capability-gated. Adding a third or fourth family does not require any change in the CLI other than verifying that the family implements the capabilities the CLI's commands depend on.

**Cost of indirection.** Every command surface that gates on a capability pays one predicate call and one delegating method call per invocation. Both are constant-time and cheap. The cost is well below the I/O the surrounding command performs.

**Test-fixture cost on rename.** Mock family instances used in CLI tests must add stub methods for capabilities the production family implements, or the predicate returns false and the dispatch silently falls back to undefined. This is a real friction point during refactors that introduce new capabilities; the alternative (faking via `as` casts) is worse because it bypasses the predicate.

## Pattern adoption status

Three capabilities live on this pattern at the time of writing:

| Capability                  | Module                                     | Implementing families | Consumer command(s)                                       |
|-----------------------------|--------------------------------------------|-----------------------|-----------------------------------------------------------|
| `SchemaViewCapable`         | `framework-components/control-capabilities` | SQL, Mongo            | `db schema` (renders tree from `CoreSchemaView`)          |
| `PslContractInferCapable`   | `framework-components/control-capabilities` | SQL                   | `contract infer` (writes `.prisma` from `PslDocumentAst`) |
| `OperationPreviewCapable`   | `framework-components/control-capabilities` | SQL, Mongo            | `migration plan`/`show`, `db init`/`update` (plan mode)   |

Each follows the five-step structure verbatim. New capabilities should follow the same template; deviations should be motivated and recorded.

## Worked example — adding a hypothetical "schema diagram" capability

A future view that renders the introspected schema as a Mermaid diagram for `db schema --diagram`:

```ts
// framework-components/src/control-schema-diagram.ts
export interface SchemaDiagram { readonly mermaid: string; }

// framework-components/src/control-capabilities.ts
export interface SchemaDiagramCapable<TSchemaIR = unknown> {
  toSchemaDiagram(schema: TSchemaIR): SchemaDiagram;
}
export function hasSchemaDiagram<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & SchemaDiagramCapable<TSchemaIR> {
  return (
    'toSchemaDiagram' in instance &&
    typeof (instance as Record<string, unknown>)['toSchemaDiagram'] === 'function'
  );
}

// 2-sql-family/9-family/.../control-instance.ts
class SqlControlFamilyInstance implements ..., SchemaDiagramCapable<SqlSchemaIR> {
  toSchemaDiagram(schema: SqlSchemaIR): SchemaDiagram { /* mermaid from tables + FKs */ }
}

// cli/src/control-api/client.ts
toSchemaDiagram(schema: unknown): SchemaDiagram | undefined {
  this.init();
  if (this.familyInstance && hasSchemaDiagram(this.familyInstance)) {
    return this.familyInstance.toSchemaDiagram(schema);
  }
  return undefined;
}

// cli/src/commands/db-schema.ts
if (flags.diagram) {
  const diagram = client.toSchemaDiagram(value.schema);
  // A new capability registers a new domain code (like `CONTRACT.INFER_UNSUPPORTED`)
  // in the error reference before shipping.
  if (!diagram) return notOk(errorRuntime('CONTRACT.SCHEMA_DIAGRAM_UNSUPPORTED', '--diagram is not supported for this family', { ... }));
  ui.output(diagram.mermaid);
  return;
}
```

Total touchpoints: one new file in `framework-components`, the capability declaration in `control-capabilities.ts`, the export, the family-side method, the client method. No other family is touched; no `familyId` strings are introduced; the CLI command falls back to a structured error when a family hasn't opted in.

## Status

Accepted. Pattern is in active use across three capabilities on `main`.
