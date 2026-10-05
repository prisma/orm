# ADR 178 — Value objects in the contract

## At a glance

A User model with scalar fields and value object fields. Value objects are defined in a separate `valueObjects` section — they share the same field descriptor shape (`{ nullable, codecId }`) as models, but the framework makes fundamentally different promises about them.

```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "_id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "email": { "nullable": false, "codecId": "mongo/string@1" },
        "homeAddress": { "nullable": true, "type": "Address" },
        "previousAddresses": { "nullable": false, "type": "Address", "many": { "elementNullable": false } }
      },
      "relations": {},
      "storage": { "collection": "users" }
    }
  },
  "valueObjects": {
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city": { "nullable": false, "codecId": "mongo/string@1" },
        "location": { "nullable": true, "type": "GeoPoint" }
      }
    },
    "GeoPoint": {
      "fields": {
        "lat": { "nullable": false, "codecId": "mongo/double@1" },
        "lng": { "nullable": false, "codecId": "mongo/double@1" }
      }
    }
  }
}
```

Three things to notice:

1. **Value objects live in `valueObjects`, not `models`.** They are typed data structures with no framework guarantees — no identity, no lifecycle hooks, no referential integrity. Models are full framework citizens with all of those.
2. **Fields reference value objects via `type`, not `codecId`.** `"type": "Address"` means "this field holds an Address value object." `codecId` is for scalar types with a codec. The two are mutually exclusive.
3. **`many: { elementNullable: false }` expresses a list of non-null value objects.** `nullable` controls whether the whole list can be null; `many.elementNullable` controls whether its elements can be null. Relations use `cardinality` for bidirectional semantics like `1:N` and `N:1`.

The resulting TypeScript row type:

```typescript
type UserRow = {
  _id: ObjectId;
  email: string;
  homeAddress: {
    street: string;
    city: string;
    location: { lat: number; lng: number } | null;
  } | null;
  previousAddresses: {
    street: string;
    city: string;
    location: { lat: number; lng: number } | null;
  }[];
}
```

## Context

The contract distinguishes between models (entities with identity) and aggregate roots (models that serve as ORM entry points). [ADR 174](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) introduced the `roots` section, and [ADR 177](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) introduced `owner` for models that belong to another model's aggregate. But both still assume everything in the data model is a model — a full framework citizen with identity, lifecycle, and integrity guarantees.

Many real-world data structures don't need any of that. An Address, a GeoPoint, a Money value (`{ amount: 100, currency: "USD" }`) — these are structured data without independent identity. Two Addresses with the same street and city are interchangeable. No business logic fires when an Address changes. No referential integrity check runs when one is replaced.

Prisma Next needs a way to describe these structures in the contract. Putting them in `models` is semantically incorrect — it promises framework capabilities that will never be delivered. But leaving them unrepresented means users must model structured data as raw JSON, losing type safety.

## Problem

How should the contract represent structured data types that don't have identity, lifecycle, or framework capabilities — without conflating them with models?

## Decision

### The distinction is about framework guarantees, not structure

The difference between a model and a value object is not what fields they have — it's what the framework promises:

| Capability | Models | Value objects |
|---|---|---|
| **Global unique addressability** | Guaranteed | Not guaranteed |
| **Query entry point** (roots) | Yes | No |
| **Identity-based mutation** | Yes — target by ID | No — replaced wholesale or partially |
| **Business logic association** | Yes — custom collection classes, domain methods | No |
| **Lifecycle hooks** | Yes — `onCreate`, `onUpdate`, `onDelete` | No |
| **Referential integrity** | Yes — cascading deletes, restrict constraints | No |
| **Include resolution** | Yes — loaded via `include` | No — inlined in parent row |

A value object can have an `_id` field. The framework won't stop you. But it won't treat that field as meaningful — none of the capabilities that depend on unique addressability will function. Value objects are interchangeable instances of structured data.

