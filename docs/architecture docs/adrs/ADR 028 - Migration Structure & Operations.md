# ADR 028 — Migration structure & operations

> **Update — 2026-10:** edges do not carry the `hints` field shown below. A rename is stated on the command line as a statement, `--rename <old>:<new>`, and the planner turns it into rename operations in the edge's `ops`. See [Migration System § Statements](../subsystems/7.%20Migration%20System.md#statements).

## Context

Prisma Next models migrations as edges between data contract hashes rather than ordered files on disk. The system needs a well-defined migration structure that supports graph reconstruction, deterministic pathfinding, and operational transformations like squashing. Teams want to squash old edges into a baseline to speed fresh environment bootstrap while guaranteeing production safety.

## Decision

Migrations are defined as directed edges in a graph, with rich metadata supporting graph reconstruction and squashing operations:

**Structure (Primary):**
- Migrations are directed edges from `from` → `to` (contract storage hashes) with complete contract context
- Each migration file carries metadata enabling graph reconstruction without a separate ledger
- Baseline migrations can subsume a contiguous path of regular migrations

**Operations (Secondary):**
- Migration operations enable graph management: squash to baseline, rebase, prune
- All operations work directly on migration files without requiring an on-disk ledger
- Tooling validates reachability, detects orphans and cycles, and enforces integrity

**Scope and Relationship:**
- This ADR defines the migration structure (model, on-disk formats, schemas) and the operations that work with that structure
- See ADR 102 for the policy framework that guides when teams should use these operations and how to maintain healthy migration graphs

**Note**: ADR 102 defines the squash-first policy and graph hygiene strategy. ADR 101 provides the Advisors framework. ADR 039 defines migration graph path resolution. This ADR focuses on defining what migrations are and what operations can be performed on them.

This ADR complements:
- ADR 021 Contract marker storage & verification modes
- ADR 039 Migration graph path resolution & integrity
- ADR 037 Transactional DDL fallback & compensation
- ADR 038 Operation idempotency classification & enforcement
- ADR 101 — Advisors framework
- ADR 102 — Squash-first policy & squash advisor

## Scope and Relationship to ADR 102

This ADR defines the **structure** of migrations and the **operations** that work with that structure:

- **Structure**: Migration file model, on-disk formats, schemas, integrity rules
- **Operations**: Squash to baseline, rebase, prune, path checking, graph reconstruction

ADR 102 (Squash-first policy & squash advisor) defines the **policy layer** that guides when and how to use these operations:

- **Policy**: When to squash, thresholds, advisor rules, graph hygiene strategies
- **Composition**: How to recommend and automate the use of these operations

Together, they form composable primitives: ADR 028 provides the mechanisms, ADR 102 provides the policy for using those mechanisms.

## Migration file model
- **Node**: storageHash string identifying a canonical data contract
- **Edge**: Directed transition `from` → `to` (storage hashes) with:
  - edgeId deterministic id derived from content-addressed hashing (see Edge attestation)
  - fromContract, toContract complete contract JSON for state reconstruction
  - hints planner hints and strategies used during planning (derived from authoring-layer annotations or planner configuration, not from the canonical contract IR)
  - ops list in JSON IR or typed program reference
  - pre and post check sets
  - labels optional metadata like branch or tag
  - verified proofs such as shadow apply result, planner version, adapter profile
  - createdAt timestamp for deterministic ordering (recorded in edge manifest)
  - archived boolean flag marking edges superseded by baseline (kept for audit, ignored for pathfinding)

These fields in each migration's `migration.json` enable graph reconstruction without a separate index. See ADR 039 for details on index-optional operation.

No runtime environment state is embedded in migration files

## On-disk format

### File layout
```
migrations/
  2025-01-15T1022_add_users/  # migration package directory
    migration.json            # Contains from/to hashes, ops
    ops.json                  # machine ops IR
    notes.md                  # optional human notes
  2025-02-03T0905_add_posts/
    migration.json
    ops.json
  baselines/
    baseline_zero_to_2025-03-01/
      migration.json
      ops.json
  graph.index.json            # OPTIONAL performance cache
```

