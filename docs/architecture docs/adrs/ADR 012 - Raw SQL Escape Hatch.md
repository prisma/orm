# ADR 012 — Raw SQL escape hatch with required annotations

> **Update — plan construction superseded by [ADR 247](ADR%20247%20-%20Whole-query%20raw%20SQL%20is%20the%20fragment%20mechanism%20at%20statement%20position.md):** a whole-query raw statement is an AST node (`raw-query`) in `AnyQueryAst`, so its plan carries `ast` and declares its result columns through a row spec. The "Plan construction" section below — `ast` omitted, `meta.lane = 'raw-sql'`, optional `meta.refs` / `meta.projection` / `meta.codecs` — describes a shape the SQL family no longer builds. The decision not to parse SQL in the runtime is unchanged and carries into ADR 247. The minimal annotation schema (`intent`, `isMutation`, `hasWhere`, `hasLimit`) also stands as the vocabulary for plans that carry annotations, but a raw statement plan is not one of them: it mints no `meta.annotations` at all, which is why `LINT.READ_ONLY_MUTATION` cannot fire for it (ADR 247 § Deliberate limitations). See ADR 247 for what replaces the construction model.

> **Update — retired by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md):** the optional structured-annotations branch (`refs`, `projection`, `codecs` / `paramDescriptors`) on raw plans has been removed. The minimal annotation schema below (`intent`, `isMutation`, `hasWhere`, `hasLimit`) is unchanged and continues to drive policy routing and lint dispatch. Raw plans now pass parameters to the driver as supplied by the caller; the unindexed-predicate lint and the refs-based row-count budget heuristic ran off the removed sidecar and no longer run for any plan — ADR 205 § Consequences records them as gone. See ADR 205 for rationale. The wire-level row values this note also described are superseded by [ADR 247](ADR%20247%20-%20Whole-query%20raw%20SQL%20is%20the%20fragment%20mechanism%20at%20statement%20position.md): a raw statement declares its result, so a row spec's per-column codec ids drive decoding exactly as a projection's do, and a statement declaring an affected count decodes no rows at all.

## Context

We intentionally keep the SQL DSL small and composable. Teams still need to run hand-authored SQL for advanced features, engine extensions, or when SQL is clearer than any builder. Safety and observability cannot be optional just because the query is raw. We need a defined way to create a Plan from raw SQL that keeps guardrails and verification intact without requiring the core to parse SQL.

## Decision

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

Introduce a Raw SQL escape hatch that constructs Plans without an AST but with required annotations for basic policy checks:
- Define a minimal annotation schema so guardrails can operate lane-agnostically
- Allow optional structured refs, projection, and codecs to strengthen checks and DX when authors can supply them
- Do not add core SQL parsing in the runtime or compiler
- Adapters may optionally enrich raw Plans with refs or diagnostics via light parsing or EXPLAIN, but this is additive and off by default

## Plan construction

Raw Plans use the unified Plan shape from ADR 011 with ast omitted and meta.lane = 'raw-sql'

### Required fields
- `sql` and `params`
- `meta.coreHash` and `meta.target`
- `meta.annotations` with the minimal set below

### Optional fields

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- `meta.refs` and `meta.projection` for stronger linting and diagnostics
- `meta.codecs` for boundary validation of params and rows
- `meta.annotations.ext` for extension-specific claims

## Helper sketch

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

```typescript
const plan = raw({
  sql: `select u.id, u.email from "user" u where u.active = $1 limit 100`,
  params: [true],
  annotations: {
    intent: 'read',
    isMutation: false,
    hasWhere: true,
    hasLimit: true
  },
  refs: { tables: ['user'], columns: [{ table: 'user', column: 'id' }, { table: 'user', column: 'email' }] },
  projection: { id: 'user.id', email: 'user.email' }
})
```

## Minimal annotations (required)

These fields are mandatory for every raw Plan so baseline guardrails can run:
- `intent: 'read' | 'write' | 'admin'` - communicates the operational intent for policy routing and logging
- `isMutation: boolean` - true for statements that can change data or schema
- `hasWhere: boolean` - whether a predicate is present in a DML statement
- `hasLimit: boolean` - whether a row-limiting construct is present for SELECT or DELETE where policy requires it

