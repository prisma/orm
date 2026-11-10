# ADR 177 — Ownership replaces relation strategy

## At a glance

A User model with a referenced relation (Post) and an owned model (Address). Address declares `"owner": "User"` — a domain fact. The relation from User to Address is a plain graph edge with no storage annotation. The parent's `storage.relations` maps the relation to a physical location.

**Mongo contract:**

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
          "to": "Post", "cardinality": "1:N",
          "on": { "localFields": ["id"], "targetFields": ["authorId"] }
        },
        "addresses": { "to": "Address", "cardinality": "1:N" }
      },
      "storage": {
        "collection": "users",
        "relations": {
          "addresses": { "field": "addresses" }
        }
      }
    },
    "Post": {
      "fields": {
        "id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "title": { "nullable": false, "codecId": "mongo/string@1" },
        "authorId": { "nullable": false, "codecId": "mongo/objectId@1" }
      },
      "relations": {
        "author": {
          "to": "User", "cardinality": "N:1",
          "on": { "localFields": ["authorId"], "targetFields": ["id"] }
        }
      },
      "storage": { "collection": "posts" }
    },
    "Address": {
      "owner": "User",
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

> Every model's `storage` now also records each field's stored name in `fields`, embedded models included (see [ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). This example predates that and leaves `fields` out.

**SQL contract (same domain, different storage):**

```json
{
  "roots": {
    "users": "User",
    "posts": "Post"
  },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/int4@1" },
        "email": { "nullable": false, "codecId": "pg/text@1" }
      },
      "relations": {
        "posts": {
          "to": "Post", "cardinality": "1:N",
          "on": { "localFields": ["id"], "targetFields": ["authorId"] }
        },
        "addresses": { "to": "Address", "cardinality": "1:N" }
      },
      "storage": {
        "table": "users",
        "fields": {
          "id": { "column": "id" },
          "email": { "column": "email" }
        },
        "relations": {
          "addresses": { "column": "address_data" }
        }
      }
    },
    "Post": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/int4@1" },
        "authorId": { "nullable": false, "codecId": "pg/int4@1" }
      },
      "relations": {
        "author": {
          "to": "User", "cardinality": "N:1",
          "on": { "localFields": ["authorId"], "targetFields": ["id"] }
        }
      },
      "storage": {
        "table": "posts",
        "fields": {
          "id": { "column": "id" },
          "authorId": { "column": "author_id" }
        }
      }
    },
    "Address": {
      "owner": "User",
      "fields": {
        "street": { "nullable": false, "codecId": "pg/text@1" },
        "city": { "nullable": false, "codecId": "pg/text@1" }
      },
      "relations": {},
      "storage": {}
    }
  }
}
```

Three things to notice:

1. **`owner: "User"` is on the model, not the relation.** Address declares where it belongs — a domain fact about the model itself. This mirrors how `base` declares polymorphic specialization.
2. **Relations are plain graph edges.** `{ "to": "Address", "cardinality": "1:N" }` — no `strategy`, no storage annotation. The relation describes the graph structure, nothing more.
3. **`storage.relations` maps owned relations to physical locations.** In Mongo, Address data lives in the `addresses` field of User's document. In SQL, it lives in the `address_data` JSONB column on the `users` table. This parallels how `storage.fields` maps scalar fields to columns.

## Context

[ADR 174](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) introduced `"strategy": "reference" | "embed"` on relations to distinguish between cross-collection references and embedded sub-documents. This solved the problem of expressing where related data physically lives, but the design had several issues that became apparent during further modelling:

- **`strategy` reads as an instruction, not a fact.** One of the contract's design principles is that it describes facts about the data, not instructions for the ORM. "Use the embedding strategy" is prescriptive; "Address is part of User" is descriptive.

- **Embedding was on the wrong object.** "Address is a component of User" is a fact about Address, not about the edge from User to Address. The relation from User to Address is just a graph edge — the fact that Address lives inside User's storage is a property of Address itself.

- **The relation mixed domain and storage concerns.** `strategy: "embed"` is really saying two things at once: a domain fact (Address belongs to User) and a storage fact (Address data is co-located with User's data). These belong in different places per the domain-storage separation principle ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)).

- **The physical storage location was missing.** `strategy: "embed"` said "this relation is embedded" but didn't say *where* — which field in the parent document holds the embedded data, or which JSONB column in the SQL table. This information was left as an open question.

## Problem

How should the contract express that a model's data lives inside another model's storage, in a way that:

1. States a domain fact (component membership) separately from storage details (physical location)
2. Is self-describing on the model, not just on the relation
3. Tells the ORM where to find the data in the parent's storage

## Decision

### `owner` on the model declares component membership

An owned model declares its owner with `"owner": "ModelName"`:

```json
"Address": {
  "owner": "User",
  "fields": { ... },
  "storage": {}
}
```

This is a domain-level fact: "Address is a component of User." It means:

- Address has no independent storage — its `storage` block is empty.
- Address data is co-located with its owner's storage. In Mongo, this means an embedded document. In SQL, this means a JSONB column or denormalized columns on the owner's table.
- Address is not an ORM entry point — it doesn't appear in `roots`.
- Address's lifecycle is bound to User's. Deleting a User deletes its Addresses.

The pattern mirrors `base` for polymorphism: just as `Bug` says `"base": { "model": "Task", "namespace": "public" }` to declare it specializes Task, `Address` says `"owner": "User"` to declare it belongs to User.

### `strategy` is removed from relations

Relations become plain graph edges describing connections between models:

```json
"relations": {
  "posts": {
    "to": "Post", "cardinality": "1:N",
    "on": { "localFields": ["id"], "targetFields": ["authorId"] }
  },
  "addresses": { "to": "Address", "cardinality": "1:N" }
}
```

A relation to a model that has `owner` (Address) carries no `on` block — there's no foreign key join for co-located data. A relation to an independent model (Post) carries `on` with join details, as before. The distinction between "owned" and "referenced" is derivable from the target model's `owner` property, but the domain-level relation doesn't need to state it.

### `storage.relations` maps owned relations to physical locations

The parent's storage section gains a `relations` block that maps relation names to physical locations, parallel to how `storage.fields` maps field names:

```json
"storage": {
  "collection": "users",
  "fields": {
    "id": { "field": "_id" },
    "email": { "field": "email" }
  },
  "relations": {
    "addresses": { "field": "addresses" }
  }
}
```

In Mongo, `"field": "addresses"` means the `addresses` array in the document. In SQL, `"column": "address_data"` means the JSONB column on the table.

This solves the open question from ADR 174 about where embedded data physically lives — it's in the parent's storage mapping, alongside the field mappings.

### Three ways a model declares its place in the graph

| Declaration | Meaning | Example |
|---|---|---|
| Present in `roots` | "I am an ORM entry point" | `"roots": { "users": "User" }` |
| `owner` | "I belong to this model's aggregate" | `"owner": "User"` |
| `base` | "I specialize this model" | `"base": { "model": "Task", "namespace": "public" }` |

All three are domain facts, stated on the model itself, self-describing.

## Consequences

### Benefits

- **Domain-storage separation is clean.** `owner` is a domain fact. `storage.relations` is a storage mapping. They're in different sections, serving different consumers.
- **Relations are simple.** Graph edges with `to`, `cardinality`, and optional `on`. No storage annotations on domain-level relations.
- **Self-describing models.** Looking at Address, you immediately see `"owner": "User"` — you don't need to search other models' relations for a `strategy: "embed"` annotation to understand where Address belongs.
- **The contract states facts, not instructions.** "Address is owned by User" describes a relationship. "Use the embedding strategy" prescribes behavior.
- **Storage location is explicit.** `storage.relations` tells the ORM exactly which field/column holds the embedded data, solving the open question from ADR 174.

### Costs

- **A model can only have one owner.** This is intentional — it aligns with the principle that each model has one canonical storage location. If Address is owned by User, its data lives in User's storage, period. The same Address *type* could theoretically be reused (as a value object), but that's a separate concept not yet designed.
- **Supersedes ADR 174's relation strategy design.** Existing contract examples, design docs, and the Mongo PoC implementation use `strategy: "reference" | "embed"`. These need updating.

### What this changes from ADR 174

| Aspect | ADR 174 | This ADR |
|---|---|---|
| Where embedding is declared | On the relation: `"strategy": "embed"` | On the model: `"owner": "User"` |
| Physical location of embedded data | Open question | `storage.relations` on the parent |
| Relation shape | `{ to, cardinality, strategy, on }` | `{ to, cardinality, on? }` — no `strategy` |
| `"strategy": "reference"` | Explicit on reference relations | Absent — references are the default (relation has `on`) |

### Open questions

- ~~**Nested ownership.**~~ **Resolved.** An owned model can itself own other models (e.g., User → Order → LineItem, where Order is `owner: "User"` and LineItem is `owner: "Order"`). Each owned model in the chain uses `storage.relations` to map where its children go within its subdocument. Self-referential ownership (Comment owns Comment) is correctly rejected as circular — the anchor must be a non-self owner. See [design-questions.md § Q19](../../planning/mongo-target/1-design-docs/design-questions.md#19-self-referential-models).
- ~~**Value objects vs owned entities.**~~ **Resolved.** An owned Address with an `_id` is an entity (in `models` with `owner`). An Address without identity is a value object (in `valueObjects`). See [ADR 178 — Value objects in the contract](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md).

## Related

- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — domain/storage principle this ADR builds on
- [ADR 174 — Aggregate roots and relation strategies](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — superseded relation strategy design
- [design-questions.md § Q18](../../planning/mongo-target/1-design-docs/design-questions.md) — the discussion that led to this decision
