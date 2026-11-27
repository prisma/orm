# ADR 152 - Execution Plane Descriptors and Instances

**Status:** Implemented
**Date:** 2025-01-XX
**Authors:** Prisma Next Team
**Domain:** Core, Families, Targets, Adapters, Drivers, Extensions

## Context

The execution plane composes a runtime from independently packaged components (targets, adapters, drivers, extensions). Historically, these pieces existed but the wiring was inconsistent (ad-hoc shapes, unclear entrypoints, and incomplete type-level compatibility).

We need a clear, cross-family pattern that standardizes:

- descriptor identity + declarative metadata
- instance creation and lifecycle expectations
- runtime entrypoints (`./runtime`)

This ADR defines the execution-plane descriptor/instance model, mirroring ADR 151 for the control plane.

## Decision

We standardize on a **descriptor + instance** pattern for execution-plane components:

- **Descriptors** are flat objects (identity + declarative metadata) with a `create()` factory.
- **Instances** are the runtime objects used during execution.
- Everything is parameterized by **familyId** and **targetId** to make mis-wiring a type error.
- Base interfaces live in `@internal/framework-components/execution`; families refine them with family-specific behavior.

This ADR formalizes the model and entrypoints; it is not intended to change runtime behavior.

### Canonical IDs

We treat the following identifiers as canonical literal values (and expose them as literal types):

- **Family IDs**: e.g. `type SqlFamilyId = 'sql'`
- **Target IDs**: e.g. `type PostgresTargetId = 'postgres'`

These IDs appear in contracts and on descriptors/instances and anchor type-level wiring.

### Cross-family descriptor interfaces

We introduce plane-first, cross-family descriptor interfaces in core, under:

- `@internal/framework-components/execution` for execution/runtime-plane descriptors and base instances

Descriptors:

```ts
export interface RuntimeFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends RuntimeFamilyInstance<TFamilyId> = RuntimeFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

export interface RuntimeTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends RuntimeTargetInstance<TFamilyId, TTargetId> = RuntimeTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

export interface RuntimeAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  create(): TAdapterInstance;
}

export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(options: unknown): TDriverInstance;
}

export interface RuntimeExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}
```

Note: runtime-plane descriptors build on `@internal/contract/framework-components` (identity + declarative metadata like `types`, `operations`, and `capabilities`).

Notes:

- Descriptors are flat, immutable objects.
- Adapters/drivers/extensions are target-bound via `targetId`.

### Cross-family instance interfaces

We keep base instance interfaces in core to document the pattern and enable shared tooling. Families extend these base interfaces with richer, family-specific contracts.

Base instances:

```ts
export interface RuntimeFamilyInstance<TFamilyId extends string = string> {
  readonly familyId: TFamilyId;
}

export interface RuntimeTargetInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  // Plane-specific hooks may be added here in future ADRs
}

export interface RuntimeAdapterInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  // Family-specific runtime adapter interfaces extend this
}

export interface RuntimeDriverInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}

export interface RuntimeExtensionInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}
```

Families define richer behavior interfaces (e.g., SQL’s AST lowering adapter and SQL driver execution methods).

### SQL family: static contributions on descriptors

The SQL family extends base execution-plane descriptors with `SqlStaticContributions` — a required interface for descriptor-level static context derivation:

```ts
interface SqlStaticContributions {
  codecs(): ReadonlyArray<CodecDescriptor>
  operationSignatures(): ReadonlyArray<SqlOperationSignature>
}
```

SQL runtime-plane descriptors (`SqlRuntimeTargetDescriptor`, `SqlRuntimeAdapterDescriptor`, `SqlRuntimeExtensionDescriptor`) all implement this interface. This enables `createExecutionContext({ contract, stack })` to build codec registries, operation registries, and type helper registries from descriptor contributions without calling `create()` on any component.

Extension instances are identity-only (`familyId` + `targetId`); contributions (codecs, operations, parameterized codecs) live exclusively on descriptors. This separation ensures that importing query roots (which depend on `ExecutionContext`) does not trigger side effects from adapter or extension instantiation.

Concrete runtime instances are typically intersections of the identity interface with a family-specific behavior interface:

```ts
export type PostgresRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver;
```

Family packages also define richer adapter interfaces, for example:

