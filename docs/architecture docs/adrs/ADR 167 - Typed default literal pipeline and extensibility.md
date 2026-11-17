# ADR 167 — Typed default literal pipeline and extensibility

> **Superseded by [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md).** ADR 184 generalizes the deferred v2 design from this ADR: codecs own all value representations (contract JSON, DDL, PSL), eliminating the hardcoded bigint/Date branches and the tagged type system. This ADR remains as historical context for the v1 design.

> **Note (2026-09-22).** The `dbgenerated("...")` stopgap this ADR accepted for raw SQL defaults is removed. A raw SQL column default is written as the tagged literal of [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md), `` @default(sql`<expression>`) `` in PSL and `` .default(sql`<expression>`) `` in TypeScript, and lowers to the same `{ kind: 'function', expression }` contract shape. A typed literal default is checked and converted through data types and casts per [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md), which replaced the PSL half of ADR 184.

## Context
PR #167 introduced strictly-typed literal defaults for SQL columns, replacing opaque `expression` strings with typed `value` payloads. The pipeline now encodes, serializes, validates, verifies, and renders literal defaults as typed values end-to-end.

This ADR documents the current design, its JSON-first limitation, and outlines what would be needed for future extensibility.

## Current design

### Pipeline stages

A typed literal default flows through five stages:

```
Authoring → Emission → Validation → Schema Verification → Migration Rendering
```

1. **Authoring** (`encodeDefaultLiteralValue` in `contract-builder.ts`):
   - `bigint` → `{ $type: 'bigint', value: '<decimal-string>' }`
   - `Date` → ISO 8601 string
   - JSON objects with a `$type` key → `{ $type: 'raw', value: <original> }` (collision guard)
   - All other JSON-safe values pass through unchanged

2. **Emission** (`contract.json`):
   - Literal defaults are stored as `{ kind: 'literal', value: <encoded> }`
   - `bigintJsonReplacer` ensures runtime `BigInt` values serialize deterministically in canonicalization

3. **Validation** (`decodeContractDefaults` in `validate.ts`):
   - Tagged bigint on bigint-like columns → runtime `BigInt(value)`
   - `{ $type: 'raw', value }` → unwrapped to plain JSON
   - Temporal/date-like ISO strings remain strings (no `Date` coercion)
   - All other values unchanged

4. **Schema verification** (`verify-sql-schema.ts`):
   - Target-specific normalizer (e.g., `parsePostgresDefault`) parses raw DB defaults into `ColumnDefault` shape
   - `normalizeLiteralValue` canonicalizes both sides for comparison
   - `literalValuesEqual` uses `stableStringify` (sorted keys) for JSON object comparison

5. **Migration rendering** (`renderDefaultLiteral` in `planner.ts`):
   - String → `'escaped'`
   - Number/boolean → literal
   - `null` → `NULL`
   - Tagged bigint (non-JSON columns) → numeric literal
   - JSON/JSONB columns → `'json'::jsonb` with cast
   - `Date` → `'ISO-string'`

### Tagged type system

The contract uses a lightweight tag protocol for values that cannot be natively represented in JSON:

| Tag | Serialized form | Decoded form | Gated by |
|-----|----------------|--------------|----------|
| `bigint` | `{ $type: 'bigint', value: '<decimal>' }` | `BigInt(value)` | `isBigIntColumn` (nativeType/codecId) |
| `raw` | `{ $type: 'raw', value: <original> }` | `<original>` (unwrapped) | Always unwrapped |

The `raw` tag is a collision guard: any user-supplied JSON object whose keys include `$type` is wrapped at encoding time, preventing ambiguity with actual tagged types. This makes tag introduction backward-compatible.

## Limitation: JSON-first with hard-coded special cases

The current pipeline is **JSON-first**: literal defaults must be JSON-safe values, plus two hard-coded special cases (`bigint` and `Date`). Each special case requires awareness across multiple layers:

- **Shared types**: `TaggedBigInt`, `isTaggedBigInt`, `TaggedRaw`, `isTaggedRaw`
- **Authoring encode**: bigint → tagged object, Date → ISO string
- **Validation decode**: tagged bigint → `BigInt()` (gated by column type)
- **Schema verification**: `normalizeLiteralValue` bigint/temporal normalization
- **Migration rendering**: `renderDefaultLiteral` bigint/Date/JSON branches
- **Canonicalization**: `bigintJsonReplacer` for deterministic hashing

This is manageable for two special cases but does not scale to arbitrary extension types. Every new tagged type would require changes across all five stages.

### Extension types today

