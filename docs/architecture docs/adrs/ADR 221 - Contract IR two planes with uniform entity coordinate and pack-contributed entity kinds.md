# ADR 221 — Contract IR is structured as two planes (`domain` and `storage`) with a uniform entity coordinate and a pack-contributed entity-kind mechanism

**Status:** Accepted
**Date:** 2026-05-20

> **Note:** value objects have since moved out of the domain plane. They are storage entities, at `storage.namespaces.<ns>.entries.valueObject`, and a domain field refers to one by coordinate ([ADR 309](ADR%20309%20-%20Value%20objects%20are%20storage%20entities%2C%20and%20a%20discriminator%20column%20names%20a%20value%20set.md)). The domain `valueObjects` key shown below no longer exists.

---

## A concrete example

Here is a Postgres contract with two namespaces — `auth` and `public` — in the shape this ADR establishes:

```jsonc
{
  "target": "postgres",
  "targetFamily": "sql",

  "domain": {
    "namespaces": {
      "auth": {
        "models":       { "User": { "fields": { /* … */ }, "relations": { /* … */ } } },
        "valueObjects": {}
      },
      "public": {
        "models": {
          "Post": {
            "relations": {
              "author": { "to": { "namespace": "auth", "model": "User" } }
            }
          }
        },
        "valueObjects": {}
      }
    }
  },

  "storage": {
    "storageHash": "…",
    "types": {
      "Embedding1536": { /* doc-scoped codec alias — SQL family plane-level only */ }
    },
    "namespaces": {
      "auth":   { "tables": { "user": { /* columns */ } } },
      "public": {
        "tables": { "post": { /* columns, foreign keys */ } },
        "enum":   { "user_role": { "kind": "postgres-enum", "values": ["admin", "member", "guest"] } }
      }
    }
  },

  "roots": { "user": { "namespace": "auth", "model": "User" } }
}
```

Two things to notice, because the rest of this document builds on them.