### graph.index.json schema (v1) - Optional Performance Cache
```json
{
  "version": 1,
  "nodes": [
    { "coreHash": "000...zero" },
    { "coreHash": "abc...123" },
    { "coreHash": "def...456" }
  ],
  "edges": [
    {
      "edgeId": "edgexxx",
      "from": "000...zero",
      "to": "abc...123",
      "path": "migrations/2025-01-15T1022_add_users",
      "kind": "regular",
      "labels": ["main"]
    },
    {
      "edgeId": "edgeyyy",
      "from": "abc...123",
      "to": "def...456",
      "path": "migrations/2025-02-03T0905_add_posts",
      "kind": "regular",
      "labels": ["main"]
    }
  ],
  "integrity": {
    "createdWith": "prisma-next@0.8.0",
    "generatedAt": "2025-03-01T08:10:10Z"
  }
}
```

**Note**: This index is optional and purely for performance. The system reconstructs the graph from migration files by default.

### migration.json header schema (v1)
```json
{
  "from": "000...zero",
  "to": "abc...123",
  "edgeId": "edgexxx",
  "kind": "regular",
  "fromContract": { /* complete source contract JSON */ },
  "toContract": { /* complete destination contract JSON */ },
  "hints": {
    "used": [],
    "applied": ["additive_only"],
    "plannerVersion": "1.0.0",
    "planningStrategy": "additive"
  },
  "pre": [{ "description": "ensure table \"user\" does not exist", "sql": "SELECT NOT EXISTS (\n  SELECT 1 FROM information_schema.tables\n  WHERE table_schema = 'public' AND table_name = 'user'\n)" }],
  "post": [{ "description": "verify table \"user\" exists", "sql": "SELECT EXISTS (\n  SELECT 1 FROM information_schema.tables\n  WHERE table_schema = 'public' AND table_name = 'user'\n)" }],
  "labels": ["main"]
}
```

edgeId = sha256(canonicalize([
  sha256(canonicalize(migration.json without edgeId)),
  sha256(canonicalize(ops.json)),
  sha256(canonicalize(fromContract)),
  sha256(canonicalize(toContract))
]))

### Edge attestation (hash)

- The edgeId is the canonical, content-addressed digest of the edge header, ops, and referenced contracts. Editing ops or header fields changes the digest.
- Tools provide commands to compute and verify edges. Verification recomputes `edgeId` and checks `{from,to}` hashes against referenced contracts.

## Operations on migration files

### Add migration
- Create new migration package directory with timestamp and slug
- Write migration.json with from/to hashes, ops, and metadata
- Write ops.json with machine operations
- Optional: Update graph.index.json for performance

### Squash to baseline (primary operation for baseline creation)
- Input is an ordered path of migration packages from A to B
- Produce a new baseline migration package A→B embedding destination contract JSON
- Set kind = baseline, place under migrations/baselines/<name>
- Mark superseded migration packages as archived: true in their migration.json
- Archived migrations preserved for provenance/audit but ignored during pathfinding
- Baseline migrations eligible only when all included edges verified or policy allows soft baselines

See ADR 102 for policy decisions on when to squash and graph hygiene strategies.

### Rebase and prune
- If a branch diverges, recompute a migration from current main to branch target
- Old migrations that become unreachable are marked orphaned and can be pruned after policy grace

## Tooling for path checks
- **path-exists(from, to)**: returns whether a reachable path exists and its minimal sequence under deterministic tie-breaks
- **plan-to(from, to)**: returns the concrete sequence of migration packages or a composed baseline migration
- **orphans()**: returns migrations not participating in any path from zero to any referenced target
- **cycles()**: detects cycles which are illegal and must be resolved
- **explain-path(from, to)**: summarizes ops count, risk flags, and whether compensation or non-transactional steps are present

