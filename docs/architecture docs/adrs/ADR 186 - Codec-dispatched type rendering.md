# ADR 186 — Codec-dispatched type rendering

> **Retrospective note.** This ADR introduced the `renderOutputType` slot on the codec record (and shows `defineCodec({...})` examples). Both the codec authoring shape and the home of `renderOutputType` have since moved on: [ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) relocated `renderOutputType` to the unified `CodecDescriptor`, and the `defineCodec({...})` factory was retired in favor of class-based descriptors (`CodecDescriptorImpl`) and codecs (`CodecImpl`). The decision this ADR records — that the codec is the dispatch authority for type rendering — is unchanged; only the slot's home and the authoring syntax have moved. See [Codec authoring guide](../../reference/codec-authoring-guide.md).

## At a glance

A `vector(1536)` column should produce `Vector<1536>` as its output type. A `jsonb(schema)` column should produce `{ name: string }`. Today, resolving a field's output type requires dispatching through `CodecTypes[codecId]['output']` or `parameterizedOutput` — a hoop that varies depending on whether the codec is parameterized. After this change, every field's output type is resolved once and stamped into a dedicated map in `contract.d.ts`:

```ts
// contract.d.ts — resolved output types for every field
export type FieldOutputTypes = {
  readonly User: {
    readonly id: number;
    readonly email: string;
    readonly embedding: Vector<1536>;
    readonly payload: { name: string };
  };
};
```

`ComputeColumnJsType` reads from this map. One lookup, every field, no `CodecTypes` dispatch.

The contract's model fields stay truthful — `typeParams` matches the runtime data in `contract.json`:

```ts
// contract.d.ts — model fields (structural metadata, matches contract.json)
readonly User: {
  readonly fields: {
    readonly embedding: {
      readonly nullable: false;
      readonly type: {
        readonly kind: 'scalar';
        readonly codecId: 'pg/vector@1';
        readonly typeParams: { readonly length: 1536 };
      };
    };
    readonly payload: {
      readonly nullable: false;
      readonly type: {
        readonly kind: 'scalar';
        readonly codecId: 'pg/jsonb@1';
        readonly typeParams: { readonly schemaJson: { readonly type: 'object'; ... } };
      };
    };
  };
};
```

Two distinct concepts, two distinct locations:

- **Codec field configuration** (`typeParams` on `ScalarFieldType`, accessed via `field.type.typeParams`) — how the codec is configured for this field. Runtime data, JSON-serializable, same in `contract.json` and `contract.d.ts`.
- **Field output type** (`FieldOutputTypes` map) — what TypeScript type this field produces. Determined by the codec and its configuration.

## Context

Prisma Next has two workflows for creating contracts. The **emit workflow** runs the emitter to generate `contract.d.ts` from contract JSON. The **no-emit workflow** lets the developer construct a contract programmatically in TypeScript, with type-level inference producing the equivalent types without code generation. Both paths must produce correct output types for every field.

Codecs already own three of the four representations of a type:

| Representation | Owner | Method |
|---|---|---|
| Wire format (driver ↔ database) | Codec | `encode` / `decode` |
| Contract JSON (serialized values) | Codec | `encodeJson` / `decodeJson` ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md)) |
| DDL string (migration SQL) | Data type the codec represents | its written texts ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md), which superseded the `expandNativeType` hook of ADR 171) |
| **TypeScript type in contract.d.ts** | **Scattered** | See below |

The fourth representation — the TypeScript output type in `contract.d.ts` — is currently spread across three systems: a `CodecTypes` type map (handles non-parameterized codecs), a `parameterized` renderer map in descriptor metadata (produces type expression strings at emit time), and a `parameterizedOutput` function type on `CodecTypes` (handles the no-emit path). These systems don't share an interface or abstraction.

The problems this causes:

- **Renderers replace the entire field in contract.d.ts.** When a parameterized renderer fires, it emits `readonly payload: AuditPayload` — a raw type expression — instead of preserving the structural `ContractField` shape. Code that expects model fields to have `{ nullable, type: { kind, codecId, typeParams } }` breaks.

- **Renderers are registered in descriptor metadata, not on the codec.** The codec owns every other representation of the type. Type rendering is an outlier.

- **Output type resolution requires knowing whether the codec is parameterized.** Non-parameterized: `CodecTypes[codecId]['output']`. Parameterized: `CodecTypes[codecId]['parameterizedOutput'](typeParams)`. Two different access patterns for the same concept.

