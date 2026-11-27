# ADR 039 — Migration graph path resolution & integrity

## Context

Migrations are modeled as directed edges from `fromHash` to `toHash`. At apply time, the runner must compute a path from the database's current contract hash to the desired hash using the set of on-disk edges. The graph tolerates cycles (e.g., rollback migrations C1→C2→C1) — BFS pathfinding uses visited-node tracking to handle them safely. Ordering is determined entirely by graph topology; named refs (`migrations/<space>/refs/<name>.json`) provide multi-environment targeting. See also [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md).

## Problem

- Multiple developers create edges concurrently, producing branches
- Ambiguous or conflicting edges can lead to non-deterministic path selection
- Cycles in the graph (e.g., rollback migrations) must not cause infinite loops in pathfinding
- Without a consistent tie-breaker, two environments may choose different valid paths
- Orphan edges and unreachable nodes accumulate without guardrails

## Goals

- Deterministic, repeatable path selection between any two hashes
- Linear-time detection of cycles and orphans during graph load
- Stable tie-breaking across machines and CI
- Simple complexity profile suitable for local runs and CI
- Clear error codes and diagnostics when integrity is violated

## Non-goals

- Weighted optimization of path cost beyond hop count
- Automatic graph surgery or edge rewriting
- Encoding business policies into the graph layer

## Decision

### Graph model and index

**Default mode: Reconstruct from migration files**
- Each migration file (`migration.json`) carries its own manifest with metadata: `{ edgeId, from, to, opsHash, createdAt, labels?, archived? }`
- Graph is reconstructed on demand from migration file headers
- This is the source of truth - no separate ledger required
- `edgeId = sha256(from + to + opsHash)` unless tooling assigns it
- Loader builds adjacency maps `out[from]` and `in[to]` from `migration.json` manifests

**Optional: Performance cache with `graph.index.json`**
- maintain graph index JSON in repo: `migrations/graph.index.json`
- Pre-materialized adjacency lists for faster pathfinding on large migration graphs
- Purely a performance optimization - can be regenerated anytime from migration files
- Under the squash-first policy (ADR 102), most teams maintain small migration graphs (10-20 active edges) where reconstruction is fast and the index is unnecessary

### When to use a committed index (optional)

The graph index is a lockfile optimization that teams can adopt later. **Most teams won't need this initially** when following squash-first hygiene (ADR 102).

The index acts like a lockfile for the migration graph. It's helpful if you have:
- Large migration histories you haven't squashed yet
- Lots of concurrent branches and frequent parallel edges
- Compliance requirements for reviewable "graph diff" artifacts
- External tools (PPg, visualizers) operating without repo access

Benefits when enabled:
- Stable neighbor ordering pre-materialized
- Auditability via small JSON diff
- Fast cold starts (no reconstruction needed)
- Canonical `createdAt` and labels (not inferred from FS)

Not a conflict with reconstruction:
- Planner can reconstruct on every invocation by default
- On load, tooling verifies file digests match index
- If stale, fail with `ERR_MIG_GRAPH_INDEX_STALE`
- Small repos use ephemeral mode: rebuild each run, cache locally

**Default recommendation**: Start without an index. Enable only if telemetry shows reconstruction cost or compliance requires reviewable artifacts.

### Integrity checks on load

- **Same source and target check**: a self-edge (`from == to`) is rejected with `MIGRATION.SAME_SOURCE_AND_TARGET` unless the migration carries at least one `data`-class operation. Self-edges with data ops are first-class (pure data migrations on the current contract hash). See [ADR 001 §Self-edges](ADR%20001%20-%20Migrations%20as%20Edges.md) and [ADR 208](ADR%20208%20-%20Invariant-aware%20migration%20routing.md).
- **Cycle detection**: DFS with color marking, reported as `WARN_MIG_GRAPH_CYCLE` for diagnostics. Cycles are tolerated at runtime — BFS pathfinding uses visited-state tracking to avoid infinite loops (see §Path computation below). See ADR 169 §3.
- **Parallel edge policy**: two edges with same `(from, to)` but different `opsHash` require label `parallel-ok`, else `ERR_MIG_GRAPH_PARALLEL_EDGE`
- **Orphan edge detection**: edges unreachable from any genesis or that lead to no declared target are flagged as `WARN_MIG_ORPHAN_EDGE` (excludes edges marked `archived: true`)
- **Dangling target detection**: `to` with no inbound edges and not a genesis is `ERR_MIG_GRAPH_DANGLING_TARGET`
- **Genesis set**: `{EMPTY_DB_HASH}` plus declared baselines labeled `baseline`

### Path computation