All path operations reconstruct the graph from migration files by default. The optional graph.index.json (ADR 039) is purely for performance optimization. PPg can accept `{ migrations/, graph.index.json (optional), desiredHash }` and reconstruct server-side if no index provided.

## Operation resolution (adapter and packs)

Ops in `ops.json` resolve to executors at apply time:
- Core ops are executed by the target adapter and honor transactional semantics and idempotency (ADR 037, ADR 038).
- Extension ops carry `kind: "ext.op"` and `extId`; they are validated and executed by the corresponding extension pack, with capability gates enforced (ADR 116).
- Pre/post checks use `{ description, sql }` for SQL targets (this ADR §Operation envelope) and the per-family check vocabulary for other targets ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). Canonicalization and deterministic naming make ops hash-stable (ADR 010, ADR 009, ADR 106).

### No compilation at apply time

`ops.json` carries the **post-lowering execution form** for both targets. The runner is a dispatcher, not a compiler: it does not invoke the lowerer, the codec system, the contract validator, or any other build-time pipeline at apply time. See [ADR 192 §"No compilation at apply time"](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md). Concretely:

- Every parameter that reaches a SQL step's `params[]` is already a JSON-safe wire value. Codec metadata (`CodecRef`, `codecId`, `typeParams`) is consumed during lowering and never appears in `ops.json` — see [ADR 212 — AST-bound codec resolution](ADR%20212%20-%20AST-bound%20codec%20resolution.md).
- Every Mongo step is a `kind`-discriminated command that the runner rehydrates via arktype-validated class deserialization before dispatch.
- The on-disk shape is what the driver consumes (modulo target-specific deserialization). No SQL rendering, identifier quoting, or value encoding happens between `ops.json` and `driver.query`.

This invariant is what makes `migrationId` meaningful: the hash pins what executes, not just what the author intended.

## Lifecycle, attestation, and commands (spec overview)

This section aligns lifecycle terminology and commands with the Migration System subsystem.

### States

- Draft: `edgeId` missing/stale
- Attested: `edgeId` computed
- Preflighted: proofs recorded after shadow/hosted run
- Applied: DB marker updated; ledger entry written

### Commands (normative surface)

- Plan: `prisma-next migration plan [--from <hash> --to <hash>]` — produce attested edge from contracts
- New: `prisma-next migration new [--from <hash> --to <hash>]` — scaffold empty edge (Draft)
- Verify: `prisma-next migration verify <dir>` — recompute `edgeId` and check it against the manifest (Attested)
- Preflight (shadow): `prisma-next preflight --mode=shadow --verify-edge` — verify then sandbox
- Preflight (PPg): `prisma-next preflight bundle && prisma-next preflight submit` — hosted preflight with attested edge

### Helpful commands (synopsis)

- `prisma-next migration plan [--from <hash> --to <hash>]` — diff contracts and write an attested edge
- `prisma-next migration new [--from <hash> --to <hash>]` — scaffold empty edge (Draft)
- `prisma-next migration verify <dir>` — recompute `edgeId` and check it against the manifest
- `prisma-next preflight --mode=shadow --verify-edge` — verify then sandbox apply
- `prisma-next preflight bundle` / `submit` — hosted preflight

### Policy knobs (CI/org)

- Require `--verify-edge` in all preflight runs
- Require PPg hosted preflight before promotion to staging/production
- Reject parallel edges (same `from`/`to`, different `edgeId`) unless a policy label is present
- Enforce advisory locks and idempotency class constraints per adapter

### Notes and guardrails

- Any edit to `ops`, checks, or referenced contracts changes `edgeId`; run `migration verify` to update deterministically
- Preflight proofs should persist adapter profile, check outcomes, and timings; hosted runs enforce no-network/no-WASM constraints
- Runner always halts if DB marker != `from`; after apply, it writes `{ core_hash = to, profile_hash }` atomically

## Integrity and validation
- Canonicalization rules per ADR 010 applied before hashing
- Edge ids are deterministic and content-addressed
- CI enforces:
  - no duplicate edgeIds
  - no cycles
  - supersedes lists reference existing migrations
  - baselines cover contiguous paths only

