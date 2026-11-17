# ADR 001 — Migrations as Edges

> **Update — 2026-10:** the planner hints this ADR anticipates for renames are not built. A rename is stated on the command line as a statement, `--rename <old>:<new>`, which never enters the contract or the migration edge. See [Migration System § Statements](../subsystems/7.%20Migration%20System.md#statements).

## Context

Traditional migration systems rely on the order of files on disk to decide what to run next. That creates coupling to file sequencing, makes squashing brittle, and complicates collaboration when branches diverge. Agents and CI need deterministic, machine-verifiable answers to basic questions like “is it safe to apply this change” and “how do I get from here to there.”

We also want explicit safety guarantees:
- apply only when the database is at an expected state
- verify preconditions and postconditions per operation
- allow squashing and baselines without lying about history
- support data tasks like backfills as first-class, verifiable steps

## Decision

Represent each migration as a directed edge in a graph of data contracts:
- an edge moves from one contract hash to another `fromHash` → `toHash`
- edges are applicable only when the database marker equals `fromHash`
- edges contain a deterministic set of schema operations plus optional node tasks for data work
- node tasks are verified steps attached to a contract change but do not themselves define the graph topology
- **Contract-hash self-edges.** A migration may declare `fromHash === toHash` **only when** its operation list includes at least one `data`-class operation (pure data migrations at the same contract hash). Structural-only pseudo-edges remain invalid; the invariant keeps “empty migrations as edges” from collapsing ordering guarantees.
- **Pathfinder vs structural routing.** With non-empty required invariants ([ADR 208 — Invariant-aware migration routing](./ADR 208 - Invariant-aware migration routing.md)), the invariant-aware search may traverse a **self-edge** whose manifest lists the needed `invariantId`s; structural `findPath` still prefers the empty path when `fromHash === toHash` because zero edges is strictly shortest — structural and invariant-aware callers use distinct entry points (`findPath` / `findPathWithInvariants`).
- **Runner upfront skip narrowed.** Matching `plan.origin === plan.destination` (marker already at destination) is **not** sufficient to skip executing work: **self-edges** (same hash on origin and destination) still run unless a **post-hoc self-edge no-op** applies.
- **Post-hoc no-op skip (self-edge only).** After execution, implementations may skip marker and ledger writes when the plan is a self-edge with **nothing executed** (`operationsExecuted === 0`) **and** the edge brings **no new** routing invariants versus the marker (incoming `providedInvariants` ⊆ existing marker set). For non-data ops, `operationsExecuted === 0` covers both "no ops in the plan" and "every op postcheck-pre-satisfied" (skips do not increment the counter). For data ops, `executeDataTransform` always counts the op as executed regardless of whether `run` fired, so this predicate fires only for self-edges with zero data ops; tightening to “did useful work” would change the public semantics of `operationsExecuted` and is left for a deliberate follow-up.
- **`fromHash ≠ toHash` remains the norm** for structural schema moves; self-edges are the narrow carve-out above.

The database stores a contract marker:
- current `coreHash` (and `profileHash`), marker schema version, and a ledger entry per applied edge or task
- the runner refuses to apply an edge if the marker does not match `fromHash`

The planner computes edges by diffing contracts:
- for the MVP we support additive changes
- renames and drops follow via explicit hints to keep planning deterministic

The runner applies edges with safety controls:
- advisory lock per database
- preconditions and postconditions per operation
- transactional apply where possible, chunked or phased when not
- ledger updates only after all steps succeed

Squash and baseline are first-class:
- squashing produces a single edge from a chosen baseline to a target contract
- new environments use a squashed edge to reach the latest contract in one step
- production environments continue along existing paths because their `fromHash` will never match a squashed edge starting at empty

Preflight is mandatory in CI:
- apply edges in a shadow database or run `EXPLAIN`-only checks and return structured diagnostics

## Details

### Edge artifact shape
- `id` stable identifier for human reference
- `fromHash`, `toHash` contract IDs
- `fromContract`, `toContract` complete contract JSON for state reconstruction
- `hints` planner hints and strategies used during planning
- `ops[]` ordered schema operations with pre and post checks
- `tasks[]` optional data operations with verifications and retry guidance
- metadata author, createdAt, planner version, target capabilities used

### Contract storage rationale

Storing complete contracts alongside migrations provides:
- **Complete state reconstruction**: Any migration point can be reconstructed from stored contracts
- **Migration splitting**: Planner can infer intermediate states and generate new edges between any two historical states
- **Enhanced tooling**: Dev CLI and PPg can visualize contract evolution and provide migration impact analysis
- **Agent support**: Complete context for migration analysis and better error messages
- **Audit capabilities**: Full contract context for debugging and compliance

The storage overhead is minimal (contracts are small JSON files) while providing substantial debugging and tooling benefits.

### Operation semantics
- each op declares what it requires to be true before running and what must be true after
- examples: `createTable`, `addColumnNullable`, `addIndex`, `addForeignKey` with index presence checks
- long-running or blocking changes should expose phased variants where relevant

### Node tasks
- used for backfills, data migrations, or one-off rewrites
- may run before or after schema ops as declared
- verified with their own pre and post checks
- can be re-run safely if idempotent or guarded by preconditions

### Ledger
- append-only records of applied edges and tasks with timestamps, actor, and plan hash
- enables auditability and safe replays in preflight

### Planner responsibilities
- compute minimal, deterministic ops for a pair of contracts
- fail fast on non-additive changes unless supported via hints
- include required supporting operations such as equality indexes for foreign keys

### Runner responsibilities
- verify database marker equals `fromHash`
- acquire advisory lock
- execute ops and tasks with verifications
- update marker to `toHash`, write ledger entry
- release lock even on failure

## Alternatives considered

### Linear, file-ordered migrations
- simple mental model but couples behavior to filenames and merge order
- hard to squash cleanly, brittle in multi-branch workflows, difficult for agents to reason about applicability

### Version numbers without content hashes
- easier to read but weak verification
- does not protect against untracked changes or drift

### Declarative apply without explicit edges
- attractive for small systems but hides orchestration decisions
- hard to enforce pre and post checks and to audit what actually ran

### Reject structural-only migrations with `fromHash == toHash` without a carve-out *(superseded for data ops)*

The naive “never allow self-edges” rule appeared in earlier drafts to avoid collapsing graph semantics. **Amendment:** self-edges are allowed when gated by **`data`-class operations** ([ADR 208](./ADR 208 - Invariant-aware migration routing.md) — invariant-aware routing and marker merge). Structural-only duplicates remain rejected.

### Allowing empty migrations as edges with `fromHash == toHash` with no data ops

- still rejected — use attested operation lists; a self-edge without `data` ops is not a valid edge package.

## Consequences

### Positive
- deterministic applicability based on contract markers
- straightforward squashing and baselines
- safer changes through preflight and per-operation verification
- agents and CI can reason about paths and safety using machine-readable artifacts
- decouples collaboration from file order and merge timing

### Negative or trade-offs
- requires maintaining a contract marker in the database
- needs a planner capable of producing deterministic ops
- some operations cannot be fully transactional and must be phased or chunked
- teams must learn the edge vocabulary and how node tasks differ from schema ops

## Scope and non-goals

### In scope for MVP
- additive schema changes on Postgres
- marker, ledger, advisory locking, and preflight
- squashing and baselines
- node tasks for simple backfills

### Out of scope for MVP
- renames and drops without hints
- cross-database families and multi-target edges
- UI for graph visualization

## Backwards compatibility and migration

### From the current Prisma ORM
- provide a one-time converter that reads existing migration history and emits a linear sequence of edges between inferred contract hashes
- custom SQL migrations become node tasks with explicit pre and post checks
- recommend squashing once teams adopt the new model for clean baselines

## Open questions
- minimum hint vocabulary to make renames and drops deterministic
- consistent error taxonomy for planner and runner diagnostics
- retry policies and timeouts for long-running operations
- how to handle capability changes that alter execution but not meaning, tracked via `profileHash`
- guardrails that should block by default versus warn

## Decision record

We adopt a contract-graph model where migrations are edges from `fromHash` to `toHash`, with node tasks for data work. Applicability is enforced by a database marker and per-operation verifications. This enables deterministic planning, safe application, squashing and baselines, and a preflight-first CI story suitable for both humans and agents.

## References

- [ADR 208 — Invariant-aware migration routing](./ADR 208 - Invariant-aware migration routing.md) — routing-visible data transforms (`invariantId`), ref-driven path selection, marker applied-invariants, and `FindPathOutcome` semantics built on this edge model.