- **The SQL emitter overrides `EmissionSpi.generateModelsType?` to inject renderer dispatch.** This override is redundant after TML-2206 (value objects & embedded documents), which ensures model fields carry their own `codecId` and `typeParams` at build time. The override duplicates ~110 lines of the framework's 37-line default and couples the SQL emitter to storage internals.

## Decision

### Field output types live in a dedicated map

The emitter generates a `FieldOutputTypes` map alongside the contract — a record of `ModelName → FieldName → OutputType`:

```ts
// contract.d.ts
export type FieldOutputTypes = {
  readonly User: {
    readonly id: number;
    readonly email: string;
    readonly embedding: Vector<1536>;
    readonly payload: { name: string };
  };
};
```

Every field's output type is resolved once and stamped into this map. `ComputeColumnJsType` reads from it — one access pattern, all fields, parameterized or not.

The no-emit contract builder produces the same map. When you write `.column('embedding', { type: vector(1536) })`, the builder propagates the type-level output type (`Vector<1536>`) from the column descriptor into the map. Both paths produce the same artifact; consumers don't need to know which path created it.

### `typeParams` stays truthful

The `typeParams` on a scalar field (accessed via `field.type.typeParams`) always matches the runtime value in `contract.json`. For Vector: `{ length: 1536 }`. For JSONB with schema: `{ schemaJson: { ... } }`. The emitter never transforms or replaces `typeParams` — it serializes the runtime values as const literals.

This means `ContractModelBase.fields` can be tightened back to `Record<string, ContractField>`. The widening to `Record<string, unknown>` was only needed because renderers replaced the field shape.

### `renderOutputType` on the Codec interface

An optional method produces the TypeScript output type string for a given field configuration:

