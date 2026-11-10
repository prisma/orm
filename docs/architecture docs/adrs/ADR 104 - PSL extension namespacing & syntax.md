# ADR 104 — PSL extension namespacing & syntax

Historical note: the current SQL PSL provider exposes extension-owned storage types via constructor expressions such as `pgvector.Vector(...)`. The attribute-based examples below describe the generic namespaced extension syntax direction captured in this ADR.

**Amended by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md) (2026-10-21):** a named type in `types { ... }` is authoring shorthand. The interpreter expands it into each column that uses it, and the contract stores each column's codec and parameters inline; it stores neither the named type nor a `typeRef`. "Named storage type for reuse" therefore describes PSL syntax only, not storage. Under "Enforceable coupling", the checks run on each expanded column, so an attribute on a named type is checked once, at the declaration.

## Context

We need a stable way for database and domain feature packs to extend PSL while keeping the emitted data contract deterministic and code-free. Examples include vector types and operators (pgvector), geospatial types and functions (PostGIS), and custom index strategies.

Extensions must be discoverable, versionable, and enforceable across local builds, CI, and hosted preflight, without executing arbitrary code during contract emission.

## Problem

- PSL today lacks formal namespacing for third-party attributes and blocks
- Without namespacing, collisions with core attributes and between packs are likely
- Extension behavior must round-trip into a canonical `contract.json` under a well-defined location for agents and tooling to consume
- Emit must remain deterministic and safe, with strict validation and capability gating per target profile

## Decision

Introduce a namespaced PSL extension syntax and mapping rules that produce deterministic contract JSON under `contract.extensions.<namespace>` and optional capabilities claims.

**Composition constraint:** PSL does not “activate” extensions or carry extension configuration. Extension packs are composed via `prisma.config.ts`, which determines which namespaces/attributes exist. The emitter/interpreter then **infers** the PSL authoring surface (valid namespaces, attributes, and argument schemas) from the composed pack’s existing manifest/metadata. PSL remains versionless and purely declarative.

The emitter validates extension usage against pack-provided (or core-convention) schemas and capability gates and refuses to emit on violations.

## Details

### Namespacing rules

- A namespace is a lowercase identifier matching `^[a-z][a-z0-9_-]*$`
- A pack owns exactly one namespace and must not collide with core or another pack
- Field attribute form: `@<ns>.<attr>(args?)`
- Model attribute form: `@@<ns>.<attr>(args?)`

### Syntax examples

#### Field with a namespaced type hint and config

```prisma
model Document {
  id      Int     @id @default(autoincrement())
  content String
  embedding Bytes  @vector.column(length: 1536, distance: cosine)
}
```

#### Named storage type for reuse (avoids per-field attributes)

This pattern keeps the parser simple (no type-parameter syntax) while preserving an enforceable connection between a column’s declared type and its parameters by moving the parameters into a named type instance:

```prisma
types {
  Embedding1536 = Bytes @vector.column(length: 1536)
}

model Document {
  id        Int            @id @default(autoincrement())
  embedding Embedding1536?
}
```

#### Model-level index using extension namespace

```prisma
model Place {
  id   Int     @id @default(autoincrement())
  geom Bytes   @postgis.geometry(type: "POINT", srid: 4326)

  @@postgis.gistIndex(fields: [geom])
}
```

### Mapping to the data contract

- All extension data is emitted under `contract.extensions.<namespace>` and never mixed into core tables unless explicitly mapped by the pack's schema
- Core storage mapping remains under `tables.*` with standard columns, constraints, and indexes
- Extension-specific column metadata may be referenced by core nodes via stable references, e.g. a column `meta.ext.pgvector = { length: 1536, distance: "cosine" }` when the pack declares such links in its schema

### Emitted shape example

```json
{
  "target": "postgres",
  "coreHash": "…",
  "tables": {
    "document": {
      "columns": {
        "id": { "type": "int4", "nullable": false, "pk": true },
        "content": { "type": "text", "nullable": false },
        "embedding": {
          "type": "bytea",
          "nullable": false,
          "meta": {
            "ext": {
              "vector": { "length": 1536, "distance": "cosine" }
            }
          }
        }
      }
    }
  },
  "extensions": {
    "vector": {
      "version": "1.2.0",
      "columns": {
        "document.embedding": { "length": 1536, "distance": "cosine" }
      },
      "indexes": []
    },
    "postgis": {
      "version": "3.4.1",
      "types": { "place.geom": { "type": "POINT", "srid": 4326 } },
      "indexes": [{ "table": "place", "fields": ["geom"], "method": "gist" }]
    }
  },
  "capabilities": {
    "postgres": { "lateral": true, "jsonAgg": true },
    "vector": { "ivfflat": true, "hnsw": false },
    "postgis": { "gist": true }
  }
}
```