Extension types like pgvector work today only because their runtime representation (`number[]`) happens to be JSON-serializable. This is a proof-of-concept convenience with known limitations:

- JSON cannot represent `NaN`, `Infinity`, or precision beyond IEEE 754 doubles
- The encoding is not semantically typed — a `number[]` default is indistinguishable from a plain JSON array in the contract

## Future extensibility outline

To support arbitrary extension-defined default literals without core changes for each new type, the pipeline would need:

### 1. Codec-keyed default literal SPI

Extension packs would register default-literal handlers keyed by `codecId`:

```ts
interface DefaultLiteralCodec<T> {
  /** Encode a runtime value to a JSON-safe contract representation */
  encode(value: T): JsonValue | TaggedLiteralValue;
  /** Decode a contract representation back to a runtime value */
  decode(value: JsonValue | TaggedLiteralValue): T;
  /** Render a runtime value to target-specific DDL */
  render(value: T, context: RenderContext): string;
  /** Normalize a raw DB default string to a runtime value (for schema verification) */
  normalize?(rawDefault: string): T | undefined;
}
```

### 2. Namespaced tags in contract JSON

Extension-defined tags would use a namespaced `$type` to avoid collisions:

```jsonc
// Core tag (short name)
{ "$type": "bigint", "value": "42" }
// Extension tag (namespaced)
{ "$type": "pgvector/vector", "value": [1.0, 2.0, 3.0] }
```

The `raw` collision guard already ensures existing JSON defaults with `$type` keys are escaped.

### 3. Registration at assembly time

Extension packs already register codecs and operations at assembly time. Default-literal codecs would follow the same pattern:

```ts
const pgvectorPack = defineExtensionPack({
  codecs: { /* ... */ },
  defaultLiteralCodecs: {
    'pgvector/vector@1': vectorDefaultCodec,
  },
});
```

### 4. Consolidated bigint-like detection

The current `isBigIntColumn` heuristic (string-matching on `codecId`/`nativeType`) would be replaced by codec metadata:

```ts
interface CodecDescriptor {
  // ... existing fields
  defaultLiteralCodec?: DefaultLiteralCodec<unknown>;
}
```

This eliminates the cross-cutting "BigInt awareness" that currently spreads across shared types, validation, schema verification, and rendering.

## PSL parity implications

- **TS authoring** can accept JS runtime values (including `bigint`/`Date`) and encode them into the contract JSON representation via `encodeDefaultLiteralValue`.
- **PSL authoring** cannot reuse JS values. It will need to map PSL syntax/AST into the same `ColumnDefault` shapes and canonical JSON encodings.
- The **existing escape hatch** — `{ kind: 'function', expression: string }` — flows through migration planning as raw SQL (`DEFAULT ${expression}`). This is the natural PSL default representation in the near term and likely the MVP parity mechanism.
- Typed literal defaults in PSL can be layered in where PSL can express them unambiguously (string/number/boolean literals). Extension-specific literals would likely require the `dbgenerated(...)` / function expression escape hatch until the codec-keyed SPI is built.

## Decision

1. The current JSON-first pipeline with hard-coded `bigint` and `Date` handling is accepted as the v1 design.
2. The `raw` tag collision guard ensures future tag additions are backward-compatible.
3. Temporal/date-like defaults remain as ISO strings in the validated contract (no `Date` coercion) to avoid JS Date timezone pitfalls.
4. Extension types that are JSON-serializable (e.g., pgvector `number[]`) work today without changes.
5. A codec-keyed default-literal SPI (outlined above) is deferred until a second non-JSON-safe extension type requires it.

## Consequences

### Positive

- Typed defaults work end-to-end for all JSON-safe values plus bigint.
- The `raw` tag makes future tag additions non-breaking.
- Temporal defaults as strings avoid the well-known JS Date/timezone issues.
- The extension SPI outline provides a clear path for future work without requiring core changes per type.

### Negative

- Each new non-JSON-safe type currently requires awareness across five pipeline stages.
- pgvector defaults work by accident (JSON-safe `number[]`), not by design.
- PSL parity for typed literals is deferred; PSL defaults will initially use `dbgenerated(...)`.

## Scope

**v1 (current):**
- JSON-first literal defaults with hard-coded bigint/Date handling.
- `raw` tag collision guard for forward-compatible tag evolution.
- Temporal defaults as ISO strings (no Date coercion).

**v2 (deferred):**
- Codec-keyed `DefaultLiteralCodec` SPI for extension-defined types.
- Namespaced `$type` tags for extension literals.
- Consolidated bigint-like detection via codec metadata.
- PSL syntax for typed literal defaults.