## Parallel edges policy

**Mechanical constraint:**
- Default: parallel edges (same from/to, different opsHash) are rejected
- Override: require explicit parallel-ok label with justification

**Rationale:**
This is an integrity rule, not a hygiene policy. It encourages simpler graph structures and rebase workflows.

See ADR 102 for how parallel edges matter in the context of graph hygiene policy.

## Concurrency and locking
- Local dev uses file-level atomic writes with temp files and rename
- CI and PPg authoring use repo locks or a minimal advisory lock service to serialize migration file edits
- On conflict, tools re-read migration files and reattempt operations with deterministic edgeId regeneration

## Runner interaction
- The database stores a contract marker per ADR 021
- Runner determines the DB's current coreHash and computes a path to target coreHash by reconstructing graph from migration files
- Apply migrations along the path in order, honoring per-op transactional boundaries and compensation
- The DB's coreHash is sufficient to select a path and detect drift; no on-disk ledger required

## Squash semantics and safety

**Technical invariants:**
- Applying a baseline when the DB marker does not match its `from` hash is a hard error
- Baselines can be regenerated at any time from the same contiguous path, yielding the same edgeId due to deterministic canonicalization
- Archived migrations are preserved for audit/visualization but ignored during pathfinding

**Policy guidance:**
See ADR 102 for policy decisions on:
- When to create baselines (development vs. production)
- When baselines should be applied
- Graph hygiene strategies

## Contract reconstruction and splitting
- Stored contracts in migration.json files enable reconstruction of any historical state
- Migration splitting tools can infer intermediate contract states between any two stored contracts
- Planner can generate new migrations between any two historical states using stored contract context
- Tooling can visualize contract evolution and migration impact analysis
- Agents get complete context for migration analysis and debugging

## Contract blob management and GC rules
- Contract blobs are referenced by toContractRef and optionally fromContractRef in migration.json files
- Migrations persist plannerHints as structured JSON for reproducible planning decisions
- GC rules for unreferenced contracts: contracts referenced by active migrations, baselines, or DB markers are retained
- Squash behavior: when squashing migrations, contract references are preserved for audit and visualization
- Contract blob storage is separate from migration storage to enable sharing across multiple migrations
- Tools can identify orphaned contract blobs and provide cleanup recommendations

## Drift detection
- If the DB marker hash is unknown or differs from any migration node, runner reports drift and refuses to choose a path
- Tools provide reconciliation guidance, including planning a corrective migration or instructing a reset path where policy allows

## Observability
- Emit events when migrations are added, squashed, superseded, or pruned
- Surface counts of reachable nodes, orphan migrations, and longest path length
- Expose a simple migrations graph command to render the migration graph for reviews

## Backward and forward compatibility
- graph.index.json is versioned
- New optional fields can be added without breaking older tools
- Major changes to canonicalization or hashing bump version and provide a migration command

## Security and privacy
- Migration files contain no secrets and no parameter values
- Notes may include human context but should not include PII by default

## Alternatives considered
- **Pure file-order migrations with applied history in DB**: Simpler but loses determinism, is fragile under branching, and complicates squashing
- **Embedding the full graph in each edge package**: Bloats artifacts and complicates edits, single ledger is simpler and auditable

## Open questions
- Do we support multiple ledgers per repo for multi-service monorepos or enforce one ledger per contract root
- **Resolved in ADR 102**: Retention windows via squash-first policy handle this. Superseded edges remain on disk with `archived: true` flag and are ignored during pathfinding.
- Do we allow partial squashes that keep certain edges for audit reasons while collapsing others

## Acceptance criteria
- Deterministic path computation from any known coreHash to target coreHash
- Squash produces an identical edgeId when repeated on the same path
- Tools detect and refuse cycles, orphans, and non-contiguous supersedes
- Runner can bring a fresh DB from zero to target using either full path or a single baseline edge without divergence
