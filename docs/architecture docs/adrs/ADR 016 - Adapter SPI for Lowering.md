# ADR 016 — Adapter SPI for lowering relational AST

> **Partially superseded by [ADR 329](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md) from `8.0.0`.** Its "Stability guarantees" and "Versioning policy" sections treat a change to emitted SQL as a breaking change unless it is guarded by an adapter version or a feature flag. Under ADR 329 SQL text is unspecified detail that may change in any release, and Prisma 8 has no feature flags. The lowering interface itself stands.

## Context

The SQL DSL and optional ORM produce a dialect-agnostic relational AST. Relationship traversal is represented by first-class, projection-scoped nodes (`nestArray`, `joinFlat`, including M:N via junction). We need a clear, stable SPI where dialect logic lowers these nodes so lanes stay portable and the core remains thin. Lowering must be deterministic to support plan hashing, golden tests, and agent predictability.

## Decision

Introduce an Adapter SPI responsible for lowering the relational AST into concrete SQL and params for a target:
- Capabilities are explicit feature flags negotiated at runtime (e.g., lateral, jsonAgg)
- Adapters must provide deterministic output given the same inputs and adapter version
- Golden SQL tests are mandatory for adapter changes to guarantee stability

## Goals
- Keep dialect decisions out of the DSL and ORM layers
- Make capabilities explicit and testable
- Ensure identical input produces identical SQL output for a given adapter version
- Provide helpful diagnostics when capabilities are missing or an expression cannot be lowered

## Non-goals
- Building a universal SQL parser in core
- Auto polyfilling complex features across all dialects
- Guaranteeing perfect cross-dialect parity for all constructs

## Related

- [ADR 210 — Prepared Statements: Author Surface and Driver SPI](ADR%20210%20-%20Prepared%20Statements%20-%20Author%20Surface%20and%20Driver%20SPI.md) uses the driver query SPI with a prepared handle for reuse of lowered SQL; `lower()` runs once at `prepare` time and is not invoked on the prepared query path.

## SPI shape

```typescript
export type Capability =
  | 'lateral'
  | 'jsonAgg'
  | 'arrayAgg'
  | 'jsonBuildObject'
  | 'onConflict'
  | 'returning'
  | 'cte'
  | 'window'
  | 'ilike'
  | 'distinctOn'

export interface AdapterProfile {
  target: 'postgres' | 'mysql' | 'sqlite'
  version: string
  capabilities: Record<Capability, boolean>
  lower(query: QueryAST, ctx: LoweringContext): LoweringResult
  explain?(sql: string, params: unknown[], ctx: ExplainContext): Promise<ExplainResult>
}

export interface LoweringContext {
  contract: ContractJson
  normalizeIdentifiers: boolean
  stableAliases: boolean
}

export interface LoweringResult {
  sql: string
  params: unknown[]
  // Optional structural hints for guardrails and DX
  refs?: { tables: string[]; columns: Array<{ table: string; column: string }> }
  projection?: Record<string, string>
  notes?: Array<{ message: string; data?: unknown }>
}
```

## Capability flags
- Capabilities are boolean feature switches describing what the adapter can guarantee (examples: `lateral`, `jsonAgg`, `arrayAgg`, `jsonBuildObject`, `onConflict`, `returning`, `cte`, `distinctOn`)
- Optional typing refinements may be advertised, e.g., `jsonAggCoalescesEmpty` when adapters guarantee `COALESCE(json_agg(...), '[]')`
- Lanes and higher layers must branch on capabilities rather than probing the dialect at runtime
- Missing capabilities should produce compile-time diagnostics with remediation guidance

## Deterministic lowering requirements

Adapters must:
- Produce byte-stable SQL for the same AST, contract, and adapter version
- Use stable aliasing when stableAliases is true
- Preserve identifier quoting rules deterministically
- Render placeholders consistently for the target driver
- Avoid embedding non-deterministic literals like timestamps or random IDs in SQL text
- Order projections, predicates, joins, and CTEs deterministically

### Relationship traversal lowering

