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
| Includes where the contract lacks `sql.jsonAgg`, `sql.outerReferencesInDerivedTables` or `sql.jsonAggWithoutTruncation` | The database cannot run the one-query include correctly: it rejects the outer reference inside the include's derived table, or it can shorten an oversized JSON array without an error | One query per relation: SELECT the parent rows, then for each include one SELECT of the related rows of all those parents, filtered by the parents' identity, and attach each related row to its parent in memory. Paging, `distinct` and aggregates still run in SQL, per parent. Every parent table needs a primary key or a unique key with no nullable column; without one the read fails with `ORM.ROW_IDENTITY_MISSING`. A very large set of parents is split across several statements per include |

### 6) Transaction policy

- **Mutations** spanning multiple statements default to transactional (wrap in `transaction`), including the statements that load the includes of the rows they return
- **Reads** spanning multiple statements, such as a read whose includes load with one query per relation, open no transaction: each statement runs on its own, and inside a caller's transaction they run on it
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
- Includes load with the one-query include, a correlated subquery per include that aggregates the related rows into JSON, when the contract's `sql` group reports `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`. When it lacks any of them, includes load with one query per relation, and a prepared read with includes is refused, because a prepared read is one statement. There is no user switch between the two (ADR 296)
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
- **A read whose includes load with one query per relation can see more than one snapshot.** Its statements run one after another without a transaction, so each sees the data committed when it runs. A child committed between two statements can appear, a child whose parent was deleted in between is missing, and a to-one child can disagree with its parent's foreign key column. Prisma 7, ActiveRecord and Django load relations the same way and have the same cost.
- **Loading one query per relation has limits the one-query include does not:**
  - A read with includes does not stream. It holds every row in memory until its last statement completes, then yields them.
  - Middleware that inspects statements sees each per-relation statement as a plain `SELECT` with no `LIMIT`, since paging runs per parent inside it. The `lints` middleware reports `LINT.NO_LIMIT` for it, and the `budgets` middleware counts it as unbounded.
  - Child rows are attached to their parent by the decoded values of the parent's identity, and the child statement filters on those values written back through the key's codec. A key whose codec cannot reproduce the stored value, such as a `datetime(6)` read as a JavaScript `Date`, which has only milliseconds, matches no stored row, so its parent gets no children.
  - A child row that fails to decode raises the runtime's ordinary decode error. Child rows that tie on the caller's order come back in the order of the child's identity, which each per-relation statement adds to its `ORDER BY`.

## Alternatives considered

For writes on a database without `RETURNING`:

- **Refuse every write that returns rows,** leaving only the methods that return counts. Rejected: it keeps one statement per call, but leaves the ORM close to unusable on such a database.
- **Report generated keys as rows, or as a `generatedKeys` member of a family write result.** Rejected: a database without `RETURNING` reports at most one generated value per statement, so neither shape can be filled for a multi-row insert, and rows a write returns are what `RETURNING` already means. The driver instead reports the one value as an optional `insertId` on the statement's statistics (`SqlStatementStats` in `packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts`).
- **A framework result type that each family binds.** Rejected: the value must be optional, because a middleware can answer a statement in place of the database and leave it out, and a generic result type cannot be named by middleware written once for every client ([ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md)).
- **A follow-up `SELECT LAST_INSERT_ID()`.** Rejected: it costs another round trip, and it puts a MySQL function in code shared by every target.

For includes on a database that cannot run the one-query include:

- **Rewrite the one-query include so the correlation sits in the subquery's own `WHERE`, and check each array's length against `COUNT(*)`.** Rejected: it builds every aggregate twice per level of nesting, recognises a shortened array only by matching error text, and cannot express `distinct`, paged scalar includes or `combine`.
- **One query that joins parents and children, with duplicates removed in memory.** Rejected: paging per parent cannot be written, and several to-many includes multiply the rows returned.
- **A loader that reads every child row and pages, removes duplicates and aggregates in memory.** Rejected: it reads rows the caller did not ask for, and it matches rows on the foreign key column's text, which is wrong under a case-insensitive collation. The per-relation statements page, remove duplicates and aggregate in SQL, and match rows on decoded identity values.
- **Run a read with includes in a transaction at REPEATABLE READ, so that all its statements see one snapshot.** Rejected: it costs two more round trips and holds a connection for the whole read, on every read with includes, to remove an inconsistency the ORMs that load relations the same way also accept. A transaction at READ COMMITTED, the level of the transactions the ORM opens itself, would not help: each statement there still sees the latest committed data.

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