**Everything lives under one of two planes.** `domain` holds the application concepts the user defines — models and value objects. `storage` holds the family-owned persistence projection — tables for SQL, collections for Mongo, plus any kind a target pack contributes (here, Postgres's `enum`). Each plane is shaped `{ <planeHash>?, …plane-level metadata?, namespaces: { <namespaceId>: … } }`. Under `namespaces`, each namespace envelope carries entity *kinds*; under each kind, entity *names*. Doc-scoped codec aliases (here, `Embedding1536`) live on the SQL storage plane as a `types` sibling of `namespaces` — not on the framework domain plane.

**Every entity has the same four-part address.** The `User` model is `(domain, auth, models, User)`. The enum is `(storage, public, enum, user_role)`. The `post` table is `(storage, public, tables, post)`. This tuple — `(plane, namespaceId, entityKind, entityName)` — is the single way anything in the IR is identified. Because the namespace is part of the address, `auth.User` and `public.User` are two distinct models, exactly the way `auth.user` and `public.user` are two distinct tables.

---

## Decision

The contract IR is built on five structural commitments:

1. **Two planes.** Entity content lives under exactly `domain` (application concepts) and `storage` (family-owned persistence). Nothing sits flat at the contract root.
2. **One uniform plane envelope:** each plane is `{ <planeHash>?, …metadata?, namespaces: { <namespaceId>: <namespace envelope> } }`. The `namespaces` segment separates plane-level metadata (the content-addressed hash; on SQL storage only, the family-owned doc-scoped `types` map) from the open namespace map. The logical entity path is `<plane>.namespaces.<namespaceId>.<entityKind>.<entityName>`. The framework domain plane has no `types` member — codec aliases and native type registrations belong on the SQL storage plane.
3. **One canonical address:** the entity coordinate `(plane, namespaceId, entityKind, entityName)`. Every consumer — migration diffing, planner disjoint calculation, validator collision checks, cross-plane references — identifies entities by this tuple, exposed through a polymorphic free-function walk `elementCoordinates(plane)`.
4. **Cross-references are object pairs** — `{ namespace, model }` (or `{ namespace, table, columns }` for storage-plane references) — never dot-qualified strings, never implicit same-namespace resolution.
5. **Target packs contribute entity kinds** through a single framework-level descriptor surface, keyed on the kind's discriminator. The framework `Namespace` interface itself carries only `{ id, kind }`; family-specific slots live on family-shaped namespace types.

The sections below build up the reasoning behind each commitment.

---

## Why two planes

The contract serves two audiences that pull in different directions. Application code thinks in *models and relations* — target-agnostic concepts a user defines once and runs anywhere. The database thinks in *tables, collections, enums* — family- and target-specific persistence projections. Holding both in one flat namespace forces a choice every time a new concept is added: does it follow the application shape or the storage shape?

Splitting them into `domain` and `storage` makes the framework/family ownership boundary structural rather than conventional. Framework code that reaches for `storage.<…>.tables` is naming a SQL idiom it has no business knowing — and the shape makes that mistake visible. The same holds symmetrically: a target pack reaching into `domain` from framework-layer code is the same kind of layering violation.

The split also fixes a realism gap. With application concepts flat at the root, a model lookup is global: a user can model `auth.User` and `public.User` as distinct tables but cannot model them as distinct models, because the name collides. Putting both planes behind namespace IDs makes collision-realism uniform — the multi-tenant pattern of an auth-owned `User` alongside an application-defined `User` works at every layer, not just storage.

This is less a new idea than a recognition. Storage was already an independently-hashed, family-owned segment of the contract (see [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)) — structurally a plane in everything but name. This ADR promotes that recognition into the IR shape and gives application content a peer name.

We chose `domain` for the application plane because it matches how the boundary is naturally described (the "storage domain" versus the "application domain") and aligns with domain-model vocabulary. It reads cleanly in editor auto-complete, where `application` is bulky and overloaded, `logical`/`physical` would cost an unnecessary rename of `storage`, and `schema` collides with PSL schemas, SQL schemas, and JSON schema all at once.

## One uniform shape, one address

Both planes use the identical indexing pattern, so a consumer learns it once and walks either plane the same way:

```text
contract
├── domain
│   └── namespaces
│       └── <namespaceId>
│           ├── models       → { <ModelName>       → ContractModel }
│           └── valueObjects → { <ValueObjectName> → ContractValueObject }
└── storage
    ├── storageHash
    ├── types?                 → doc-scoped codec aliases (SQL family only; not on framework domain)
    └── namespaces
        └── <namespaceId>
            ├── tables       → { <table_name>      → StorageTable }            // SQL family built-in
            ├── collections  → { <collection_name> → MongoCollection }         // Mongo family built-in
            └── enum         → { <enum_name>       → PostgresEnumStorageEntry } // Postgres pack-contributed
```

An earlier candidate dropped the `namespaces` segment and keyed namespace IDs directly under each plane — `storage.storageHash` alongside `storage.auth.tables`, and the same for `domain`. That looked like one fewer nesting level, but it mixes a **closed** set of plane-level metadata fields (the hash; on SQL storage, doc-scoped `types`) into the **open** namespace map. Every consumer then needs a denylist of reserved keys, structural sniffing to distinguish metadata from namespaces, and collision guards when a namespace id collides with a metadata name. Keeping `namespaces` as an explicit segment is the boundary between those two maps; walkers iterate `plane.namespaces` and never confuse `types` or `storageHash` with a namespace id.

The coordinate `(plane, namespaceId, entityKind, entityName)` is the payoff. Without a single canonical address, every consumer reinvents what *"the same entity"* means — and the reinventions disagree. A migration planner deciding whether two operations touch the same entity needs a definition of identity that the validator's collision check and the planner's diff also share; if one consumer thinks a name alone identifies an entity and another thinks `(namespace, name)` does, the disjoint calculation is silently wrong and ships as a bug. Pinning one tuple that every consumer uses removes the class of disagreement.

The `kind` is part of the address, not derived from the entity instance's runtime type. This matters in two places: consumers that diff raw JSON envelopes (without rehydrating to classes) can still dispatch, and two packs that happen to use overlapping name conventions for different kinds stay distinct.

The `plane` axis rides on the coordinate rather than being split across two separate per-plane coordinate types. This lets a cross-plane consumer address either side through one tuple type — most importantly the directional reference invariant (a domain entity may reference a storage entity, but not the reverse — the storage plane must remain independently consumable by the migration planner/runner). That invariant is enforced by a dedicated validator; the coordinate simply carries the axis the validator reads.

### The walk is a free function, not an interface method

The framework exposes the coordinate stream as a free function, `elementCoordinates(plane)`, that yields one tuple per entity by iterating each namespace's own-enumerable, entity-bearing properties: for each such property, the property name *is* the entity kind, and each entry yields one coordinate. The scalar `id` is skipped; `kind` is non-enumerable on namespace instances and skips itself. The walk needs no table of which kinds a namespace may hold — hydration has already enforced the structural shape, so the walk's job is enumeration, not validation. The invariant it relies on (a namespace concretion carries `id`, a non-enumerable `kind`, and entity-kind slot maps, and nothing else) is documented on the `Namespace` interface.

Making this a free function rather than a method on `Storage` is deliberate and load-bearing. A required method on `Storage` would propagate into every structural consumer of `Contract<SqlStorage>` — most consequentially the emitted `contract.d.ts` files, which print storage as plain object types with no method members. Every one of those would fail to satisfy the interface, and the content-addressed hash of every committed contract would have to change to carry the method. A free function consumes any `Storage`-shaped value and leaves structural assignability — and therefore the emitted artefacts and their hashes — untouched.

## Cross-references as object pairs

Every cross-namespace reference is an object pair:

```jsonc
{ "namespace": "auth", "model": "User" }                          // relation.to, model.base, roots[*]
{ "namespaceId": "auth", "tableName": "user", "columns": [...] }  // foreign-key references
```

This matches the encoding the foreign-key target shape already uses, so there is one rule for every reference site. The alternative — a dot-qualified string like `"auth.User"` — is cheaper to read but expensive at every consumer: it forces a split-on-dot, forbids dots in entity names, and invites escape-character edge cases. Allowing an implicit same-namespace form (`"User"` resolves locally; cross-namespace uses the pair) optimises the common case at the cost of an asymmetric shape every consumer must handle two ways. The object pair is uniform and mechanical. Users never type it: the authoring DSL takes entity handles (`rel.belongsTo(User, …)`), so the pair is purely an on-the-wire encoding.

## Pack-contributed entity kinds

The `enum` slot in the opening example is not built into the framework. It is contributed by the Postgres pack through the framework-level `AuthoringContributions.entityTypes` surface. A descriptor on that surface carries three things for a kind: the IR-class factory, a serializer hydration callback, and a validator-schema fragment. The descriptor's `discriminator` — the kind's `kind:` literal, e.g. `'postgres-enum'` — is the **single key** that both the family's hydration registry and the family validator's composition surface look the kind up by.

There is no separate "slot key" field. The property name where a kind's entries land on the namespace envelope (`enum`) is purely a hydration-iteration concern: the family base knows its own built-in slots (`tables` for SQL, `collections` for Mongo) and hydrates those through hardcoded construction, then dispatches every *other* entity-bearing property's entries through the discriminator-keyed registry. One key, one registry.

**Slot keys are named by kind essence, in the singular** — `enum`, `policy`, `role`, `materializedView` — not by the contributing pack (`postgresEnums`) and not by plural-collection convention (`enums`). The slot key then reads as the entity kind itself: `for (const [name, entry] of Object.entries(ns.enum))`. A second target that emulated enums would contribute to the same `enum` slot under a different discriminator. The singular form also leaves room for a future convention in which the built-in plural slots (`tables`, `collections`) are renamed to match; pack contributions written today would not need to change when that happens.

The built-in kinds (`tables`, `collections`) stay hardcoded inside their family packs rather than going through the descriptor mechanism. They guarantee a stable family-shape contract for consumers, and routing them through the descriptor surface would touch every framework consumer to deliver nothing but conceptual symmetry. The result is a dual surface — hardcoded built-ins alongside descriptor-driven contributed kinds — and that is a deliberate, acceptable trade. The descriptor mechanism earns its keep on *extensibility*, not on retrofitting surfaces that already work.

The mechanism's value is that it satisfies two requirements at once: a kind is contributed at the framework level (so authoring tools — the PSL interpreter, the TS DSL, the emitter — all see it) *without* any target-specific symbol appearing in the framework or in sibling-target packages. A cheaper-looking option — keep a kind hardcoded but move the hardcode from the framework into the pack — fails the second requirement, because the slot name still leaks into the framework's authoring-tool dispatch.

**Kinds the framework defines or reads.** One storage kind is not contributed but defined by the framework, because domain fields refer to it: `valueObject`. The framework reads it by slot key, validates a value object's fields against one schema that both families use, and types it in `contract.d.ts`. Where a value object member names a value set, the framework also reads the `valueSet` slot by key, to check that the reference resolves; the families define the value set entity. Each family still registers a descriptor and an IR class for both kinds. See [ADR 309](ADR%20309%20-%20Value%20objects%20are%20storage%20entities%2C%20and%20a%20discriminator%20column%20names%20a%20value%20set.md).

## The `Namespace` interface

The framework's `Namespace` interface declares only `{ id, kind }`. Family-specific slots live on family-shaped namespace types — `SqlNamespace = Namespace & { tables: …, [...packContributedSlots] }`, `MongoNamespace = Namespace & { collections: … }`. The framework type is honest about what the framework actually knows.

IR constructors accept only fully-constructed `Namespace` instances — no plain-object normalisation, no default-singleton injection, no `instanceof` brand checks. Convenience belongs in the two layers that own it: the authoring layer, where user input becomes IR, and the serialization layer, where IR becomes JSON and back (with class identity resolved by the family serializer from `(targetFamily, target)`, position, and the contributed-kind registry).

---

## Consequences

**The IR is symmetric.** Collision-realism applies uniformly across planes, generic walkers are possible because every consumer reaches for `contract.<plane>.namespaces.<ns>.<entityKind>.<entityName>`, and a flotilla of ad-hoc identity helpers (per-name global scans, mixed `(namespace, name)` pairs, string-keyed lookups, duck-typed element walks) collapses into one coordinate.

**The framework/family boundary is visible.** `domain` is framework-shaped; `storage` is family-owned. Layering violations show up as code naming the wrong plane's idioms.

**Pack-contributed kinds are first-class.** Adding RLS policies, roles, sequences, or materialised views is one descriptor registration; the framework dispatches generically. A namespace-aware DSL surface (`db.auth.User`) becomes cheaper too, because it reads `domain.namespaces.auth.models.User` directly with no flat-by-name collapse to invert.

**The contract shape — and its hashes — are part of the public contract.** Both `storageHash` and `profileHash` are content-addressed, so any change to the IR shape changes every existing contract's hashes; the emitted `contract.d.ts` shape changes with it, and downstream TypeScript that walks the IR programmatically (as opposed to authoring through handles) sees the new shape. Authoring through DSL handles is unaffected.

**The dual surface for entity kinds is a standing trade.** Built-ins are hardcoded; contributed kinds go through the descriptor. A contributor has to know which surface their work belongs on. This is accepted in exchange for not rewriting stable built-in handling.

---

## Alternatives considered

**Status quo — keep application concepts flat at the root.** Rejected. The collision-realism gap (`auth.User` + `public.User` blocked) and the typology defect (framework code naming family idioms) compound: every new feature must decide whether to follow the storage namespace shape or the flat model shape.

**Per-axis namespacing** (`contract.models[ns][name]`, `contract.valueObjects[ns][name]`, …). Rejected. Visually noisy at the top level and with no family-ownership boundary; "everything in namespace X" still walks each axis independently.

**A single per-namespace container** (`contract.namespaces[ns].{ models, tables, types, … }`). Rejected. Couples domain and storage into one bag and loses the ownership boundary — family slots sit next to framework slots under the same key, blurring which layer owns what.

**Three planes** (`domain` + `storage` + a shared bridge for cross-plane references). Rejected. Over-built; the "codecs straddle the line" intuition is handled by object-pair references, not by a third plane.

**Dot-qualified strings for cross-references** (`relation.to: "auth.User"`). Rejected. Cheap to read, expensive at every consumer (split-on-dot, dots forbidden in names, escape edge cases).

**Implicit same-namespace with explicit override.** Rejected. Optimises the common case but forces every consumer to handle two reference shapes.

**A per-descriptor slot-key field.** A descriptor could carry an explicit field naming the namespace property its entries land on, with the family serializer keeping a second registry keyed on that slot key alongside the discriminator-keyed one, plus a reserved-slot-key list and a slot-name collision validator. Rejected. The slot key carries no information the discriminator does not already carry for every entry the registry hydrates; the parallel registry doubles the hydration surface for no invariant the single registry lacks; and the reserved-slot-key list re-encodes at the framework layer what structural hydration already enforces. The chosen shape uses one descriptor key (the discriminator) for both registries, with no separate slot-key field, parallel registry, or collision validator.

**A single generic `storage.<ns>.entities.<kind>.<name>` slot.** Rejected. Kinds would carry their discriminator and the framework would walk one uniform map — but the typed `contract.d.ts` emission story is lost, because every consumer of the emitted types would have to narrow on the discriminator instead of reading the kind from the type path.

**Retrofit `tables` / `collections` onto the descriptor mechanism.** Rejected as cost-disproportionate. The built-ins work; the descriptor mechanism's value is extensibility, not uniformity for its own sake.

**A `(namespaceId, entityName)` coordinate, with kind derived from the instance type.** Rejected. Loses uniqueness when packs use overlapping name conventions and couples the coordinate to runtime class identity, so consumers diffing from JSON cannot dispatch without rehydrating first.

**A three-segment string ID** (`auth/postgres-enum/user_role`) as the coordinate. Rejected for the same separator-collision reasons as dot-qualified-string references.

---


**Namespace keys directly under each plane** (`{ storageHash, types?, auth: {…}, public: {…} }` with no `namespaces` segment). Rejected. Mixes plane-level metadata into the namespace key-space (heterogeneous map). Forces reserved-key denylists, structural namespace sniffing, and collision guards; leaks SQL-family `types` into framework walking code when domain and storage share the flat pattern.

## References

- [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [Architecture Overview](../../Architecture%20Overview.md)