```ts
export interface SqlRuntimeAdapter<TTarget extends string = string>
  extends RuntimeAdapterInstance<'sql', TTarget> {
  lower(ast: QueryAst, context: LowererContext): LoweredStatement;
  // ... other SQL-specific adapter methods
}
```

## Where the family fits (and why it is not part of the stack)

This is easy to misread if you come in expecting “family creates the runtime”.

### What the stack represents

The execution stack is a *target-bound* bundle of components:

- target descriptor
- adapter descriptor
- optional driver descriptor
- extension-pack descriptors

Instantiating the stack is straightforward: call `create()` on each descriptor to obtain instances.

### Why the family is not included in the stack

We intentionally keep **family** separate from the stack because:

- Every component already carries `familyId` (and target-bound components carry `targetId`), so storing a separate family in the stack would be redundant.
- The stack is about *wiring target-bound components*. “Family” is a broader semantic layer that defines how to interpret and execute plans for a given family (e.g., SQL), and it often exists independently of any one target.
- In current Runtime DX flows, runtime creation is driven by **stack + contract + context**, not by a family instance. Family “instances” may exist, but they are commonly identity-only.

### When a family descriptor is still useful

Some helper APIs accept a `RuntimeFamilyDescriptor` alongside target/adapter/extensions to:

- validate contract requirements against a composition (IDs, required packs)
- anchor family-specific runtime utilities in shared tooling

But the execution stack itself stays target-bound and does not require a family descriptor to be carried around.

### Entry points and exports

Each pack exposes a `./runtime` entrypoint that `export default`s a descriptor implementing the relevant `Runtime*Descriptor` interface (and may export named types for family-specific behavior interfaces).

Descriptors are immutable, side-effect-free objects that can be imported freely. `create()` may return a fresh instance; caching/reuse is a caller concern. Instances may be classes or plain objects.

### Type-level compatibility

We enforce compile-time compatibility across execution-plane wiring:

- Families, targets, adapters, drivers, extensions are parameterized by `TFamilyId` and `TTargetId` literal types
- Runtime assembly uses these generics so mis-wiring is a type error:
  - A Postgres adapter cannot be wired to a Mongo target
  - A SQL extension for `targetId = 'postgres'` cannot be used with a MySQL target
- `familyId` and `targetId` fields are both:
  - Runtime values (used for logging, validation, and metadata)
  - Type-level anchors for TS inference and narrowing

### Scope for first phase

This ADR covers:

- Cross-family interfaces in core for the execution plane (`@internal/framework-components/execution`).
- First implementation pass for SQL + Postgres packs (targets/adapters/drivers/extensions) using the standardized runtime entrypoints.

Non-goals for this ADR:

- Document family and MongoDB target
- MySQL or other SQL targets
- Control-plane descriptors and instances (handled in ADR 151)

## Consequences

### Benefits

- **Consistency**: All execution-plane participants follow the same descriptor + instance pattern
- **Type safety**: Mis-wiring family/target/adapter/driver/extension becomes a compile-time error
- **Clear separation**: Descriptors are pure data + factory; instances own state and behavior
- **Cross-family reuse**: Shared tooling (runtime factories, test harnesses) can rely on a small set of core interfaces
- **Future-proofing**: Adding new targets/families is a matter of implementing descriptors and instances, not inventing new shapes
- **Mirror control plane**: Execution plane pattern mirrors control plane pattern, making the system easier to understand
- **Static context derivation**: SQL descriptors provide codecs, operations, and types statically via `SqlStaticContributions`, enabling side-effect-free query root imports

### Risks and mitigations

- **Refactor surface area**: Touching core and multiple packs risks breakage
  - Mitigation: First phase is limited to the execution plane and the SQL + Postgres stack
  - Tests that exercise runtime execution, plan execution, and streaming provide guardrails
- **Control vs execution drift**: Control and execution planes might diverge over time
  - Mitigation: This ADR mirrors ADR 151's structure and conventions to minimize drift

## References

- [ADR 159 — Driver Terminology and Lifecycle](./ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md) — Extends driver lifecycle: `create(options?)` without connection, `connect(binding)` at boundary
- [ADR 005 - Thin Core Fat Targets](./ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 011 - Unified Plan Model](./ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 124 - Unified Async Iterable Execution Surface](./ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)
- [ADR 125 - Execution Mode Selection & Streaming Semantics](./ADR%20125%20-%20Execution%20Mode%20Selection%20&%20Streaming%20Semantics.md)
- [ADR 151 - Control Plane Descriptors and Instances](./ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md)

