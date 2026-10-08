# ADR 174 — Aggregate roots and relation strategies

> **Partial supersession:** The **relation strategy** design (`"strategy": "reference" | "embed"`) in this ADR has been superseded by [ADR 177 — Ownership replaces relation strategy](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md). Embedding is now expressed via `"owner": "ParentModel"` on the owned model, with `storage.relations` on the parent mapping the relation to its physical location. The **aggregate roots** design (`roots` section) remains unchanged.

## At a glance

A User model as an aggregate root with a referenced relation (Post) and an embedded relation (Address). Post is also an aggregate root. Address is not — it only exists inside User documents.

```json
{
  "roots": {
    "users": "User",
    "posts": "Post"
  },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "email": { "nullable": false, "codecId": "mongo/string@1" }
      },
      "relations": {
        "posts": {
          "to": "Post", "cardinality": "1:N", "strategy": "reference",
          "on": { "localFields": ["id"], "targetFields": ["authorId"] }
        },
        "addresses": { "to": "Address", "cardinality": "1:N", "strategy": "embed" }
      },
      "storage": { "collection": "users" }
    },
    "Post": {
      "fields": {
        "id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "title": { "nullable": false, "codecId": "mongo/string@1" },
        "authorId": { "nullable": false, "codecId": "mongo/objectId@1" }
      },
      "relations": {
        "author": {
          "to": "User", "cardinality": "N:1", "strategy": "reference",
          "on": { "localFields": ["authorId"], "targetFields": ["id"] }
        }
      },
      "storage": { "collection": "posts" }
    },
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city": { "nullable": false, "codecId": "mongo/string@1" }
      },
      "relations": {},
      "storage": {}
    }
  }
}
```

Three things to notice:

1. **`roots`** maps ORM accessor names to models — `db.users` and `db.posts` are the entry points. Address is not in `roots` because it's only reachable through User.
2. **`strategy: "reference"`** on a relationship means Post lives in its own collection, resolved at query time. **`strategy: "embed"`** means Address lives nested inside User documents.
3. **Address has `"storage": {}`** — empty, because it doesn't own a collection. Its data lives within User's storage. See [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md) for why `model.fields` carries `nullable` and `codecId`.

## Context

This ADR addresses two related gaps in the contract that the Mongo PoC made visible.

### Aggregate roots were implicit

Before this decision, the ORM's top-level access points were derived, not declared. The ORM scanned `models`, checked which had a `storage.table` property, and presented each as a top-level accessor (`db.user`, `db.post`). In SQL, this worked because every model has its own table — the distinction between "model" and "aggregate root" was invisible.

MongoDB breaks this assumption:

- A model can be **embedded** in another model's document as a sub-document. It has no collection of its own and cannot be queried independently.
- A model can be a **polymorphic variant** stored in its parent's collection (see [ADR 173](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)).
- A model can own its own collection and serve as an entry point for queries.

These are three different storage relationships, but the contract had no way to express them. The ORM had to infer "is this model an aggregate root?" from storage metadata.

### Relation storage strategy was missing

The relation graph described cardinality (1:1, 1:N, N:M) but not *how* the relation was persisted. In SQL, this didn't matter much — every relation is a foreign-key reference resolved at query time. But in MongoDB, the choice between embedding and referencing is a fundamental modeling decision that determines:

- Where the data physically lives (in the parent document vs. a separate collection)
- How the data is queried (nested access vs. `$lookup`/application-level stitching)
- Whether the related model can be queried independently
- Performance characteristics (single-document reads vs. cross-collection joins)

The contract had no way to express this distinction.

## Problem

Two related questions:

1. **Aggregate roots**: How does the contract explicitly declare which models are ORM entry points (queryable directly), vs models that are only accessible through a parent?
2. **Relation strategies**: How does the contract distinguish between a relation that stores the related entity by reference (cross-collection/cross-table join) and one that stores it by embedding (nested in the parent document/JSON column)?

## Alternatives considered

### For aggregate roots

**Implicit from storage metadata** — the pre-existing approach. If a model has `storage.table` (SQL) or `storage.collection` (Mongo), it's an aggregate root.

Why we rejected it: This works for SQL where every model has a table, but breaks for Mongo. A polymorphic variant shares its parent's collection — it has `storage.collection` (or inherits it) but is not an independent entry point. An embedded model has no collection at all. More fundamentally, "which models are aggregate roots" was the one major concept in the contract that was derived rather than declared — an odd inconsistency for a contract designed to be machine-readable and self-describing.

**`strategy` label on the model** — each model declares its role: `"strategy": "root"`, `"strategy": "embedded"`.

Why we rejected it: This conflates domain identity with storage role. A model can be an entity regardless of how it's stored. `strategy` as an enum is not extensible and creates a false choice between "root" and "embedded" when these are orthogonal — a model's root-ness comes from appearing in `roots`, and its embedded-ness comes from how a parent relates to it. See [ADR 173](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) for why strategy labels are problematic in general.

**Move storage off the model, onto roots** — `roots` carries the table/collection name and field-to-column mappings.

Why we rejected it: This cleanly separates domain from storage at the JSON structure level, but breaks co-location for SQL. Field-to-column mappings need their table context nearby. See [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md) for the full co-location rationale.

### For relation strategies

**Implicit from model metadata** — if the related model has its own `storage.collection`/`storage.table`, the relation is a reference; if it has empty storage, it's embedded.