### Versioning model

- Versions are pinned in `prisma.config.ts` where packs are composed (e.g. `extensions: [pgvector]`)
- Attributes omit version for readability and are validated against the composed/pinned pack version
- The emitter records the resolved version under `contract.extensions.<namespace>.version`
- Version changes are reflected in the contract hash and capability surface

### Determinism and canonicalization

- Attribute arguments must be pure data shapes validated by pack schemas
- Emitter canonicalizes maps by key sort, normalizes number formats, and preserves declared array ordering unless the schema marks arrays as sets
- No code execution is allowed during emission
- See ADR 010 for canonicalization rules

### Validation and capability gating

- The emitter validates argument shapes for `@<ns>.<attr>` and `@@<ns>.<attr>` (either via pack-provided schemas or core conventions where applicable)
- The emitter refuses to emit if:
  - namespace is unknown or the corresponding pack is not composed in config
  - attribute is unknown or deprecated and not allowed
  - schema validation fails
  - target adapter reports missing capabilities required by the extension for the current profile
- Capability checks use ADR 065 to query adapter and pack capability sets

#### Enforceable coupling (avoid “metadata drift”)

Extension attributes attach **extra meaning** to a field (for example, “this `Bytes` column is a pgvector `vector(1536)`”). If an attribute is applied to an incompatible base type, the schema can look valid at a glance but produce confusing runtime behavior or incorrect storage assumptions. To keep authoring predictable, extension attributes are interpreted with **strict, enforceable invariants**. Example (pgvector):

- `@vector.column(...)` is only valid on compatible base types (e.g. `Bytes`) or on named type instances defined in `types { ... }` whose base is compatible.
- If applied to an incompatible base type, emission fails with a targeted diagnostic.
- If the pack is not composed in `prisma.config.ts`, the namespace is unknown and emission fails.

### Error taxonomy

- `EMIT_EXT_UNKNOWN_NAMESPACE`
- `EMIT_EXT_UNKNOWN_ATTRIBUTE`
- `EMIT_EXT_SCHEMA_VIOLATION`
- `EMIT_EXT_VERSION_MISSING`
- `EMIT_EXT_CAPABILITY_UNSUPPORTED`
- `EMIT_EXT_CANONICALIZATION_FAILURE`

Errors map to `RuntimeError` codes per ADR 027 and ADR 068.

### TS-first parity

The TypeScript contract DSL exposes the same namespace vocabulary via pack refs, and extension-specific column/type helpers are provided by the corresponding extension package.

```typescript
import { int4Column } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import postgres from '@internal/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensions: { pgvector },
  models: {
    Document: model('Document', {
      fields: {
        id: field.column(int4Column).id(),
        embedding: field.column(vector(1536)),
      },
    }).sql({ table: 'document' }),
  },
});
```

- Emitted `contract.json` must be byte-for-byte identical to PSL-first for the same inputs
- Lint rules enforce determinism and forbid dynamic values in TS-first authoring

### Reserved and collision policy

- Core attribute space remains unprefixed and reserved
- Namespaces are reserved per published pack manifest
- Collisions fail emission with `EMIT_EXT_NAMESPACE_COLLISION`
- Pack deprecation of attributes must be surfaced as warnings or errors with clear remediation

## Alternatives considered

- **Inline version suffix `@pgvector@1.2.column(…)`**: Rejected for readability and because multiple attributes would repeat versions
- **Mixing extension payloads directly into core nodes without a dedicated `contract.extensions.<namespace>` section**: Rejected due to ambiguity and difficulty for agents to locate extension data

## Consequences

### Positive
- Clear, collision-free extension mechanism that maps cleanly to deterministic JSON
- Agents and tools can rely on `contract.extensions.<namespace>` to discover features without executing code
- Capability gating prevents authoring features that cannot run on the selected target

### Negative
- Requires packs to ship schemas and maintain stable attribute vocabularies
- Slight verbosity from explicit namespace + argument syntax in PSL
- Adds validation complexity to the emitter

## Open questions

- Cross-pack composition rules when two packs annotate the same column
- How to express extension-specific migrations that affect storage without leaking code into the contract
- Deprecation window and severity levels for attribute changes

## Test strategy

- Golden tests for PSL → contract emission covering attribute order, version pinning, and canonicalization
- Negative tests for all error conditions in the taxonomy
- TS-first parity tests to ensure identical JSON for mirrored inputs
- Capability matrix tests that toggle adapter features and ensure proper gating

## References

- ADR 010 — Canonicalization rules for contract.json
- ADR 016 — Adapter SPI for lowering relational AST
- ADR 030 — Result decoding & codecs registry
- ADR 041 — Custom operation loading via local packages + preflight bundles
- ADR 065 — Adapter capability schema & negotiation v1
- Doc 11 — Extensions & Packs
