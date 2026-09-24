# ADR 169 — On-disk migration persistence

## Status

**Partially superseded** by [ADR 199 — Storage-only migration identity](./ADR%20199%20-%20Storage-only%20migration%20identity.md) and [ADR 197 — Migration packages snapshot their own contract](./ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md). Two pieces of the original design no longer match the implementation:

- **Migration identity (section 3 below).** `migrationId` is now computed from `(strippedManifest, ops)` only. The full source and destination contract IRs are not part of the hash input. ADR 199 captures the storage-only identity model.
- **Contracts embedded in the manifest (section 7 below).** `migration.json` no longer inlines `fromContract` / `toContract`. The full contract IRs live as sibling `start-contract.json` / `end-contract.json` files next to the manifest (the snapshot convention from ADR 197); the manifest itself records only the storage-hash bookends. The author-time data-migration code reads the snapshots through TypeScript imports. The change was driven by TML-2512; the runner-independence property — apply only needs `migration.json` + `ops.json` per package — is locked in by regression tests in `@internal/migration-tools`.

**Target resolution by walking to a tip (2026-09-24).** `findLeaf`, `findLatestMigration` and the codes `MIGRATION.AMBIGUOUS_TARGET`, `MIGRATION.NO_TARGET` and `MIGRATION.NO_INITIAL_MIGRATION` described in section 2 were removed. No command resolves a target by walking from the empty hash to a single leaf: origins and destinations come from a ref, the emitted head, the live marker, or an explicit flag, and a graph with several branch tips is a normal state rather than an error. `migration plan` and `migration new` resolve a missing `--from` the same way (the `db` ref, else greenfield on an empty graph, else `MIGRATION.PLAN_ORIGIN_UNKNOWN`). Removed in [prisma/orm#30389](https://github.com/prisma/orm/pull/30389), which lists the sites that changed.

The rest of the body — offline planning via contract-to-schemaIR conversion, graph-topology ordering, direct SQL on disk, transactional apply with resume semantics, and "from" contract resolution — remains accurate.

## Context

Prisma Next models migrations as directed edges between contract hashes (ADR 001). The planner, runner, marker, and ledger infrastructure existed for `db init` (bootstrap a fresh DB from a contract) and `db update` (push changes to a live DB). However, there was no way to persist migration edges to disk, which is required for:

- **Reviewable schema changes**: Teams need migration files in version control for code review and audit trails.
- **Offline planning**: Planning a migration without a database connection, so CI, agents, and developers get identical results.
- **Sequential apply**: Applying a specific, reviewed set of migrations in order, with resume-after-failure semantics.
- **Collaboration**: Detecting when two developers plan migrations from the same starting point and requiring explicit resolution.

ADR 028 defined the on-disk format (migration packages, attestation, graph structure). ADR 039 defined migration graph path resolution. This ADR records the decisions made while implementing the on-disk persistence system, where the implementation diverged from or refined those earlier ADRs.

## Problem

Implement `migration plan`, `migration verify`, and `migrate` as CLI commands with an on-disk migration format that supports offline planning, content-addressed integrity, graph-topology ordering, and transactional apply with resume semantics.

Key tensions:
- The planner was designed to diff a contract against a live database schema (`SqlSchemaIR`). Offline planning requires a contract-to-contract diff, but building a second diff engine is wasteful.
- The migration graph needs unambiguous ordering even when contract hashes are revisited (e.g., add column, deploy, roll back). Node-level graph analysis is insufficient.
- The migration identity (`migrationId`) must support future squash and rebase operations without cascading hash changes.

## Constraints

- **ADR 001**: Migrations are directed edges from `fromHash` to `toHash`, applicable only when the DB marker equals `fromHash`.
- **ADR 010**: Canonicalization rules applied before all hashing.
- **ADR 028**: On-disk format with `migration.json` + `ops.json`, content-addressed `migrationId`.
- **ADR 039**: Migration graph path resolution, cycle/orphan detection.
- **ADR 140**: Package layering — CLI cannot import SQL-domain code directly.

## Decision

### 1. Offline planning via contract-to-schemaIR conversion

`migration plan` reuses the existing `PostgresMigrationPlanner` (same planner `db init` uses). Instead of introspecting a live database for the "from" schema IR, it converts the "from" contract to a `SqlSchemaIR` via `contractToSchemaIR(contract, options) → SqlSchemaIR`.

The conversion is intentionally lossy in the contract→schemaIR direction (drops `codecId`, `typeParams`, `typeRef`), but the planner only needs structural information (native types, nullability, defaults, constraints) to produce correct diffs. No second diff engine is required.

The `contractToSchemaIR` function lives in the SQL family tooling layer (`@internal/family-sql`). The CLI accesses it via `TargetMigrationsCapability.contractToSchema()`, respecting the layering boundary.

### 2. Graph-topology ordering

Migrations are directed edges in a graph where nodes are contract hashes and edges are migration packages (`from` → `to`). The graph is reconstructed from on-disk migration packages at read time via `reconstructGraph()`.

**Ordering**: `findPath(graph, source, target)` uses BFS shortest-path to determine the migration sequence between any two contract hashes. This tolerates cycles (e.g., `C1 → C2 → C1 → C3`) — the pathfinder selects the shortest route.

**Target resolution**: `findLeaf(graph)` finds the unique node reachable from `EMPTY_CONTRACT_HASH` that has no outgoing edges. If the graph has multiple branch tips (divergent branches), `findLeaf` throws `AMBIGUOUS_TARGET`. If the graph has cycles with no exit node (e.g., `C1 ↔ C2`), it throws `NO_TARGET` with guidance to use `--from`.

**Branch detection**: Two migrations sharing the same `from` hash that target different `to` hashes create divergent branches, detected as `AMBIGUOUS_TARGET`. This is a hard error requiring explicit resolution — the system never silently picks a winner.

**Ref-based targeting**: Named refs map environment names (e.g., `staging`, `production`) to a `(hash, invariants)` tuple. Storage is per-file: `migrations/refs/<name>.json`, each file carrying `{ hash, invariants: string[] }`. When a ref is provided via `--to`, `migration status` and `migrate` use the ref hash as the structural target *and* compute `effectiveRequired = ref.invariants − marker.invariants` to drive invariant-aware routing through `findPathWithInvariants`. This allows commands to work on divergent graphs by selecting a specific branch and additionally requires the selected path to apply the named data invariants. See [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md).

### 3. Content-addressed migration identity

`migrationId` (in code: `migrationHash`) is a content-addressed hash computed from:
- The manifest (minus `migrationId` and `signature`) — including `providedInvariants`
- The operations (`ops.json`) — including any `invariantId` on data ops
- The canonicalized `fromContract`
- The canonicalized `toContract`

The `from` and `to` hashes are included in the manifest and therefore in the `migrationId`. Changing either endpoint changes the identity. Adding, removing, or renaming an `invariantId` on a data op also changes the identity (it ripples through `providedInvariants` and `ops.json`); see [ADR 208](ADR%20208%20-%20Invariant-aware%20migration%20routing.md). When a migration is loaded from disk, the loader independently re-derives `providedInvariants` from `ops.json` and surfaces a dedicated `MIGRATION.PROVIDED_INVARIANTS_MISMATCH` error if the manifest disagrees — independent integrity layer alongside the hash check.

### 4. Direct SQL on disk

`ops.json` contains SQL operations lowered for the specific target (e.g., Postgres DDL). The planner already produces `SqlMigrationPlanOperation` with SQL — there is no intermediate abstract operation IR. Migrations are written for a specific database target. This makes `migrate` straightforward: execute the SQL that's already there.

### 5. Transactional apply with resume semantics

`migrate` executes each pending migration as an independent `runner.execute()` call within a single transaction:

1. Acquire advisory lock
2. Validate marker matches the migration's `from` hash
3. Execute operations (precheck → SQL → postcheck per operation)
4. Verify schema against destination contract
5. Update marker and ledger
6. Commit

The first migration uses `origin: null` — the runner expects no marker on a fresh database, not `EMPTY_CONTRACT_HASH`. Subsequent migrations validate the marker against their `from` hash.

If migration N fails, migrations 1..N-1 are already committed. Re-running `migrate` resumes from the last successful state. The marker reflects progress. If a migration fails, the transaction rolls back and the marker stays at the previous state — partially applied migrations are impossible.

`migrate` is policy-agnostic — it derives allowed operation classes from the operations already present in `ops.json`. The policy gate belongs at plan time (`migration plan`), not apply time.

### 6. "From" contract resolution

`migration plan` determines the "from" contract by resolving the latest migration target:
- **No migrations**: Assume `empty` (new project). The converted schema IR is empty.
- **Linear history**: The target is unambiguous — the one reachable node with no outgoing edges.
- **Branching**: `findLeaf` throws `AMBIGUOUS_TARGET` listing both branch tips. The user must resolve manually (delete one branch, re-plan) or pass `--from <hash>`.
- **Cycles without exit**: `findLeaf` throws `NO_TARGET`. The user must pass `--from <hash>` to specify the planning origin explicitly.

When `--from` is provided, graph reconstruction and target resolution are skipped entirely — the specified hash is used directly as the planning origin.

### 7. Full contracts embedded in migration packages

`migration.json` embeds the complete `fromContract` and `toContract` JSON, not just hashes. This enables state reconstruction from any migration point, supports future migration splitting, and makes packages self-contained per ADR 001.

## Consequences

### Positive

- **Offline planning**: `migration plan` requires no database connection. Same inputs produce the same plan.
- **Reviewable artifacts**: Migration packages are committed to version control and go through code review.
- **Deterministic ordering**: Graph-topology ordering via BFS shortest-path provides unambiguous ordering even with revisited contract hashes and cycles.
- **Structural branch detection**: Parallel development produces a hard error with clear resolution steps, not silent data loss.
- **Ref-based targeting**: Named refs allow commands to work on divergent graphs by explicitly selecting a target branch.
- **Resume safety**: Transactional per-migration execution with marker-based progress tracking.
- **Reuse**: No new planner — offline planning reuses the existing `PostgresMigrationPlanner` via schema IR conversion.

### Negative

- **Lossy conversion**: `contractToSchemaIR` drops codec metadata. If the planner ever needs codec-level information, the converter must be extended.
- **Manual branch resolution**: Two developers planning concurrently must resolve the branch manually (delete one migration, re-plan, or use `--from`). Future `migration rebase` tooling can automate this.
- **No `db update` to migrations transition path**: Databases managed with `db update` have a marker but no migration history. Switching to migrations requires a baseline migration. Closed by ADR 218: `migration plan` auto-emits a baseline bundle on an empty graph when the `db` ref is non-null.

## Alternatives considered

### Timestamp-based ordering

Use `createdAt` to determine migration ordering and target selection.

Rejected because: timestamps cannot detect branches (two developers plan at 10:01 and 10:02 — looks like a valid sequence but was planned independently). Clock skew between machines produces incorrect ordering. Timestamps are metadata for human readability, not an ordering primitive.

### Sequence numbers

Assign monotonically increasing numbers to migrations.

Rejected because: sequence numbers require coordination (who assigns the next number?), which conflicts with offline, independent planning. Two developers both get "sequence 2" with no structural way to detect the conflict.

## References

- [ADR 001 — Migrations as Edges](ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 010 — Canonicalization Rules](ADR%20010%20-%20Canonicalization%20Rules.md)
- [ADR 028 — Migration Structure & Operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 039 — Migration graph path resolution & integrity](ADR%20039%20-%20Migration%20graph%20path%20resolution%20&%20integrity.md)
- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)
- [ADR 122 — Database Initialization & Adoption](ADR%20122%20-%20Database%20Initialization%20&%20Adoption.md)
- [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md)
- [ADR 208 — Invariant-aware migration routing](ADR%20208%20-%20Invariant-aware%20migration%20routing.md) — refs carry `{hash, invariants}`; `migrationHash` covers `providedInvariants`
- PR #184: feat(migrations): on-disk migration planning, serialization, and apply
- Linear: TML-1938 — [PN] On-disk migration system