Why we rejected it: This forces consumers to inspect a different model's storage block to understand how a relation works. It also breaks when a model is embedded in one parent but referenced from another — the model's storage can't express both roles simultaneously. The strategy is a property of the *relationship*, not the model.

**Separate `embeddedModels` section** — a top-level list of models that are embedded, separate from `models`.

Why we rejected it: A model can have identity and lifecycle regardless of how it's stored. An `Address` with its own `_id` is an entity even when stored inside a User document. Putting it in a different section implies it's a different *kind* of thing, when really the only difference is where it lives. This also means the same model can't be both embedded and referenced from different parents.

## Decision

### Aggregate roots: explicit `roots` section

The contract has a top-level `roots` section that maps ORM accessor names to model names:

```json
{
  "roots": {
    "tasks": "Task",
    "users": "User"
  }
}
```

- **Presence in `roots` means the model is an aggregate root.** No inference required.
- **The root name controls the ORM accessor name.** If you want `db.tasks` (plural) but the model is `Task` (singular), the roots mapping handles it. Pluralization, casing, and naming are the emitter's concern.
- **Models not in `roots`** are accessed through relations (embedded) or through the base model (polymorphic variants).
- **Orphaned models** (not in `roots` and not referenced by any relation) are structurally valid but should produce an emitter warning.

### Relation strategies: `reference` vs `embed`

Each relation declares a storage strategy:

- **`"reference"`**: Cross-collection/cross-table relation. Resolved at query time via JOIN (SQL) or `$lookup`/application-level stitching (Mongo). Both models are independent — typically both are aggregate roots with their own storage units.
- **`"embed"`**: The related model is nested inside the parent's document (Mongo) or JSON column (SQL). The embedded model doesn't own a storage unit — its data lives within the parent's storage.

### Embedding is a property of the relation, not the model

The parent model's relation declares the embedding. The embedded model itself doesn't know *where* it's embedded — it has fields and relations, but its `storage` block is empty (`{}`).

Empty `storage` means "this model doesn't own a storage unit." Its data lives wherever a parent's `"strategy": "embed"` relation places it. This is analogous to how a polymorphic variant's storage can reference its parent's table — the location of the data is determined by the relationship, not the model itself.

This design means:

- **The same model can be embedded in different parents.** A `Comment` model could be embedded in both `Post` and `Video`, via two separate `"strategy": "embed"` relations.
- **Embedding strategy can change independently of the model.** If you later promote Comments from embedded to a separate collection, you change the parent's relation strategy to `"reference"` and add a `storage.collection` to Comment. The Comment model's fields don't change.

## Consequences

### Benefits

- **Aggregate roots are immediately visible** without inference. Machine-readable, human-readable, agent-friendly.
- **Relation strategies make embedding explicit.** Consumer libraries traversing the relation graph can distinguish embedded from referenced relations without inspecting storage metadata.
- **Embedding is composable.** A model can be embedded in multiple parents. An embedded model can be polymorphic. An aggregate root can have both embedded and referenced relations.

### Costs

- **Reference relation join details are now explicit.** A `"strategy": "reference"` relation carries `on: { localFields, targetFields }` to make both sides of the FK join unambiguous regardless of cardinality. A `"strategy": "embed"` relation carries `field` to identify the parent field that holds the embedded data.
- **Many-to-many without a join model** (Mongo: `student.courseIds: ObjectId[]`) doesn't fit cleanly into `reference` or `embed`. It may need a third strategy or a way to express "this relation is stored as an array of ObjectIds on the parent." Not yet designed.
- ~~**Value objects**~~: **Resolved.** Value objects are now a top-level `valueObjects` section in the contract. See [ADR 178 — Value objects in the contract](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md).

### Open questions

- ~~**Relation storage details**: What's the shape of family-specific join info on `reference` relations? What field on the parent holds an `embed` relation's data?~~ **Resolved**: Reference relations use `on: { localFields, targetFields }`. Embed relations use `field: string`.
- ~~**Many-to-many**: Does a junction table appear as a model? Probably not — it's storage machinery, not a domain entity. But the relation needs to reference it somehow.~~ **Resolved.** A junction table is a model; the relation's `through` resolves by model. See [ADR 267 — A table may hold columns its model does not map](ADR%20267%20-%20A%20table%20may%20hold%20columns%20its%20model%20does%20not%20map.md).
- **`nullable` on relations**: Can a reference relation be nullable (User may not have an assignee)? Where does this live — on the relation, on the field, or on the storage?
- ~~**Entity vs value object**~~: **Resolved.** Value objects are defined in a top-level `valueObjects` section, distinct from `models`. See [ADR 178 — Value objects in the contract](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md).

## Related

- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — why `model.storage` stays on the model
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md) — why strategy labels are problematic
- [ADR 177 — Ownership replaces relation strategy](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — supersedes the relation `strategy` design; `owner` on models replaces `strategy` on relations
- [design-questions.md § DQ #1](../../planning/mongo-target/1-design-docs/design-questions.md) — embedded documents resolution
- [cross-cutting-learnings.md § learning #1](../../planning/mongo-target/cross-cutting-learnings.md) — explicit aggregate roots
- [cross-cutting-learnings.md § learning #5](../../planning/mongo-target/cross-cutting-learnings.md) — models are entities, not just data descriptions