This extends the framework commitment hierarchy:

| Declaration | Framework commitment |
|---|---|
| In `roots` | "The framework provides this as a query entry point" |
| In `models` | "Full framework citizen — identity, lifecycle, business logic, integrity" |
| `owner` on a model | "Full citizen, scoped within the owner's aggregate" |
| In `valueObjects` | "Typed data structure — no identity, no lifecycle, no hooks" |

### Value objects are a top-level contract section

Value objects live in a `valueObjects` section alongside `models`. They use the same field shape (`{ nullable, codecId }`) as model fields. Refer to the [At a glance](#at-a-glance) example for the complete structure.

**Why not inside `models`?** The `models` section carries an implicit promise: everything here is a full framework citizen. Mixing in value objects conflates two concepts with different guarantees. Consumers iterating `models` (the ORM building its graph, migration tooling planning DDL, validation checking integrity constraints) would need to filter by kind.

**Why not a lightweight type alias?** Value objects need the same field descriptors as models — `nullable` and `codecId` are just as important for type inference and validation. A bare string alias loses this structure.

### Field type system: `codecId` vs `type`

A field's type is expressed by one of two mutually exclusive properties:

- **`codecId`**: a scalar type encoded/decoded by a codec (`"codecId": "mongo/string@1"`)
- **`type`**: a reference to a value object definition (`"type": "Address"`)

A value object is a structured composite, not a single encoded value — it doesn't have a codec. The `type` property references a definition in the `valueObjects` section.

This applies uniformly: value object fields can appear on models *and* on other value objects. An Address can reference a GeoPoint. A NavItem can reference itself:

```json
"NavItem": {
  "fields": {
    "label": { "nullable": false, "codecId": "mongo/string@1" },
    "url": { "nullable": false, "codecId": "mongo/string@1" },
    "children": { "nullable": false, "type": "NavItem", "many": { "elementNullable": false } }
  }
}
```

A third option, `union`, handles fields that can hold one of several types — see [ADR 179](ADR%20179%20-%20Union%20field%20types.md). All three (`codecId`, `type`, `union`) are mutually exclusive on a field.

### Cardinality: `many` on value objects, `cardinality` on relations

Value object references describe cardinality with `many`: omission or `false` means one value object, while `{ elementNullable: boolean }` means a list. Whole-field nullability (`nullable`) and list-element nullability (`many.elementNullable`) are independent:

```json
{
  "address": { "type": "Address", "nullable": false },
  "optionalAddress": { "type": "Address", "nullable": true },
  "addresses": { "type": "Address", "nullable": false, "many": { "elementNullable": false } },
  "nullableElements": { "type": "Address", "nullable": false, "many": { "elementNullable": true } },
  "optionalAddresses": { "type": "Address", "nullable": true, "many": { "elementNullable": false } },
  "optionalNullableElements": { "type": "Address", "nullable": true, "many": { "elementNullable": true } }
}
```

A nullable list permits the whole value to be null, which is distinct from an empty list. Nullable elements permit null entries inside a present list without making the container nullable. The four list shapes correspond to `Address[]`, `(Address | null)[]`, `Address[] | null`, and `(Address | null)[] | null`. [ADR 258](ADR%20258%20-%20List%20cardinality%20has%20independent%20container%20and%20element%20nullability.md) describes the shared representation and family-specific enforcement.

Relations keep `cardinality: "1:N" | "N:1" | "1:1"` because they encode bidirectional semantics — "I have one manager" (`N:1`) is different from "I have one passport" (`1:1`) even though both are "one from my side." Value object references have no inverse relation; their `many` descriptor records list cardinality and element nullability without relation cardinality.

### Fixed-length lists don't need contract representation

If the positions have semantic meaning — and they almost always do — use named fields:

```json
"BoundingBox": {
  "fields": {
    "topLeft": { "type": "GeoPoint", "nullable": false },
    "bottomRight": { "type": "GeoPoint", "nullable": false }
  }
}
```

You say `boundingBox.topLeft`, not `boundingBox[0]`. Length constraints on homogeneous lists are a validation concern, not a structural one.

### Value objects need no special storage mapping

Value object fields use `storage.fields` like any other field. The storage layer maps domain field names to physical locations without knowing whether the field holds a scalar or a composite:

**Mongo:**

```json
"storage": {
  "collection": "users",
  "fields": { "homeAddress": { "field": "home_address" } }
}
```

**SQL:**

```json
"storage": {
  "table": "users",
  "fields": { "homeAddress": { "column": "home_address" } }
}
```

The composite structure comes from the value object definition in the domain section. The storage mapping just says where the data lives. This is the domain/storage separation ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)) doing what it was designed for.

