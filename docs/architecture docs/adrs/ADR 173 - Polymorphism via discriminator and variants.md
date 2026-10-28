# ADR 173 — Polymorphism via discriminator and variants

## At a glance

A polymorphic Task model with Bug and Feature variants. Task declares which field discriminates (`type`) and which models are its specializations. Each variant is a sibling in `models` listing only its own additional fields — it names its `base` model and inherits the base's fields through that relationship.

```json
{
  "roots": { "tasks": { "model": "Task", "namespace": "public" } },
  "domain": {
    "namespaces": {
      "public": {
        "models": {
          "Task": {
            "discriminator": { "field": "type" },
            "fields": {
              "id": { "nullable": false, "type": { "codecId": "pg/int4@1", "kind": "scalar" } },
              "title": { "nullable": false, "type": { "codecId": "pg/text@1", "kind": "scalar" } },
              "type": { "nullable": false, "type": { "codecId": "pg/text@1", "kind": "scalar" } }
            },
            "relations": {},
            "storage": {
              "fields": {
                "id": { "column": "id" },
                "title": { "column": "title" },
                "type": { "column": "type" }
              },
              "namespaceId": "public",
              "table": "tasks"
            },
            "variants": {
              "bug": { "model": "Bug", "namespace": "public" },
              "feature": { "model": "Feature", "namespace": "public" }
            }
          },
          "Bug": {
            "base": { "model": "Task", "namespace": "public" },
            "fields": {
              "severity": { "nullable": false, "type": { "codecId": "pg/text@1", "kind": "scalar" } }
            },
            "relations": {},
            "storage": {
              "fields": { "severity": { "column": "severity" } },
              "namespaceId": "public",
              "table": "tasks"
            }
          },
          "Feature": {
            "base": { "model": "Task", "namespace": "public" },
            "fields": {
              "priority": { "nullable": false, "type": { "codecId": "pg/int4@1", "kind": "scalar" } }
            },
            "relations": {},
            "storage": {
              "fields": { "priority": { "column": "priority" } },
              "namespaceId": "public",
              "table": "features"
            }
          }
        }
      }
    }
  }
}
```

Notice that the domain declaration (`discriminator`, `variants`, `base`, `fields`) is the same regardless of persistence strategy. Bug shares Task's table (single-table inheritance); Feature has its own table (multi-table inheritance). The ORM derives the query strategy from the storage mappings — the contract doesn't label it. See [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md) for why `model.fields` carries `nullable` and `codecId`.

## Context

Polymorphism is a cross-family concern. Both SQL and MongoDB need to represent multiple entity shapes in the same storage unit:

- **MongoDB**: Polymorphic collections are common — a `tasks` collection holding Bug, Feature, and Chore documents, distinguished by a `type` field. The MongoDB engineering team rates "Inheritance and Polymorphism" as their highest priority for Prisma integration.
- **SQL**: Single-table inheritance (STI) is common in Rails, Django, and many TS codebases — one table holds multiple model types, distinguished by a discriminator column. Multi-table inheritance (MTI) is also used.

Prisma ORM (v1) handles polymorphic Mongo collections by typing the discriminator as `Json` or using multiple optional fields, losing all type safety. Users specifically call this out as a pain point.

The contract needs to express polymorphism in a way that:

1. Works for both families
2. Supports at least STI (shared storage) and MTI (separate storage)
3. Produces TypeScript types that narrow correctly on the discriminator
4. Doesn't prescribe OOP patterns that the ORM should decide at runtime

## Problem

How does the contract represent the relationship between a base model (Task) and its specializations (Bug, Feature)?

## Constraints

- **The domain model must be self-describing.** Reading the `models` section should reveal the polymorphic structure without consulting `storage` (see [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)).
- **Persistence strategy must be emergent.** The contract states facts; the ORM derives behavior. Whether the ORM queries one table (STI) or joins two (MTI) should follow from the storage mappings, not from a label.
- **The representation must be extensible.** Adding new persistence strategies for polymorphism (concrete table inheritance, materialized views, etc.) should not require changing the contract schema.
- **All models are siblings.** Base models, variants, and embedded models all appear as top-level entries in the `models` dictionary. This keeps enumeration and lookup simple.

