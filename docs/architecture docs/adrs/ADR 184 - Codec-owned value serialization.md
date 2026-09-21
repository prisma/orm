# ADR 184 — Codec-owned value serialization

> **Retrospective note.** This ADR's examples use the `defineCodec({...})` factory. That factory was the canonical codec-author surface at the time; it was later retired in favor of class-based authoring: concrete codecs extend `CodecImpl`, descriptors extend `CodecDescriptorImpl`, and per-codec column helpers tie helpers to descriptors with `satisfies`. The ADR's *decision* — that codecs own both wire and JSON-safe representations through `encode` / `decode` + `encodeJson` / `decodeJson` — is unchanged; only the authoring shape has moved on. See [ADR 208 — Higher-order codecs for parameterized types](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) and the [Codec authoring guide](../../reference/codec-authoring-guide.md) for the current shape.

> **PSL half: see [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md).** The `PslLiteralCodec` interface sketched below is replaced there: codec descriptors name the literal types they are compatible with, codecs gain no methods, and codecs never receive PSL syntax. The JSON half of this ADR is unaffected.

## At a glance

A column with `codecId: "pg/timestamptz@1"` has a default value of `new Date('2024-01-15')` — a JavaScript `Date`. This value has to survive a round-trip through `contract.json`, but `Date` has no JSON representation. The codec handles it:

```ts
const pgTimestamptzCodec = defineCodec({
  typeId: 'pg/timestamptz@1',
  targetTypes: ['timestamptz'],
  traits: ['equality', 'order'],

  // Wire (existing)
  encode: (value: string | Date): string => {
    if (value instanceof Date) return value.toISOString();
    return value;
  },
  decode: (wire: string | Date): string => {
    if (wire instanceof Date) return wire.toISOString();
    return wire;
  },

  // Contract JSON — converts between JS type and JSON representation
  encodeJson: (value: Date) => value.toISOString(),
  decodeJson: (json: JsonValue) => new Date(json as string),
});
```

The resulting contract JSON is plain — no tags, no wrappers:

```json
{
  "fields": {
    "createdAt": {
      "codecId": "pg/timestamptz@1",
      "nullable": false,
      "default": { "kind": "literal", "value": "2024-01-15T00:00:00.000Z" }
    }
  }
}
```

The consumer reads `"2024-01-15T00:00:00.000Z"`, looks up `pg/timestamptz@1`, calls `decodeJson(...)`, gets a `Date` object.

Every codec has `encodeJson` and `decodeJson`. For JSON-safe types (strings, numbers, booleans, null), they are identity functions — the `defineCodec()` factory provides these defaults. Only codecs for types that JSON can't represent (`Date`, binary data, etc.) override them.

The same typed value crosses other boundaries too. The migration planner renders it into DDL (`DEFAULT '2024-01-15T00:00:00.000Z'`). The PSL printer renders it into schema source (`@default("2024-01-15T00:00:00.000Z")`). Migration operations carry it in `ops.json`. These are the same problem for different media, but they live at different layers:

```ts
// Target/adapter layer, keyed by codec ID
interface DdlLiteralCodec<TJs = unknown> {
  encodeDdl(value: TJs): string;
  decodeDdl?(raw: string): TJs | undefined;
}

// Authoring layer, keyed by codec ID
interface PslLiteralCodec<TJs = unknown> {
  encodePsl(value: TJs): string;
  decodePsl?(text: string): TJs | undefined;
}
```

All three interfaces are dispatched by the same `codecId`. A codec ships with wire + contract JSON support; DDL and PSL support are added independently by the target or authoring layer. Here's the full lifecycle of a timestamp column default:

| Stage | Call | Result |
|---|---|---|
| TS authoring | `codec.encodeJson(new Date('2024-01-15'))` | `"2024-01-15T00:00:00.000Z"` in contract JSON |
| Contract loading | `codec.decodeJson("2024-01-15T00:00:00.000Z")` | `Date` in memory |
| Migration DDL | `ddlCodec.encodeDdl(new Date('2024-01-15'))` | `DEFAULT '2024-01-15T00:00:00.000Z'` |
| PSL printing | `pslCodec.encodePsl(new Date('2024-01-15'))` | `@default("2024-01-15T00:00:00.000Z")` |

Column defaults aren't the only place typed values appear:

| Value | Codec ID source |
|---|---|
| Column default | `column.codecId` |
| Discriminator value | `model.fields[discriminator.field].codecId` |
| Type parameter | `column.codecId` |
| Migration temporary default | Column's `codecId` |

In every case, the codec ID is in scope. The codec can always be found.

## The codec ID is the type ID

Today, values that JSON can't natively represent — `bigint` and `Date` — are handled with hardcoded branches. Bigint values are wrapped in self-describing tags:

```json
{ "$type": "bigint", "value": "42" }
```

This lets a consumer decode the value without knowing what field it belongs to. The tag is the type. But the consumer *already* knows what field it belongs to — column defaults are on columns, discriminator values are on models whose discriminator field has a `codecId`. The tag duplicates information that the contract structure provides.

Tags also need a collision guard. A user JSON object that happens to have a `$type` key would be misinterpreted as a tagged value, so the encoding wraps those in `{ $type: 'raw', value: ... }`. This is a protocol layered on top of JSON to solve a problem that wouldn't exist if values didn't need to be self-describing.

The insight: we already use codec IDs as type identifiers throughout the system — for wire encoding, for trait lookup, for capability gating. A typed value in the contract is no different. The codec ID from context *is* the type ID. Tags are unnecessary.

## Six branches become one dispatch

The tag approach is implemented as hardcoded branches in six locations:

| Stage | Function | What it does |
|---|---|---|
| Emit | `encodeDefaultLiteralValue` | Wraps `bigint`/`Date` in `$type` tags |
| Emit | `bigintJsonReplacer` | `JSON.stringify` replacer for bigint |
| Load | `decodeContractDefaults` | Unwraps `$type` tags back to JS values |
| DDL | `renderDefaultLiteral` | Hardcoded `bigint` → SQL literal branch |
| Types | `DefaultLiteralValue<>` | Conditional type mapping `bigint`/`Date`/etc. |
| Migration | `serializeValue` | Hardcoded value serialization for ops |

Adding a new non-JSON-safe type — say, a `Decimal` from an extension pack — means touching all six. With codec-owned serialization, it means providing `encodeJson`/`decodeJson` on the decimal codec. One place.

## Design decisions

### Framework-level codec base interface

Both SQL and Mongo families define structurally identical codec interfaces (`Codec` and `MongoCodec`) with the same core shape: `id`, `targetTypes`, `traits`, `encode`, `decode`. Since `encodeJson`/`decodeJson` are a cross-family concern — any family's codecs need to serialize typed values into `contract.json` — the common shape is extracted to a base `Codec` interface at the framework layer. SQL's codec extends it with SQL-specific fields (`meta`, `paramsSchema`, `init`). Mongo's codec becomes a type alias or thin extension of the same base.

### Required methods with identity defaults

`encodeJson` and `decodeJson` are required on the `Codec` interface, not optional. Any type that can appear in the contract may need a literal value serialized for it (column defaults, discriminator values, type parameters, migration temporary defaults). Making the methods required eliminates null checks at every dispatch site.

For JSON-safe types (strings, numbers, booleans, null), the methods are identity functions. The `defineCodec()` factory provides these defaults when not explicitly supplied, so codecs for JSON-safe types need no additional boilerplate.

### Contract loading integrates decoding

Decoding contract values (calling `codec.decodeJson()` on literal defaults, discriminator values, etc.) is part of the contract loading pipeline, not a separate post-validation step. The codec registry flows into `validateContract` alongside the existing storage validator, and decoding happens as part of the same call. Callers never see undecoded values.

### Default value types in `contract.d.ts`

The generated `contract.d.ts` reflects the **decoded** (runtime) type for literal default values, not the JSON-encoded form. A column with `codecId: 'pg/timestamptz@1'` and a Date default has `readonly value: Date` in its type, not `readonly value: string`.

For the **emit** workflow, the emitter resolves the concrete type per column — including parameterized types where the output type depends on type parameters (e.g., typed JSON columns with a schema). The emitter can generate the resolved type inline.

For the **no-emit** workflow, a type-level mechanism (`DefaultLiteralValue` or similar) maps through `CodecTypes` to derive the decoded type from the codec ID. This must also handle parameterized types, where the codec's output type may be narrowed by type parameters.

### Emitter and codec access

The emitter already receives a subset of the control stack via `EmitStackInput`. This interface is extended with a codec registry (or a minimal lookup interface) so the emission pipeline can call `codec.encodeJson()` when serializing literal values into `contract.json`. The existing `bigintJsonReplacer` and `encodeDefaultLiteralValue` are replaced by codec dispatch.

## Consequences

### Benefits

- **Extensible without core changes.** New non-JSON-safe types are handled by their codec — no changes to shared infrastructure, validation, or rendering.
- **Discriminator values work naturally.** A discriminator value is a value of the discriminator field's type. The field's codec knows how to serialize it.
- **Simpler contract JSON.** No `$type` tags, no collision guards, no special `JSON.stringify` replacer.
- **Separation of concerns.** Contract JSON conversion lives on the core codec. DDL lives in the target layer. PSL lives in the authoring layer. Each interface is where it belongs.

### Costs

- **Contract decoding requires the codec stack.** Typed literal values are opaque without the codec implementation. This is already true for wire values; it becomes true for contract values too.
- **Migration from tagged values.** Existing contracts with `{ $type: 'bigint', value: '42' }` need a transition path.

## Alternatives considered

### Keep tags, make them extensible

ADR 167 outlined a "v2" where extension packs register namespaced `$type` tags (e.g., `{ $type: 'pgvector/vector', value: [1.0, 2.0] }`). Values would be self-describing via a tag registry.

Rejected because the codec ID is always available from context. Tags duplicate information already in scope, and they layer a protocol on top of JSON that creates problems (collision guards) while solving none.

### Single interface with all boundaries

Put `encodeJson`, `decodeJson`, `encodeDdl`, `decodeDdl`, `encodePsl`, `decodePsl` all on the `Codec` interface.

Rejected because DDL and PSL are layer-specific. DDL rendering is target-specific and migration-only. PSL is authoring-specific and grammar-constrained. Bundling everything onto one interface mixes concerns and creates unnecessary dependencies.

### Separate `DefaultLiteralCodec` interface (ADR 167 v2)

ADR 167 proposed a standalone `DefaultLiteralCodec` interface, parallel to `Codec`, with its own `encode`/`decode`/`render`/`normalize`.

Rejected because this isn't a separate kind of codec — it's an extension of codec responsibilities. The codec already owns the type; value serialization is part of what owning a type means.

## Supersedes

- **ADR 167 v2** (deferred codec-keyed `DefaultLiteralCodec` SPI) — this ADR generalizes and implements the concept. The v1 hardcoded pipeline is replaced.

## Resolves

- **ADR 173 open question: "Discriminator values are untyped strings."** Discriminator values are encoded/decoded through the discriminator field's codec.

## Related

- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md) — the v1 design this supersedes
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md) — the trait system on the `Codec` interface
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — discriminator values are a motivating instance