### Validation cross-references domain and storage

For SQL, the column backing a value object field must be JSON-compatible (e.g., `jsonb`). Contract validation cross-references the domain field type with the storage column's native type — if a value object field maps to an `integer` column, that's a validation error. For Mongo, there's nothing to validate — any document field can hold a subdocument.

| Layer | Responsibility |
|---|---|
| **Emitter** | Generates the correct column type (JSONB) when it sees a value object field |
| **Contract validation** | Cross-references domain field type with column native type — rejects mismatches |
| **Migration system** | Creates/alters the column to be JSONB |
| **Database** | Enforces the column type at write time |

### Value object support is capability-gated

Value objects in SQL require JSON-compatible columns. Not all SQL targets support this. The constraint is **enforced at the storage level**: if the target can't produce a JSON-compatible column, the emitter can't generate valid storage — emission fails naturally. The constraint is **surfaced at the authoring level** via a declared capability (e.g., `valueObject`), so the user gets a clear error before writing an entire schema that can't be emitted. For Mongo, subdocuments are always available — no capability check needed.

### Polymorphic value objects

Value objects can be polymorphic using the same `discriminator`/`variants`/`base` mechanism as models ([ADR 173](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)). See [ADR 173's value object scope note](#related) for details. The structural mechanism is identical; only the framework commitment differs — polymorphic value objects don't get identity, lifecycle, or integrity guarantees.

## Consequences

### Benefits

- **Clear framework commitment.** The contract explicitly declares which data structures get full framework capabilities (models) and which are typed data only (value objects). No guessing, no filtering by kind.
- **Reusable structured types.** An Address defined once in `valueObjects` can be referenced from any model or other value object. Type inference produces the same TypeScript shape everywhere it's used.
- **No storage model changes.** Value objects use existing `storage.fields` mappings. No new storage sections, no new mapping concepts.
- **Cross-family.** The same `valueObjects` section works for Mongo (subdocuments) and SQL (JSONB columns), with validation ensuring the storage column is compatible.

### Costs

- **New contract section.** Consumers must handle `valueObjects` alongside `models`. The emitter must generate value object definitions. Type inference must recursively expand value object references.
- **Capability gating is a new pattern.** Value objects are the first domain-level contract concept whose availability depends on a target capability. The pattern (emit-time enforcement + authoring-level surfacing) is straightforward, but it's a precedent.

### Open questions

- **Contract key naming.** `valueObjects` is the working name. The exact key (`valueObjects`, `types`, `composites`) is cosmetic and should be decided before the contract shape stabilizes.

## Related

- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — domain/storage principle this ADR builds on
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — same mechanism applies to polymorphic value objects
- [ADR 174 — Aggregate roots and relation strategies](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — `roots` and relation cardinality
- [ADR 177 — Ownership replaces relation strategy](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — owned models vs value objects
- [ADR 179 — Union field types](ADR%20179%20-%20Union%20field%20types.md) — `union` as a third field type descriptor
- [ADR 180 — Dot-path field accessor](ADR%20180%20-%20Dot-path%20field%20accessor.md) — querying and mutating value object fields