## Alternatives considered

### `extends` on variant models

```json
{
  "Task": { "fields": { "id": { ... }, "title": { ... }, "type": { ... } }, "storage": { "table": "tasks" } },
  "Bug": { "extends": "Task", "fields": { "id": { ... }, "title": { ... }, "type": { ... }, "severity": { ... } }, "storage": { "table": "tasks" } }
}
```

Each variant declares that it extends a base model and lists all fields (base + own).

**Why we rejected it**: `extends` is prescriptive — it carries OOP inheritance baggage (single inheritance, Liskov substitution, parent-child hierarchy) and tells the ORM *how* to think about the relationship. The contract should describe structural facts, not prescribe runtime patterns. Whether the ORM represents Bug as a subclass of Task, a separate class, or a composed type is a runtime decision the contract should not influence. We use `base` instead — it says "Bug is a specialization of Task" (a structural fact about the data) without implying "Bug inherits from Task" (an OOP prescription).

### `strategy` label on the model

```json
{
  "Task": { "strategy": "polymorphic", "discriminator": "type", "variants": ["Bug", "Feature"] },
  "Bug": { "strategy": "variant", "of": "Task" }
}
```

Each model explicitly labels its role in the polymorphic hierarchy.

**Why we rejected it**: Labeling the persistence strategy directly is not extensible. If a new strategy emerges (concrete table inheritance, for example), you'd need to add a new enum value to the contract schema. This also conflates two independent properties: whether a model is polymorphic (a domain concept) and how it's stored (a persistence concept). A model can be polymorphic *and* an aggregate root. A model can be an embedded variant. These are orthogonal properties that shouldn't be mashed into a single `strategy` enum.

## Decision

Polymorphism is expressed bidirectionally. On the base model:

- **`discriminator`**: which field distinguishes the variants (`{ "field": "type" }`)
- **`variants`**: which models are specializations, keyed by the discriminator value each uses (`{ "bug": { "model": "Bug", "namespace": "public" }, "feature": { "model": "Feature", "namespace": "public" } }`)

On each variant:

- **`base`**: which model this variant specializes (`{ "model": "Task", "namespace": "public" }`)

