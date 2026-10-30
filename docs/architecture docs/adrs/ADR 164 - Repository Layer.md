# ADR 164 — Repository Layer

## Context

ADR 003 enforces a strict **one query → one statement** rule at the lane level: every `SqlQueryPlan` compiles to exactly one SQL statement. ADR 015 extends this guarantee to the ORM lane, which compiles each call to a single Plan. This constraint is fundamental to verification, guardrails, budgets, and agent ergonomics.

However, a high-level user-facing API needs to support operations that inherently require multiple database round-trips:

- **CREATE without RETURNING**: targets that do not support `RETURNING` need a follow-up read to return the created row
- **Nested mutations**: creating a parent and its children requires multiple INSERT statements for most databases (even though can often be lowered to CTEs for Postgres)
Rather than weaken the lane-level guarantee, we introduce a **Repository Layer** (layer 6) above lanes and runtime that is explicitly permitted to orchestrate multiple Plans per user-facing operation. Each individual Plan still obeys ADR 003. The repository layer orchestrates *sequences* of single-statement Plans.

The existing ORM lane (ADR 015) will eventually be deprecated and removed; the repository layer is its successor.

## Decision

### 1) Package location and plane

The repository layer is implemented by `@internal/sql-orm-client` at `packages/3-extensions/sql-orm-client/` in the runtime plane (`extensions` domain, `integrations` layer).

### 2) Dependency rules

- **May import from**: lanes/runtime/core packages needed for query composition and orchestration, plus execution-boundary integrations
- **Must not own**: adapter/driver internals or target-specific transport logic
- **Must not be imported by**: lower-level lane/runtime core packages

This preserves the downward-only dependency flow for core SQL layers while allowing extension-domain integration packages to compose the boundary cleanly.

### 3) Multi-query permission

The repository layer is **not subject to ADR 003**, which scopes to lanes and Plans. Instead:

- Each individual Plan produced by a lane still compiles to exactly one SQL statement (ADR 003 holds)
- The repository layer orchestrates *sequences* of single-statement Plans to implement higher-level operations
- The boundary is explicit: lane code never issues multiple statements; repository code explicitly dispatches multiple Plans

### 4) Execution model

The repository layer composes and compiles queries, then dispatches plans directly through runtime primitives and SQL family lane helpers:

- Compiled-query dispatch executes through runtime `execute(plan)`
- `connection()` / `transaction()` runtime primitives are used for scoped multi-query workflows

Repository operations compose these primitives to implement multi-query workflows. The runtime remains unaware of repository-level semantics; it sees individual Plans.

### 5) Concrete scenarios

| Scenario | Why multi-query | Strategy |
|----------|----------------|----------|
| CREATE without RETURNING | Target lacks RETURNING | INSERT followed by SELECT using known key: the key values the client supplies, or the insert id the driver reports for a one-row insert |
| UPDATE / DELETE without RETURNING | Target lacks RETURNING | SELECT the matching keys; write with the caller's filter (many rows) or by the selected key (one row); then SELECT by those keys, with any new key value the update set, or return the rows read first (DELETE) |
| UPSERT without RETURNING | Target lacks RETURNING | INSERT with an update on conflict, then SELECT by the create's values for the conflict columns |
| Nested creates | Parent + children across tables | Ordered INSERTs within a transaction, propagating generated keys |

### 6) Transaction policy

- **Mutations** spanning multiple statements default to transactional (wrap in `transaction`)
- Detailed transaction policy, isolation level selection, and retry semantics are deferred to a follow-up ADR

### 7) Relationship to ORM lane

The repository layer is the **successor** to the ORM lane, not an extension of it:

- The ORM lane (ADR 015) compiles to a single Plan per call and is limited to what a single statement can express
- The repository layer lifts this limitation by orchestrating multiple Plans
- The ORM lane will be deprecated once the repository layer reaches feature parity
- During the transition period, both may coexist; the repository layer may internally use ORM lane or DSL lane to build individual Plans

### 8) Observability

- Each Plan retains its own telemetry (timing, EXPLAIN output, row counts) per existing runtime hooks (ADR 014)
- The repository layer aggregates Plan-level telemetry into an **operation-level summary** (total time, Plan count, statement list)
- Plans produced for repository operations use `meta.lane = 'orm-client'` to distinguish them from direct lane usage
- Operation-level tracing connects individual Plan spans under a parent repository-operation span

### 9) Capability-driven strategy selection

The repository layer reads **contract capabilities** (ADR 031) to choose between single-query and multi-query strategies:

- When `RETURNING` is available, a CREATE can be lowered to a single statement; when absent, the repository issues INSERT + SELECT. A database without `RETURNING` reports at most one generated value per statement, so an operation that would need several generated keys back (a multi-row create returning rows) is refused before it runs
- When CTE-based nested mutations are feasible (e.g., writable CTEs on Postgres), prefer single-statement lowering via the lane; otherwise, fall back to multi-statement orchestration
- Strategy selection is deterministic given the same contract and capabilities — no runtime feature detection

## Consequences

### Benefits

- **Target portability**: high-level APIs work across targets with varying SQL capabilities by adapting strategy at the repository level
- **Lane purity**: lanes remain strictly one-statement-per-Plan, preserving verification, budgets, and guardrails
- **Clear boundary**: the line between "one statement" and "multiple statements" is an explicit architectural boundary, not a hidden behavior
- **Incremental adoption**: repository operations can be introduced alongside existing lane usage without breaking changes

### Costs

- **Observability complexity**: operation-level telemetry aggregation adds instrumentation surface
- **Larger test matrix**: each multi-query strategy needs testing per target, multiplying the conformance surface
- **Transaction overhead**: mutation operations pay for transaction coordination even when a single statement would suffice on capable targets
- **Reduced predictability**: users of the repository layer see operations that may issue varying numbers of statements depending on target capabilities

## Related ADRs

- **ADR 003** — One Query → One Statement (lane-level guarantee this layer builds above)
- **ADR 011** — Unified Plan Model (Plan structure used by dispatched queries)
- **ADR 014** — Runtime Hook API (telemetry and lifecycle hooks for individual Plans)
- **ADR 015** — ORM as Optional Extension (predecessor this layer supersedes)
- **ADR 031** — Adapter capability discovery & negotiation (capability-driven strategy selection)
- **ADR 140** — Package Layering & Target-Family Namespacing (layer ordering and dependency rules)
- **ADR 155** — Driver/Codec boundary and lowering responsibilities (codec and driver boundary for Plan execution)
- **ADR 158** — Execution mutation defaults (execution-plane semantics consumed by repository operations)

## Open questions

- **Parallel vs sequential dispatch**: can independent queries within a repository operation be dispatched in parallel within a pinned connection, or must they be sequential? What are the connection-protocol constraints per target?
- **Operation-level budgets**: should there be a budget or limit on the number of Plans a single repository operation can dispatch? How does this interact with existing Plan-level budgets (ADR 023)?
