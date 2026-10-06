# ADR 172 — Contract domain-storage separation

## At a glance

A User model in both families, showing the domain/storage separation. Note how `name` maps to a different column (`display_name`) in SQL — this is why SQL needs field-to-column mappings. Mongo doesn't have this indirection, so its storage block is just the collection name.

**SQL contract:**

```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "pg/int4@1" },
        "email": { "nullable": false, "codecId": "pg/text@1" },
        "name": { "nullable": true, "codecId": "pg/text@1" }
      },
      "relations": {},
      "storage": {
        "table": "users",
        "fields": {
          "id": { "column": "id" },
          "email": { "column": "email" },
          "name": { "column": "display_name" }
        }
      }
    }
  },
  "storage": {
    "tables": {
      "users": {
        "columns": {
          "id": { "dataType": "pg/int4", "nullable": false, "default": "autoincrement" },
          "email": { "dataType": "pg/text", "nullable": false },
          "display_name": { "dataType": "pg/text", "nullable": true }
        },
        "primaryKey": ["id"],
        "indexes": [],
        "foreignKeys": []
      }
    }
  }
}
```

**Mongo contract (same domain, different storage):**

```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "email": { "nullable": false, "codecId": "mongo/string@1" },
        "name": { "nullable": true, "codecId": "mongo/string@1" }
      },
      "relations": {},
      "storage": {
        "collection": "users"
      }
    }
  },
  "storage": {
    "collections": {
      "users": {
        "indexes": []
      }
    }
  }
}
```

The domain sections (`roots`, `fields`, `relations`) have the same structure — same TypeScript type across families. The `codecId` values differ (`pg/text@1` vs `mongo/string@1`), but that's values, not structure. Only `storage` differs structurally, and for Mongo it's minimal.