Each variant appears as a sibling in the `models` dictionary with its own fields and storage. Refer to the [At a glance](#at-a-glance) example for the complete structure.

`variants` is keyed by discriminator value, and each entry references the variant model by its coordinate, `{ namespace, model }` (see [ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)). A value names one variant in a hierarchy, so a variant may be in a different namespace from its base, and two variants may have the same model name.

The `base` ↔ `variants` relationship is bidirectional: the base model answers "what are Task's specializations?" and each variant answers "what model does Bug specialize?" This is redundant (the emitter writes both sides), but each direction serves a different traversal — see [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md) for why redundancy in an emitted artifact is acceptable.

### Variant fields are thin

Variants list only their own additional fields — they inherit the base model's fields via the `base` reference. In the example above, Bug's `fields` contains only `severity`; it inherits `id`, `title` and `type` from Task.

This avoids redundancy (Task has 3 fields; repeating them on each variant triples the declarations), eliminates consistency risk (the emitter handles field resolution — it can't get out of sync), and makes domain reading cleaner (Bug's `fields` tells you exactly what Bug *adds* to the base).

### Persistence strategy is emergent

The ORM reads the storage mappings to determine query behavior:

- **STI**: Bug's storage points to `"table": "tasks"` (same as Task). The ORM queries one table with a discriminator filter.
- **MTI**: Feature's storage points to `"table": "features"` (different from Task). The ORM JOINs `tasks` and `features` on the shared key.
- **Mongo**: All variants share a collection (no joins). A variant's storage inherits the base's collection.

The domain declaration (`discriminator` + `variants`) doesn't change across these strategies — only the storage mappings do. New persistence strategies don't require new contract schema concepts.

### Terminology: specialization and generalization, not inheritance

We deliberately avoid OOP inheritance language. The contract describes **specialization** (Bug specializes Task — it adds fields to the base shape) and **generalization** (Task generalizes Bug and Feature — it defines the shared shape that all variants have in common). These are structural relationships between data shapes, not runtime class hierarchies.

The term `base` was chosen over `extends`, `parent`, or `supertype` because it describes a structural fact ("Bug's base is Task") without implying runtime behavior. `extends` carries OOP baggage; `parent` implies a lifecycle hierarchy; `supertype` implies a formal type system. `base` is neutral — it says where the shared fields come from, nothing more.

Similarly, the base model's `variants` lists its specializations, and each specialization's `base` names its generalization. The ORM is free to interpret these relationships however it wants at runtime: class hierarchies, flat discriminated union types, composition, or independent classes. The contract doesn't close that door or force it open.

### Why `discriminator` + `variants` + `base` is the right primitive

All persistence-level polymorphism reduces to "multiple shapes in the same storage, distinguished by a field." This is fundamental enough to bake into the contract. The contract says "Bug is a specialization of Task, discriminated by the `type` field" — a domain fact about the data, not an instruction about OOP.

### Polymorphism is orthogonal to other model roles

A model can be simultaneously:
- Polymorphic (has `discriminator` + `variants`) AND an aggregate root (appears in `roots`)
- A variant AND owned (has `"owner": "ParentModel"`)
- Polymorphic AND embedded

These are independent properties. This composability is why we rejected labeled strategies — they create a false choice between roles that are actually orthogonal.

### Value objects use the same mechanism

> **Note:** value objects are now storage entities, at `storage.namespaces.<ns>.entries.valueObject`, not a domain `valueObjects` section ([ADR 309](ADR%20309%20-%20Value%20objects%20are%20storage%20entities%2C%20and%20a%20discriminator%20column%20names%20a%20value%20set.md)). On SQL, a base model's discriminator column also refers to a value set of its variants' values.

The `discriminator`/`variants`/`base` pattern applies identically to value objects in the `valueObjects` section ([ADR 178](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)). A base value object declares a discriminator and variants; each variant declares its base and adds type-specific fields:

```json
"valueObjects": {
  "ContactInfo": {
    "discriminator": { "field": "channel" },
    "variants": {
      "email": { "model": "EmailContact", "namespace": "__unbound__" },
      "phone": { "model": "PhoneContact", "namespace": "__unbound__" }
    },
    "fields": {
      "channel": { "nullable": false, "codecId": "mongo/string@1" }
    }
  },
  "EmailContact": {
    "base": { "model": "ContactInfo", "namespace": "__unbound__" },
    "fields": {
      "address": { "nullable": false, "codecId": "mongo/string@1" }
    }
  },
  "PhoneContact": {
    "base": { "model": "ContactInfo", "namespace": "__unbound__" },
    "fields": {
      "number": { "nullable": false, "codecId": "mongo/string@1" }
    }
  }
}
```

The structural mechanism is identical — `discriminator`, `variants`, `base`, thin variant fields. The difference is purely in framework commitment: polymorphic value objects don't get identity, lifecycle hooks, or referential integrity. TypeScript inference produces `ContactInfo = EmailContact | PhoneContact`, narrowed by the `channel` discriminator — the same narrowing pattern the ORM already uses for model polymorphism.

Real-world examples: `ContactInfo` (email vs phone vs push), `PaymentMethod` (card vs bank), `MediaAttachment` (image vs video), form field definitions (text vs select vs number).

For *unstructured* unions (no discriminator, no shared fields), see [ADR 179 — Union field types](ADR%20179%20-%20Union%20field%20types.md).

## Consequences

### Benefits

- **Self-describing domain**: reading the models section reveals the polymorphic structure without consulting storage.
- **Bidirectional navigation**: a consumer can traverse from base to specializations (`Task.variants`) or from specialization to base (`Bug.base`) without building a reverse index.
- **Extensible**: new persistence strategies are expressed through storage mappings, not contract schema changes.
- **Cross-family**: the same representation works for SQL STI/MTI and Mongo polymorphic collections.
- **Neutral terminology**: `base`/`variants` describes structural facts (specialization/generalization) without prescribing OOP patterns.
- **Reusable across models and value objects**: the same mechanism works in both `models` and `valueObjects` sections, reducing cognitive overhead.

### Costs

- **Variant field resolution is implicit.** A reader must know that a variant's full field set is its own `fields` merged with its `base` model's `fields`. This convention must be documented and understood by all contract consumers.
- **Bidirectional redundancy.** The `base` ↔ `variants` relationship is expressed on both sides. The emitter guarantees consistency; the cost is a small amount of JSON redundancy.

### Indexes on variant-specific fields

When variants share a storage unit (STI in SQL, single collection in Mongo), variant-specific fields are absent from rows/documents of other variants. This has direct consequences for indexing:

- **Unique indexes fail.** A unique index on Bug's `severity` column sees NULL (SQL) or missing (Mongo) for every Feature row/document. In MongoDB, multiple missing values violate uniqueness. In SQL, most engines allow multiple NULLs in a unique index, but the semantics are still wrong — you want uniqueness among Bugs only, not across the whole table.
- **Index waste.** A non-unique index on a variant-specific field indexes every row/document in the storage unit, including the ones where the field is irrelevant.

The solution is **partial indexes** — indexes scoped to documents/rows matching a discriminator condition:

```sql
-- Postgres
CREATE UNIQUE INDEX idx_bug_severity ON tasks (severity) WHERE type = 'bug';
```

```javascript
// MongoDB
db.tasks.createIndex({ severity: 1 }, {
  unique: true,
  partialFilterExpression: { type: "bug" }
})
```

**No domain representation change is needed.** The contract already contains everything required to derive the filter: variant membership tells you which model owns the field, and `discriminator`/`variants` tells you the discriminator field and value. The emitter and migration system derive the partial index condition automatically from these domain facts.

This is handled in family-specific or target-specific logic:

| Target | Partial index support | Migration output |
|---|---|---|
| Postgres | Yes | `WHERE type = 'bug'` clause on `CREATE INDEX` |
| SQLite | Yes | Same `WHERE` clause syntax |
| MySQL | No | No partial indexes — application-level enforcement or generated column workaround; migration system should warn |
| MongoDB | Yes | `partialFilterExpression` on `createIndex` |

The emitter's rule is straightforward: if an index targets a field that belongs to a variant (not the base model), and the variant shares storage with the base, automatically scope the index to the variant's discriminator value. If the target doesn't support partial indexes, emit a warning.

### Open questions

- ~~**Discriminator values are untyped strings.**~~ **Resolved.** Discriminator values are encoded/decoded through the discriminator field's codec, using the general codec-owned value serialization mechanism. The codec ID is available from context (`model.fields[discriminator.field].codecId`), so the emitter calls `codec.toContractJson()` and the runtime calls `codec.fromContractJson()`. See [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md).
- **Polymorphic associations**: A `Comment` that can belong to either a `Post` or a `Video` (distinguished by `commentable_type`) is polymorphism on the *relation*, not the model. The `relations` section would need to express "this relation can point to one of several models." Not yet designed.
- **ORM surface**: Does the ORM present separate collections for each variant (`db.bugs`, `db.features`) or only the base (`db.tasks`, returning a union)? This is an ORM design decision the contract doesn't prescribe.
- **Multi-level polymorphism**: What if Bug has its own sub-variants with a different discriminator field? Possible but adds complexity. Not yet designed.

## Related

- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — why `model.fields` carries `nullable` and `codecId`
- [ADR 174 — Aggregate roots and relation strategies](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — `roots`, `reference` vs `embed`
- [ADR 178 — Value objects in the contract](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) — polymorphic value objects use the same discriminator/variants/base mechanism
- [ADR 179 — Union field types](ADR%20179%20-%20Union%20field%20types.md) — unstructured unions as an alternative to discriminated polymorphism
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md) — resolves the discriminator values encoding question