```ts
interface Codec<...> {
  // ... existing encode, decode, encodeJson, decodeJson ...
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

When absent (or returns `undefined`), the emitter falls back to the codec's default output type — it emits a reference to `CodecTypes[codecId]['output']` in the generated d.ts, which TypeScript resolves to the codec's declared output type. When present, the codec produces the concrete type expression:

- `pg/vector@1`: `renderOutputType({ length: 1536 })` → `'Vector<1536>'`
- `pg/jsonb@1`: `renderOutputType({ schemaJson: { ... } })` → `'{ name: string }'`
- `pg/jsonb@1` (no schema): `renderOutputType({})` → `undefined` (fall back to `JsonValue`)

Non-parameterized codecs don't need to implement it. The common case is zero code.

Here's what the JSONB codec looks like with `renderOutputType`:

```ts
const pgJsonbCodec = defineCodec({
  typeId: 'pg/jsonb@1',
  encode: (value): string => JSON.stringify(value),
  decode: (wire): JsonValue => typeof wire === 'string' ? JSON.parse(wire) : wire,
  renderOutputType(typeParams) {
    const schemaJson = typeParams['schemaJson'];
    if (schemaJson && typeof schemaJson === 'object') {
      return renderTypeFromJsonSchema(schemaJson);
    }
    return undefined;
  },
});
```

### `parameterizedOutput` on `CodecTypes` is removed

With `FieldOutputTypes` produced by both emit and no-emit paths, there's no need for type-level output type computation via `parameterizedOutput`. The map is the resolved output. This eliminates the entire `parameterizedOutput` / `ExtractParameterizedCodecOutputType` infrastructure.

### Structural field shape is always preserved

The emitter always emits model fields with the full `ContractField` structure. The output type lives in the separate map, not on the field. The renderer never replaces the entire field.

### `EmissionSpi.generateModelsType?` override is removed

This is a hard constraint. After TML-2206, model fields are self-contained — they carry resolved `codecId` and `typeParams` at build time, and `generateFieldResolvedType` already handles all three field kinds (scalar, value object, union) with modifier application. The SQL emitter's override is deleted. The framework emitter handles all families (SQL, Mongo) and all field contexts (model fields, value object fields, union members).

### The framework emitter owns rendering dispatch

The framework emitter's existing `generateFieldResolvedType` (introduced in TML-2206) already handles all three field kinds — scalar, value object, union — and applies `many`/`dict`/`nullable` modifiers. This function is extended with codec dispatch for scalar fields:

1. For scalar fields, reads `field.type.typeParams` and `field.type.codecId`
2. Looks up the codec via `CodecLookup` (added to the emission pipeline)
3. Calls `codec.renderOutputType(typeParams)` if present; otherwise emits a reference to `CodecTypes[codecId]['output']`
4. Value object and union fields pass through unchanged
5. Stamps the result into the `FieldOutputTypes` map
6. Serializes `typeParams` truthfully as const literals on the field

This lives in `@internal/emitter` (tooling layer), dispatching to codecs via `CodecLookup` from the core layer. The legacy renderer infrastructure — `TypeRenderer`, normalization pipeline, `parameterizedRenderers` threading through the control stack, and `parameterized` maps in descriptor metadata — is deleted.

## Consequences

### Benefits

- **Single owner per representation.** Codecs own all four type representations (wire, JSON, DDL, TypeScript). Finding how a codec's type is rendered means looking at the codec.

- **Uniform output type access.** `FieldOutputTypes[ModelName][FieldName]` — one lookup, every field, no dispatch through `CodecTypes`. Parameterized and non-parameterized codecs have the same access pattern.

- **Truthful contract fields.** `typeParams` in `contract.d.ts` matches `contract.json`. No phantom types, no type lies, no divergence between type-level and runtime values.

- **Structural fields preserved.** Model fields in `contract.d.ts` always conform to `ContractField`. Downstream tooling can rely on a uniform structure.

- **Family-agnostic emission.** The framework emitter handles all families without overrides. New families get output type resolution for free.

- **Simpler infrastructure.** `TypeRenderer` (four shapes), normalization pipeline, descriptor metadata threading, `EmissionSpi` override, `parameterizedOutput`, and `ExtractParameterizedCodecOutputType` are all replaced by one optional method on the codec and one type map.

### Costs

- **`CodecLookup` flows into the emitter.** The emission pipeline gains a dependency on codec instances (not just codec IDs). The control stack already assembles descriptors; assembling a codec lookup is a small addition.

- **JSON Schema rendering stays complex.** Converting a JSON Schema payload to a TypeScript type expression is inherently non-trivial. This ADR moves *where* that logic lives (from descriptor metadata to the codec) but does not simplify the logic itself.

- **`FieldOutputTypes` is a new type artifact.** Both the emitter and the no-emit contract builder must produce it. The emitter already generates per-field type information; this formalizes it into a map. The no-emit builder already propagates type-level information from column descriptors; this collects it into a map.

## Alternatives considered

### Keep renderers, move them onto the codec

Put the full `TypeRenderer` (string-producing function) on the codec instead of in descriptor metadata.

Rejected because the renderer replaces the entire field shape, which is the root problem. Moving the same function to a different location doesn't fix the structural issue.

### Transform `typeParams` in the d.ts (no output type map)

Have the codec transform runtime `typeParams` into type-level-friendly values via `emitTypeParams`, then use `parameterizedOutput` on `CodecTypes` to resolve the output type from the transformed values.

Rejected because it conflates two distinct concepts — codec field configuration and field output type — into a single field. For JSON Schema, the d.ts `typeParams` would contain a TypeScript type expression that doesn't exist at runtime, making the field a type lie. A separate map keeps both concepts truthful.

### Emit resolved types directly (no `parameterizedOutput`, no map)

Have the codec produce the output type string, stamp it directly onto the field as a phantom property or inline type annotation.

Rejected because phantom types are gross, and mixing type-only metadata into the structural contract creates confusion about what matches runtime values and what doesn't. A separate map is honest about the boundary.

### Make `renderOutputType` required with a default

Like `encodeJson`/`decodeJson` on [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), make it required with a default provided by the `defineCodec()` factory.

Deferred. Most codecs don't parameterize their output type — the default (`CodecTypes[codecId]['output']`) handles them. Optional with a well-defined fallback is cleaner for now.

## Supersedes

- **`parameterized` renderer infrastructure** in descriptor metadata — replaced by `renderOutputType` on the codec.
- **`parameterizedOutput` on `CodecTypes`** — replaced by the `FieldOutputTypes` map.
- **`EmissionSpi.generateModelsType?` override pattern** — replaced by framework-level field rendering with codec dispatch.

## Resolves

- **ADR 185 open concern: `EmissionSpi` complexity.** The `generateModelsType?` override on `EmissionSpi` — the primary source of SPI complexity in the SQL emitter — is removed.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md) — established the pattern of codecs owning their representations
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md) — established `typeParams` on storage columns
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md) — introduced typed JSON columns with Standard Schema
- [ADR 185 — SPI types live at the lowest consuming layer](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md) — `EmissionSpi` placement and design