Notice the redundancy in the SQL contract: `name` appears in three places — `model.fields` (domain: what the field is), `model.storage.fields` (bridge: which column it maps to), and `storage.tables.users.columns` (database: the column's native type and constraints). Nullability also appears twice — as a domain concept on `model.fields` and as a database constraint on `storage.tables`. This is intentional; see [Three levels of the contract](#three-levels-of-the-contract) below.

## Context

The Prisma Next contract is a JSON document that describes an application's data model and its persistence. Before this decision, the SQL contract mixed domain and storage concerns in a single `fields` block:

```json
{
  "User": {
    "fields": {
      "email": { "column": "email", "codecId": "pg/text@1" }
    },
    "storage": { "table": "users" }
  }
}
```

Each field carried both its column mapping (a storage concern) and its type (a domain concern). This worked for SQL alone, but when we built the Mongo contract (M2 of the Mongo PoC), the structures couldn't converge:

- **SQL** has column indirection: the database schema defines tables and columns independently of the application. A field named `name` might map to a column called `display_name`. The contract needs to track both.
- **Mongo** has no column indirection: there's no enforced database schema. Document fields are whatever the application writes. There's nothing to indirect through.

We originally planned to keep `MongoContract` structurally parallel to `SqlContract` so extracting a shared base would be mechanical. The M2 implementation proved this isn't feasible — a mechanical extraction either produces something too loose to be useful, or forces one family into the other's shape.

## Problem

We need a contract structure that:

1. Supports both SQL and Mongo (and potentially future families) with a shared base
2. Keeps domain-level information (what the application models) readable independently of storage details
3. Preserves co-location of related information so the JSON isn't fragile
4. Doesn't force either family into the other's structural patterns

## Constraints

- **Co-location matters for SQL.** Field-to-column mappings need their table context nearby. If the table name is in a different section (e.g., a top-level `roots` entry), column references are left dangling — a reader or tool has to cross-reference a different section to understand what table those columns belong to.
- **Mongo has no column indirection.** Any structure that forces Mongo to mirror SQL's field → column → codec chain adds meaningless indirection.
- **The contract is emitted, not hand-written.** The emitter guarantees consistency, so redundancy (e.g., field names appearing in both `model.fields` and `model.storage.fields`) is acceptable. The cost is readability and JSON size, not correctness.
- **Machine-readability is a first-class goal.** The contract is designed to be read by agents, consumer libraries, and tooling. A consumer should be able to extract the domain model without understanding family-specific storage details.

## Decision

Separate the contract into a domain level (family-agnostic) and a storage level (family-specific), with `model.storage` as a scoped bridge between them. Refer to the [At a glance](#at-a-glance) example throughout — it shows the complete structure.

### The domain level is self-describing

Each model's domain section should give a reader a complete picture of the field — its name, its type, its nullability — without consulting the storage block. This is why `model.fields` is a record carrying `{ nullable: boolean, codecId: string }` rather than a bare string array.

**`nullable`** is a domain concept: "can a User have no email?" is a business rule that directly affects the TypeScript types the ORM infers (`string` vs `string | null`). Both families need it identically. `nullable` is always an explicit `boolean` (never omitted, never inferred from a default) so the contract is self-describing — a reader doesn't need to know "what's the default?" to understand a field. This also makes contract diffs clearer: `false → true`, not `undefined → true`.

**`codecId`** identifies a field's type. Describing a field without its type leaves the domain section incomplete. The codec identifier is the framework's way of expressing a field's type, and as a concept it is family-agnostic: every family uses codec identifiers, the identifier format is universal, and any consumer can read one without understanding the family's storage model. A Mongo contract's field says `"mongo/string@1"` and an SQL contract's says `"pg/text@1"` for the same domain concept — the *values* differ, but the *structure* is identical. **"Family-agnostic" describes the structure of the domain section, not its values.** The specific codec IDs *available* depend on framework composition (which families, targets, and extensions are loaded), but that is a composition concern, not a structural one.

### Three levels of the contract

The contract has three levels, each serving a different consumer:

1. **Domain level** (`roots`, `model.fields`, `model.relations`, `model.owner`, `model.discriminator`/`variants`) — what the application models. Family-agnostic structure. Consumed by the ORM for type inference, by agents for understanding the data model, by any tool that doesn't need to know about storage.
2. **Model storage bridge** (`model.storage`) — how domain fields connect to persistence. Sits on the model to preserve co-location. SQL carries field-to-column mappings because field names and column names can differ; Mongo carries only the collection name. `model.storage.fields` is available to Mongo should field name remapping ever be needed (e.g., `createdAt` → `_created_at`), but typically Mongo doesn't need it.
3. **Top-level storage** (`storage`) — the database schema itself. SQL: every table, every column with its native type, nullability constraint, default, plus indexes and foreign keys. Mongo: collection metadata (indexes, validators). Consumed by migration tooling, schema introspection, and DDL generation.

`model.storage` sits on the model (not in a separate section) to preserve co-location. In SQL, field-to-column mappings like `"name": { "column": "display_name" }` need their table context nearby — separating them would leave column references dangling. For a consumer that only cares about the domain, `model.storage` is a clearly scoped block to skip. The separation is logical, not physical.

### Redundancy between levels

In the SQL example above, `name` appears three times and nullability appears twice. This is the most common reaction to the structure — "isn't this redundant?" — so it's worth addressing directly.

The three levels describe the same data from different perspectives:


| Property        | Domain (`model.fields`)                                                      | Bridge (`model.storage`)                                 | Database (`storage.tables`)                                  |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| **Field name**  | `"name"` — the application's vocabulary                                      | `"name": { "column": "display_name" }` — maps to storage | `"display_name"` — the column name                           |
| **Nullability** | `"nullable": true` — can the domain field be absent? Drives TypeScript types | —                                                        | `"nullable": true` — does the column accept NULL? Drives DDL |
| **Type**        | `"codecId": "pg/text@1"` — the framework's type abstraction                  | —                                                        | `"dataType": "pg/text"` — the database type the codec represents |


These look redundant, but they answer different questions and serve different consumers. Domain nullability ("can a User have no name?") drives `string | null` in TypeScript. Storage nullability ("does the `display_name` column accept NULL?") drives `ALTER TABLE` statements. They usually agree, but they don't have to — a migration might change the column constraint while the domain model hasn't caught up yet. The emitter is responsible for keeping them consistent in normal operation.

The contract is emitted, not hand-written — redundancy doesn't create a maintenance burden. The cost is JSON size. The payoff is that each level is self-contained: a domain consumer never needs to reach into `storage.tables` to understand a field's type, and a migration tool never needs to parse `model.fields` to generate DDL.

For Mongo, the redundancy is much smaller. There's no column indirection, so `model.storage` is just a collection name. The top-level `storage.collections` section is sparse — typically just indexes — because MongoDB doesn't enforce a column schema.

### Other domain-level properties

- **`model.relations`** — connections to other models with cardinality and optional join details (see [ADR 174](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)).
- **`model.owner`** — declares aggregate membership: an owned model's data is co-located with its owner's storage (see [ADR 177](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)).
- **`model.discriminator`** + **`model.variants`** — optional polymorphism declaration (see [ADR 173](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)).

**Note — relations placement is a change from the current contract.** The current SQL emitter produces a top-level `relations` block as a sibling of `models`, keyed by model name (e.g., `contract.relations.user.posts`). The SQL ORM client consumes relations from this top-level block. This ADR moves relations onto each model (`model.relations`) because a model's relationships are part of its domain description — a reader should be able to understand a model completely without consulting a separate section. The current top-level placement was not a deliberate design choice; it diverged from the test fixtures (which use the nested form) during emitter development. The SQL emitter and ORM client will need to be updated to match.

## Consequences

### Benefits

- **Shared contract base is viable.** The domain level (`roots`, `models` with `fields`/`discriminator`/`variants`/`owner`, `relations`) is structurally identical between families. A `ContractBase` type can capture this, with `model.storage` as a generic/family-specific extension point.
- **Consumer libraries can be family-agnostic** for domain-level operations (listing models, traversing relations, finding aggregate roots).
- **Each family controls its own storage representation** without compromising the other.
- **The storage divergence is narrower.** Moving `codecId` to the domain level means Mongo's `model.storage` is just a collection name. The remaining divergence (SQL's field-to-column mappings) reflects a genuine structural difference.

### Costs

- **Redundancy across levels.** In SQL, field names, nullability, and type information appear at multiple levels (see [Redundancy between levels](#redundancy-between-levels)). Acceptable for an emitted artifact — the emitter guarantees consistency, and each level serves a different consumer.
- **Codec IDs in the domain section contain family-specific prefixes** (e.g. `mongo/`, `pg/`). A consumer reading just the domain section sees which family the contract is for. This is a minor information leak, but it doesn't affect structure — the domain section's TypeScript type is identical across families.

### What this requires

**Implemented in this PR (Mongo PoC):**
- `MongoContract` adopts the domain-storage separation with `model.fields` carrying `{ nullable, codecId }`, `model.relations` as plain graph edges (cardinality + optional join details), and `model.storage` scoped per model.
- `validateContractDomain()` validates domain-level invariants (roots, variants, relations, discriminators) in a family-agnostic way.
- `validateMongoStorage()` validates Mongo-specific storage rules.

**Status:** All follow-ups are implemented. `SqlContract` uses domain-level `model.fields` with `{ nullable, codecId }` and model-keyed `model.relations`. The SQL emitter, ORM client, and all consumers have been migrated. `ContractBase` was superseded by `Contract<TStorage, TModels>` — see [ADR 182](ADR%20182%20-%20Unified%20contract%20representation.md).

## Related

- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 174 — Aggregate roots and relation strategies](ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [ADR 177 — Ownership replaces relation strategy](ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — `owner` on models replaces `strategy` on relations
- [Data Contract subsystem doc](../subsystems/1.%20Data%20Contract.md) — contract structure and semantics
- [MongoDB Family subsystem doc](../subsystems/10.%20MongoDB%20Family.md) — Mongo contract, ORM, and execution pipeline