Adapters must lower:
- `nestArray` to a single-statement correlated subquery that aggregates typed child rows (e.g., `json_agg(json_build_object(...))` in Postgres), optionally coalesced to `[]` when capability allows; M:N is expressed by joining a junction inside the subquery
- `joinFlat` to a single `LEFT JOIN` or `INNER JOIN` depending on `required`, projecting aliased child columns deterministically

When capabilities are missing and no safe, single-statement equivalent exists, adapters return a structured error.

## Stability guarantees
- Given (adapter.version, capabilities, coreHash, AST), the output (sql, params) is stable
- Any change to emitted SQL formatting that affects sqlFingerprint is considered a breaking change unless guarded behind an explicit adapter version bump
- Minor adapter updates may add capabilities or diagnostics but must not change SQL for existing constructs

## Golden SQL testing obligations
- Each adapter ships a corpus of golden tests mapping representative ASTs to expected SQL and params
- Tests must cover projections, predicates, joins, grouping, order, limits, nullability, and common ORM-lowered patterns
- A failure in golden tests blocks release of the adapter update
- Golden fixtures are tied to adapter.version to allow planned, opt-in formatting evolutions

## Error handling and diagnostics
- When a node cannot be lowered due to missing capability or unsupported combination, the adapter must return a structured error with code, message, hint, and optionally capability
- Adapters should attach notes to the LoweringResult to help downstream guardrails and DX
- Errors must be deterministic and reproducible from inputs

## Fallback behavior
- Adapters may implement safe fallbacks if they keep one statement and preserve semantics (example: prefer jsonAgg, fall back to arrayAgg of row_to_json when equivalent)
- Fallbacks must be explicit in code and covered by golden tests
- If no safe fallback exists, fail with a clear error rather than silently degrading

## Interaction with ORM
- ORM produces higher-level nodes that the adapter profile lowers into relational nodes or directly into SQL fragments as needed
- The one call → one statement rule from ADR 015 must be preserved
- If ORM features require capabilities the adapter lacks, compilation must fail with actionable diagnostics

## Interaction with runtime and plans
- Lowering returns (sql, params) and optional refs and projection to fill Plan.meta
- Adapters do not set policy decisions or lint outcomes
- Plan hashing per ADR 013 operates on normalized SQL and parameter shape independent of lane

## Versioning policy
- adapter.version follows semver; breaking SQL emission changes require a major bump
- Capability additions may ship in minor versions if they do not affect existing SQL
- Bug fixes that change SQL must be treated as breaking unless guarded behind a feature flag

## Testing strategy
- Golden SQL snapshots per adapter version
- Cross-contract tests to ensure identifier normalization and quoting remain stable
- Randomized AST fuzzing with round-trip normalization for robustness
- EXPLAIN smoke tests where available to catch blatantly invalid SQL prior to release

## Tooling and dev ergonomics
- Provide a CLI to regenerate and compare golden outputs for a set of AST fixtures
- Offer a diff viewer that highlights semantic vs cosmetic changes to help reviewers
- Surface adapter capability matrix in docs and runtime diagnostics

## Alternatives considered

### Centralize lowering in core with conditional branches per target
- Bloats core and violates thin core, fat target

### Parse SQL and re-emit for portability
- Heavy, brittle, and orthogonal to our builder approach

## Consequences

### Positive
- Keeps the core small and portable while enabling rich, dialect-specific features
- Predictable output supports hashing, CI change detection, and agent generation
- Easier contribution path for new targets and capabilities

### Trade-offs
- Adapter authors carry the burden of deterministic formatting and larger test suites
- Some constructs will remain target-specific and unavailable in a uniform way

## Open questions
- Minimum capability set for an adapter to be considered GA
- Whether to standardize a tiny shared formatting style to reduce golden drift across adapters
- How to expose adapter capability negotiation to agents in a compact way

## Decision record
Adopt an Adapter SPI that owns deterministic lowering from relational AST to SQL and params. Capabilities are explicit, tested, and used for branching by higher layers. Golden SQL tests and versioning policy guard stability for users and agents.
