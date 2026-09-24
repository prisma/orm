# ADR 203 — Trait-targeted operation arguments

## Context

Adapters and extensions register query operations (e.g., `ilike`, `cosineDistance`) that attach to fields of a given shape. (Per [ADR 206](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md)'s amendment, a target registers its built-in operations too — `ilike` is contributed by the Postgres target, not its adapter.) Until now an operation declared its `self` argument as a specific `codecId` — `pgvector/vector@1` for `cosineDistance`, for example. The type and runtime machinery then surfaced that operation on every field whose codec matched that ID.

Codec-ID targeting works when an operation is tied to one concrete codec. It breaks down when an operation is defined by a *capability* that multiple codecs share:

- Postgres `ILIKE` applies to any textual column: `pg/text@1`, `pg/varchar@1`, `pg/char@1`, and codecs that future extensions add. Enumerating every textual codec ID in the operation descriptor duplicates knowledge that already lives on the codec itself (each textual codec advertises `traits: ['textual']`) and quietly excludes codecs that are added later.
- The same pattern applies to any future capability-based operator: regex match (`~`, `~*`), `SIMILAR TO`, ordering ops on numerics, boolean logic on booleans.

We need a way for an operation to say *"this argument accepts any codec with these traits"* without naming codec IDs.

## Decision

Extend operation argument specs with an optional `traits` field alongside `codecId`. An argument may target a codec either by identity (`codecId`) or by capability (`traits`), and the type system plus runtime resolve both forms consistently.

- **Type level.** `QueryOperationArgSpec` in the contract admits `{ codecId?: string; traits?: CodecTrait; nullable: boolean }`, where `CodecTrait` is the closed union of declared traits (`'equality' | 'order' | 'boolean' | 'numeric' | 'textual'`).
- **Runtime.** `ParamSpec` gains a parallel `traits: readonly string[]`.
- **Return types remain codec-ID exact.** A separate `ReturnSpec` is split out from the now-optional `ParamSpec.codecId` to preserve that guarantee. Decoding, predicate detection, and result typing all depend on knowing the concrete return codec.

## Grounding example

Operations contributed by a target, adapter or extension declare their arguments as trait-targeted where appropriate. The Postgres target's `ilike` descriptor names no specific textual codec — just the `textual` trait on its self argument:

```typescript
// Postgres target descriptor (runtime shape)
{
  method: 'ilike',
  args: [
    { traits: ['textual'], nullable: false },           // self — any textual codec
    { codecId: 'pg/text@1', nullable: false },          // pattern — exact
  ],
  returns: { codecId: 'pg/bool@1', nullable: false },
  lowering: {
    targetFamily: 'sql',
    template: '{{self}} ILIKE {{arg0}}',
  },
}
```

The contract-level type mirrors this shape with `traits` narrowed to a string literal for type-level matching:

```typescript
readonly ilike: {
  readonly args: readonly [
    { readonly traits: 'textual'; readonly nullable: boolean },
    { readonly codecId: 'pg/text@1'; readonly nullable: false },
  ];
  readonly returns: { readonly codecId: 'pg/bool@1'; readonly nullable: false };
};
```

From this single descriptor, every textual field in the contract gains the operation. A non-textual field does not. A target, adapter or extension that does not register the operation never exposes it, regardless of what codecs are on the target.

## Design principles

1. **Codec identity and codec capability are independent axes.** An operation should be free to target either. Forcing capability-based operations into codec-ID enumerations duplicates what traits already encode on codecs and prevents extensibility.
2. **Traits are a closed union at the type level, an open set at runtime.** `CodecTrait` is a union so type matching stays structural and narrowing works; `ParamSpec.traits` is `readonly string[]` at runtime so registries can carry forward trait values they don't statically know about.
3. **Return targeting stays exact.** Predicate detection and result decoding depend on knowing the concrete return codec. `ReturnSpec` enforces this separately, so loosening `ParamSpec.codecId` to optional does not weaken return-type guarantees.
4. **Registration does the expansion work.** Operation lookup is on the hot path — it happens for every field access on an ORM model accessor. Trait resolution runs once per operation at registration time so field access remains a single map lookup.
5. **Same descriptor, different reachability per contract.** Contracts see different operation sets because their targets, adapters and extensions register different operations — not because core branches on target. This preserves the thin-core discipline from [ADR 005](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md).

## How matching works

### Type-level matching

A field's codec ID is known statically from the contract. For each registered operation, the type system asks whether the operation's self argument matches that field.

If the self argument carries a `codecId`, the match is simple literal equality — unchanged from before.

If the self argument carries `traits`, the type system looks up the field's codec in the contract's codec-types map (introduced by [ADR 030](ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) — each codec declares its trait set at the type level), and checks that every required trait appears in the field's trait set. When both checks fail, the operation simply does not appear on the field's accessor; there is no runtime fallback. This matching logic lives in `OpMatchesField` and is used by `FieldOperations` to derive the operation surface of each scalar field.

The SQL builder's function-style surface (`fns.ilike(f.name, ...)`) needs the inverse direction: given a trait-targeted argument, what column expressions are acceptable? The builder resolves a trait argument to the union of codec IDs in the codec-types map whose trait set contains the required trait, and accepts any `Expression` whose codec ID is in that union. Column expressions therefore typecheck by codec-ID membership, not by structural trait comparison, which keeps expression types simple and unifies trait-targeted and codec-targeted arguments under one `Expression<FieldSpec>` shape.

### Runtime matching

The ORM model accessor builds its operation index once per model. When a registered operation's self argument is codec-ID targeted, the runtime indexes the operation under that codec ID directly. When the self argument is trait-targeted, the runtime walks the codec registry: for every codec whose trait set contains all of the operation's required traits, the operation is indexed under that codec's ID.

Once this expansion is done, field access performs a single lookup keyed on the field's codec ID. Both targeting forms collapse to the same index, and nothing on the hot path needs to know which form was used. The cost of expansion is proportional to (trait-targeted operations) × (codecs) and is paid once per model accessor construction.

## Predicate detection

Codec-ID exactness on the return side enables a useful derivation. Each codec declares a trait set (per [ADR 030](ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)); an operation whose return codec carries the `'boolean'` trait is a predicate. Its natural use is inside a `WHERE` clause, not as a chainable value.

The ORM client surfaces this distinction by returning an `AnyExpression` (composable with `and`/`or`/`not`) for predicate operations, and the usual `ComparisonMethods<...>` wrapper for non-predicate operations. Predicate detection is independent of argument trait-targeting — it applies to any operation whose return codec is boolean-traited — but the two features land together because no prior core operation needed this distinction.

## Interaction with other subsystems

- **Codec registry** ([ADR 030](ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)). Traits are codec metadata, owned by the codec registry. Operation matching reads traits from there; no new source of truth is introduced.
- **Adapter SPI** ([ADR 016](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)). Target, adapter and extension runtime descriptors expose `queryOperations()`; for adapters it sits alongside the existing lowering surface. Contract emission picks up `types.queryOperationTypes` from descriptor meta, and trait-targeted operations flow through the same pipeline as codec-ID operations.
- **Contract extension encoding** ([ADR 105](ADR%20105%20-%20Contract%20extension%20encoding.md)) and [ADR 106](ADR%20106%20-%20Canonicalization%20for%20extensions.md). Trait-targeted argument specs serialize with `traits` as a string at the type level and as a string array at runtime. Canonicalization treats the `traits` field as opaque to the extension owner.
- **Extension compatibility** ([ADR 017](ADR%20017%20-%20Extension%20Compatibility%20Policy.md)). Trait-targeting is additive. Existing codec-ID-targeted operations continue to work without changes.

## Non-goals

- **Trait targeting on return types.** Return codec remains exact. Decoding and predicate detection depend on the concrete codec identity.
- **Trait expressions on the field side.** Fields expose their concrete codec ID. An operation asks *"does this field's codec have these traits?"*; a field never asks the reverse question during matching.
- **A trait algebra.** Traits combine as set containment only — a requirement of two traits means "has both". There is no union, negation, or priority ordering.
- **Migration of built-in comparisons to trait-targeted operations.** Equality and ordering comparisons remain core comparison methods driven by `COMPARISON_METHODS_META`. Trait-targeted operations are for features that adapters and extensions register, not for the core comparison surface.

## Consequences

### Positive

- Target-, adapter- or extension-specific operations that apply to a capability (rather than one codec) can be registered once and automatically attach to every matching codec — including codecs added later by downstream extensions.
- Operations are reachable only on contracts whose target, adapter or extension registered them. Capability-based operators no longer need runtime guards to reject calls on unsupported targets; the operation is absent from the type surface.
- Boolean-returning extension operations are predicates by construction, composable with `and`/`or`/`not` without special-casing per operation.

### Trade-offs

- `ParamSpec.codecId` is now optional. Code that read it as a required string must narrow based on which of `codecId` or `traits` is present. `ReturnSpec` is split out precisely to keep the required-`codecId` guarantee where it matters.
- The contract's operation-argument shape is a discriminated union (`{ codecId, nullable } | { traits, nullable }`). Tools that consume contract JSON must accept both forms.
- Registration-time expansion across the codec registry is paid once per model accessor. The cost is small but not zero; operations that target very common traits expand to many indexed entries.

## Alternatives considered

### Enumerate codec IDs in the operation descriptor

Declare each capability-based operation with an explicit union of codec IDs on its self argument (e.g., `pg/text@1 | pg/varchar@1 | pg/char@1`).

Forces every adapter and extension to maintain an enumeration that duplicates trait metadata already carried by codecs. New codecs added by downstream extensions silently fall outside the operation's reach unless the adapter ships an update. Rejected.

### Resolve operations per-field at lookup time

Skip the registration-time expansion and iterate all operations on every field access, checking codec-ID or trait membership each time.

Simpler registry, slower lookup. The accessor is touched on every ORM query build; the expanded-at-registration approach keeps field access at a single map hit. Rejected on the hot-path argument.

### Trait matching via a separate operation kind

Introduce a sibling `TraitOperationDescriptor` alongside the existing codec-ID form and route trait operations through a parallel pipeline.

Doubles the surface — adapters, runtime registries, and type-level matchers all have to handle two forms. The unified `ParamSpec` with optional `codecId` / `traits` keeps a single path and makes the two forms interchangeable from consumers' perspective. Rejected.

## Open questions

- Whether trait-targeted arguments should support OR-composition of required traits. Today `traits` is a single string at the type level and a conjunction at runtime. A more expressive combinator can be added later without breaking the current shape.
- How the emitter pipeline should validate that every contributor-declared `QueryOperationTypes` entry has a corresponding runtime descriptor registered. The two are wired through descriptor meta but not cross-checked at emission time.

## Decision record

Adopt trait-targeted operation arguments as an additive primitive. Operation specs accept `codecId` (exact) or `traits` (capability) on each argument. Type-level matching resolves traits via the contract's codec-types map; runtime matching expands trait-targeted operations across the codec registry once at registration time. Return types remain codec-ID exact to preserve decoding and predicate-detection guarantees.