If a required annotation is omitted, the runtime fails fast in strict mode or warns in permissive mode

## Optional structure for stronger safety

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- `refs` - list of tables and columns the query touches to power unindexed predicate lints, sensitivity policies, and audit
- `projection` - alias → fully qualified column mapping to validate result typing and enable plan change detection
- `codecs` - optional param and row validators to catch boundary errors early

When present, these unlock the same quality of guardrails available to AST-backed Plans

## Runtime behavior

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- **Contract check**: verify meta.coreHash matches the active data contract marker
- **Policy and lints**: evaluate rules against annotations when ast is absent; rules that depend on structure degrade gracefully if refs or projection are missing
- **Budgets**: enforce latency and row budgets based on runtime measurements
- **Telemetry**: record timing, row count, and violations using lane-agnostic plan identity from ADR 013

## Adapter enrichment (optional)

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

Adapters may offer an opt-in enrichment step:
- Light parsing to infer refs for common cases
- EXPLAIN sampling in shadow DBs or preflight to derive shape hints
- None of this is required by core and must not be on the hot path by default

## Validation and modes
- **Strict mode (CI, staging, production hardened)**: required annotations must be present and consistent with policy; missing or conflicting annotations fail the Plan before execution
- **Permissive mode (local dev, exploration)**: missing annotations produce warnings and reduced guardrails

Configuration is per runtime instance and can be set by environment

## Examples

### Read query
```typescript
raw({
  sql: `select * from "user" where email like $1 limit 50`,
  params: ['%@acme.com'],
  annotations: { intent: 'read', isMutation: false, hasWhere: true, hasLimit: true }
})
```

### Mutation requiring a predicate
```typescript
raw({
  sql: `update "user" set active = false`,
  params: [],
  annotations: { intent: 'write', isMutation: true, hasWhere: false, hasLimit: false }
})
// mutation-requires-where lint will block in strict mode
```

### Admin DDL
```typescript
raw({
  sql: `create index concurrently if not exists user_email_idx on "user"(email)`,
  params: [],
  annotations: { intent: 'admin', isMutation: true, hasWhere: false, hasLimit: false }
})
```

## Alternatives considered

### Parse raw SQL into an AST in core
- Heavy, dialect-fragile, and unnecessary for safety if authors provide minimal annotations

### Allow raw SQL without annotations
- Undermines guardrails and creates a bypass path that weakens the safety story

### Require full refs and projection for all raw Plans

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- Too strict for many advanced queries and reduces escape-hatch usefulness

## Consequences

### Positive
- Keeps a first-class escape hatch without compromising safety guarantees
- Works for agents and humans alike because the annotation contract is simple and explicit
- Avoids a heavy SQL parser in core while allowing adapters to add value off the hot path

### Trade-offs

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- Some lints are weaker without refs or projection
- Requires discipline from authors to supply truthful annotations or to enable adapter enrichment where needed

## Scope and non-goals

### In scope for MVP
- Annotation schema and validation
- Raw Plan helper in @prisma/sql/raw
- Runtime guardrails that operate on annotations

### Out of scope for MVP

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- SQL parsing in core
- Automatic extraction of refs and projection for raw Plans

## Testing

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

- Unit tests validating annotation requirements and error modes
- Integration tests ensuring guardrails behave identically for equivalent DSL and raw Plans when refs/projection are supplied
- Golden tests confirming plan identity hashing ignores lane and depends on sql, params, and normalized metadata

## Backwards compatibility
- Existing DSL Plans unaffected
- TypedSQL will later produce raw-style Plans with annotations and optional structure

## Decision record

> **Superseded** — the sidecar fields (`refs`, `projection`, `codecs`) this section describes were removed by [ADR 205](ADR%20205%20-%20Execution%20metadata%20lives%20on%20AST.md); see the update note above.

Adopt a Raw SQL escape hatch with a minimal required annotation set. Strengthen safety via optional structured refs, projection, and codecs. Keep core free of SQL parsing and allow optional adapter enrichment behind an explicit flag.
