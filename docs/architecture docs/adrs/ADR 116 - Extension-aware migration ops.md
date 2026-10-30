# ADR 116 — Extension-aware migration ops

## Context

Prisma Next supports target extensions like pgvector and PostGIS. Schema evolution for these features requires migration operations that understand extension types, indexes, operator families, and catalog state. We need a first-class way to plan and run extension-aware migrations with safety guarantees, deterministic names, and parity between local and hosted preflight.

## Update (v1 implementation)

For v1, database-side prerequisites required by components (for example enabling `CREATE EXTENSION …`) are modeled as **component-owned database dependencies** declared on framework component descriptors and verified via pure schema-IR hooks. This avoids hardcoding ecosystem knowledge in targets and avoids inferring prerequisites from `contract.extensions`.

See [ADR 154 — Component-owned database dependencies](ADR%20154%20-%20Component-owned%20database%20dependencies.md). Both mechanisms are gone: a Postgres extension is now a contract entity that the planner creates and the verifier checks ([ADR 312](ADR%20312%20-%20A%20Postgres%20extension%20is%20a%20contract%20entity%2C%20and%20db%20sign%20refuses%20a%20space%20with%20unmet%20invariants.md)).

## Problem

- Extensions introduce nonstandard DDL and catalog requirements that generic ops cannot capture safely
- Incorrect ordering or missing capabilities can brick environments or degrade performance
- We need deterministic, idempotent, verifiable ops that integrate with pre/post checks and adapter capability negotiation
- The same migration package must run in local CI and PPg preflight without network access or repository cloning

## Decision

Introduce an extension-aware operation taxonomy and execution contract. Extension ops are declared in migrations as JSON with pre/post checks, deterministic naming, and capability gates. Execution is provided by adapter profiles and extension packs. No network access is required at runtime and ops must be idempotent or declare compensation paths.

## Scope

- Postgres v1 with pgvector and PostGIS packs
- Additive changes MVP: enable extension, add types and columns, create indexes, set column attributes, create operator classes where needed
- Renames and destructive changes addressed later with PSL hints

## Model

### Op schema

Every extension op serialized in a migration edge must follow this shape:

```json
{
  "kind": "ext.op",
  "extId": "pgvector",
  "op": "createVectorIndex",
  "args": {
    "table": "embedding",
    "column": "vec",
    "method": "ivfflat",
    "lists": 100,
    "metric": "cosine",
    "name": "embedding_vec_ivfflat_cosine_idx"
  },
  "pre": [
    { "check": "tableExists", "table": "embedding" },
    { "check": "columnTypeIs", "table": "embedding", "column": "vec", "type": "vector(1536)" },
    { "check": "extensionAvailable", "extId": "pgvector", "minVersion": "0.6.0" }
  ],
  "post": [
    { "check": "indexExists", "table": "embedding", "name": "embedding_vec_ivfflat_cosine_idx" },
    { "check": "indexUsesOperatorClass", "table": "embedding", "name": "embedding_vec_ivfflat_cosine_idx", "opclass": "vector_cosine_ops" }
  ],
  "idempotency": "createIfMissing",
  "requiresTx": "adapterDefault"
}
```

- `extId` ties the op to a Target Extension Pack per ADR 112
- `op` is a stable identifier defined by the pack
- `args` are canonicalized and deterministically named per ADR 009 and ADR 106
- `pre` and `post` use the per-family check vocabulary ([ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md) for SQL, [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) for Mongo)
- `idempotency` and `requiresTx` follow ADR 038 and ADR 037

### Capability gating

- At connect and at apply, the adapter negotiates capabilities with the extension pack per ADR 065
- An op cannot run unless the capability gate passes for target version and features
- Violations yield a stable `E_EXT_CAPABILITY_MISSING` mapped via ADR 068

### Deterministic naming

- All extension artifacts must have deterministic names derived from table, column, algorithm, and parameters per ADR 009
- Planners must propose names and embed them in `args.name` to avoid runtime divergence

### Idempotency and compensation

- Each op declares idempotency as one of `pureNoop | createIfMissing | replaceIfDifferent | cannotReplay`
- For `replaceIfDifferent`, the pack must define safe compensation or fail with a stable error before mutating
- Ops that cannot be replayed must include clear precondition guards and rollback advice

### Canonicalization

- Op JSON is canonicalized and stable across emits per ADR 010 and ADR 106
- The migration edge digest includes op JSON to enable reproducible verification

## Initial op catalog

### pgvector examples

- **enableExtension**: Ensures `CREATE EXTENSION IF NOT EXISTS vector`
- **createVectorColumn**: Adds `vector(dim)` with optional default and nullability
- **createVectorIndex**: Creates ivfflat or hnsw index with metric, lists/M, and opclass
- **alterVectorMetric**: Changes index metric by drop-and-create with preflight warning
- **validateVectorDim**: Adds a constraint check function for dimension consistency

### PostGIS examples

- **enableExtension** for postgis
- **createGeometryColumn** with SRID and type
- **createSpatialIndex** with method and opclass
- **setSRID** with data rewrite guarded by node task
- **registerTopology** if used by schema

Each op lives in its pack and comes with JSON schemas for args, pre/post recipes, and capability metadata.

## Planner responsibilities

- Detect extension diffs from old→new contract
- Emit extension ops with deterministic names and complete pre/post checks
- Refuse to emit destructive modifications without hints
- Attach advisory nodeTasks when data rewrites are implied

## Runner responsibilities

- Evaluate pre checks atomically before scheduling any extension ops
- Acquire advisory lock per ADR 043 with a domain including `extId` to reduce contention
- Execute ops respecting `requiresTx`, committing between groups if transactional DDL is not supported
- Evaluate post checks, writing ledger events per ADR 028
- Abort on first non-idempotent failure and surface stable errors per ADR 027

## Preflight and EXPLAIN

- Hosted and local preflight must run extension guardrails per ADR 115
- Shadow mode preferred for post-checks requiring catalog validation or planner stability
- EXPLAIN-only permitted for index existence and operator class checks when shadow is disabled, with downgraded confidence

## Security and isolation

- Custom extension ops may be provided by packs only, not arbitrary user code
- No network and no WASM in the migration runner path by default
- Node tasks for heavy backfills run under ADR 040 sandboxing with explicit resource caps

## Performance

- Pre/post checks must be O(1) catalog lookups or bounded list scans
- Index builds can be concurrent where the adapter supports it, exposed as `args.concurrent: true`
- Planner should batch ops by table to minimize lock churn

## Testing

- Golden migration fixtures per pack exercising create, idempotent replay, and capability failure
- Shadow DB preflight tests verifying post checks and EXPLAIN policies
- Deterministic naming snapshot tests
- Negative tests for misconfigured dimensions, SRIDs, and metrics

## Alternatives considered

- **Represent extension DDL as raw SQL ops only**
  - Rejected due to loss of pre/post invariants, capability gating, and idempotency semantics
- **Auto-creating indexes implicitly when extension columns are added**
  - Rejected to keep planner explicit and auditable

## Consequences

### Positive

- Safer, deterministic evolution for extension workloads
- Clear separation of planning and execution with capability-gated safety
- Parity between local and hosted preflight without source checkout

### Negative

- Packs must maintain op catalogs and schemas
- Some operations remain non-idempotent and require explicit operator guidance

## Open questions

- Should we support extension version bumps as a first-class op with safe rollout guidance
- How do we stage index algorithm migrations with minimal downtime beyond concurrent flags
- Do we expose advisor suggestions that propose extension indexes automatically when guardrails fail