- **Default**: reconstruct graph from edge file manifests in-memory
- `findPath(graph, from, to)` uses BFS to compute minimal-hop paths over adjacency list. Complexity O(V+E).
- `findPathWithInvariants(graph, from, to, required)` extends the BFS to invariant-aware routing — returns the shortest path whose edges' `invariants` sets collectively cover `required`, or `null`. State-level dedup over `(node, coveredSubset)` is required for correctness; node-only dedup misses paths whose first arrival covered the wrong subset. The state also records the rank of the last self-edge taken since arriving at the node, or `-1`, and the dedup key is `JSON.stringify([node, [...covered].sort(), lastSelfEdgeRank])`. The search prunes states that cannot reach the goal without changing the returned path. When `required = ∅` the implementation delegates to `findPath` so behaviour is byte-identical for callers that don't thread invariants. See [ADR 208](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) for the pruning rules, why they leave the path unchanged, and their cost.
- Neighbour ordering is owned by neighbour generation, not by a separate sort step — invariant-aware ordering depends on the source state's still-needed set, and that dependency can't be separated from where neighbours are produced. When `required ≠ ∅`, edges that cover at least one still-needed invariant are explored before edges that don't, with the deterministic tie-break below as the secondary key. When `required = ∅`, ordering matches `findPath` exactly.
- With squash-first policy (ADR 102), typical V+E < 50, making this trivial
- Optional index pre-materializes adjacency for performance at scale

### Deterministic tie-breaking

Neighbor ordering is deterministic whether using reconstruction or index. Metadata comes from migration file headers (`migration.json`), not the index. The index merely caches this for faster access.

Neighbor processing order is stable by a sort key tuple:
1. (Invariant-aware BFS only, when `required ≠ ∅`) edge's `invariants` overlap the still-needed set: covering edges first
2. Label priority: `main < default < feature` (not implemented)
3. `createdAt` ascending
4. `to` lexicographic
5. `migrationHash` lexicographic

Keys 3 to 5 compare strings by character code, not by the machine's locale, so every machine orders them the same way. If labels are absent the order falls back to the remaining keys. Key (1) applies only inside `findPathWithInvariants`; structural `findPath` ignores it (preserving byte-for-byte routing parity for callers that don't thread invariants).

`findPathWithInvariants` ranks the self-edges at each contract with `compareTieBreak` (keys 3 to 5 above; label priority is not implemented) and prunes by that rank, so that comparator must give a fixed order per contract that does not depend on the search's progress. When a route runs several self-edges on one contract, they run in this order. This is current behaviour, not a decided rule; see [ADR 208](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) § Which route runs when several qualify.

### Graph version and caching

- `graphVersion = sha256(sorted(migrationHash, from, to, opsHash))`
- The runner uses `(currentHash, desiredHash, graphVersion)` in cache keys
- Any index change invalidates cached paths deterministically

> **Terminology note.** This ADR's body uses `edgeId` in places where the code uses `migrationHash` — the same content-addressed hash. `migrationHash` covers `providedInvariants` as well (see [ADR 169 §3](ADR%20169%20-%20On-disk%20migration%20persistence.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md)).

### Orphans and parallel edges policy

- Orphans are warnings by default and can be enforced as errors in CI
- Parallel edges are allowed only with `parallel-ok` labels and deterministic preference via tie-break

### Diagnostics

- Stable error codes with minimal subgraph rendering and remediation suggestions
- `migrate graph lint` and `migrate graph prune` commands surface issues and clean up orphans

## Consequences

### Positive
- Deterministic paths across environments
- Early detection of cycles and malformed edges
- Reviewable, portable graph state for CI/PPg
- Simple performance characteristics
- Simple default: no index overhead for small/medium repos
- Squash-first policy (ADR 102) keeps migration graph small, reducing need for index

### Negative
- Optional index adds maintenance overhead if enabled
- Teams using index must regenerate after adding migrations

## Mitigations

- Tooling owns index lifecycle: `migrate create` updates the index, `migrate graph update` regenerates deterministically
- The planner refuses to use a stale index by default and offers `--refresh`

## Alternatives considered

- **Pure reconstruction on every run (chosen as default)**: Works well with squash-first hygiene (ADR 102). Small migration graphs make reconstruction negligible. Committed index available as opt-in for scale/compliance.
- **Timestamp-only tie-breaking**: Sensitive to clock skew and FS semantics. Rejected in favor of multi-key deterministic sort.
- **Always require committed index**: Adds complexity for teams that don't need it. Index remains available as performance optimization.

## Implementation notes

- Implement `graph.index.json` writer/reader with file digest table
- Extend CLI with `migrate graph update`, `migrate graph lint`, `migrate graph prune`
- Loader verifies index freshness and returns actionable errors
- Telemetry records `graphVersion` with each apply for reproducibility

## Testing

- Fixtures with branches, orphans, parallel edges, cycles
- Golden tests that identical inputs yield identical index and paths
- Scale tests for O(V+E) behavior
- CI tests that fail on stale index and pass after graph update

## References

- ADR 001 — Migrations as Edges (self-edge rule)
- ADR 028 — Migration structure & operations
- ADR 037 — Transactional DDL fallback & compensation
- ADR 038 — Operation idempotency classification & enforcement
- ADR 021 — Contract marker storage & verification modes
- ADR 101 — Advisors framework
- ADR 102 — Squash-first policy & squash advisor
- [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) — `findPathWithInvariants`, the discriminated `FindPathOutcome`, and the `(hash, requiredInvariants)` routing target tuple
