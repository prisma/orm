# ADR 029 — Shadow DB preflight semantics

**Status:** Superseded. The Prisma Next CLI never provisions or replays against a shadow database: every migration's bookend contracts are stored as on-disk snapshots, so diffing is fully offline, and no core sandbox-execution (`preflight`) verb exists. Rehearsing a migration against a fork of a real database is a hook a database extension may provide, and the CLI exposes it only when the configured extension implements one. See [CI Integration § No shadow database](../subsystems/8.%20CI%20Integration.md#no-shadow-database). The content below is preserved as a historical record of the superseded design.

## Context

We want a safe way to validate migrations and Plans before production apply. Teams run preflight in CI and we will also offer PPg preflight-as-a-service. Preflight must be deterministic, isolated, resource-bounded, and leave no residue. Some checks require a real database state, others can run in EXPLAIN-only mode. Preflight artifacts feed developer UIs, agents, and compliance tooling.

## Decision

Define a standard preflight job model with two execution modes and strict lifecycle semantics:

- **Shadow DB mode** creates an ephemeral database, applies the computed migration path, runs checks and sample Plans, and emits diagnostics
- **EXPLAIN-only mode** skips data changes, compiles Plans, runs EXPLAIN and static guardrails, and emits diagnostics when shadow provisioning is unavailable or denied by policy

Both modes share the same job envelope, diagnostics schema, and exit codes, enabling CI and PPg to enforce budgets and block risky changes consistently

## Preflight job envelope

```json
{
  "jobId": "pf_2025_10_18_12_03_11_Z_abc123",
  "mode": "shadow" | "explainOnly",
  "target": {
    "adapter": "postgres",
    "profileHash": "...",
    "version": "15"
  },
  "contract": {
    "toHash": "to...",
    "toContract": { /* complete destination contract JSON */ },
    "migrationsPath": "migrations/",
    "fromHashHint": "from..."
  },
  "plans": [
    { "kind": "dsl", "plan": { /* Plan JSON, annotations only, no params */ } }
  ],
  "seed": {
    "strategy": "none" | "fixtures" | "snapshot",
    "fixturesPath": "seed/fixtures/*.sql",
    "snapshotRef": "ppg:snapshots/main@2025-10-10"
  },
  "budgets": {
    "timeMs": 600000,
    "rows": 1000000,
    "sizeBytes": 104857600
  },
  "limits": {
    "maxDbSizeBytes": 1073741824,
    "maxRuntimeMs": 900000,
    "maxConcurrentJobs": 3
  }
}
```

### Notes
- `toHash` is the desired contract for the branch
- `toContract` provides complete context for preflight analysis and diagnostics
- `fromHashHint` is optional and used for diagnostics if the runner can't derive it from a remote marker
- Plans are optional for a migrations-only preflight

## Lifecycle

### States
- **QUEUED**: job admitted within concurrency limits
- **PROVISIONING**: allocate shadow environment
- **MIGRATING**: apply path from fromHash to toHash
- **CHECKING**: run pre/post checks, budgets, EXPLAINs, optional sample Plans
- **ARCHIVING**: persist diagnostics and minimal logs
- **TEARDOWN**: drop shadow resources and revoke creds
- **DONE**: success or failure

### Exit codes
- **0**: success with no blocking violations
- **2**: blocking violation (lint error, budget exceed, migration failure)
- **3**: infrastructure failure (provisioning, teardown) treated as retryable
- **4**: policy denied (e.g., shadow disabled) caller must switch to EXPLAIN-only

## Shadow DB semantics

### Creation
- Use per-job unique database name or tenant namespace
- Credentials are per-job and least-privilege for migration and diagnostics roles
- Enforce hard caps on size, duration, and concurrent sessions

### Seeding
- **none**: creates empty DB at fromHash path head
- **fixtures**: executes a deterministic ordered set of fixture files
- **snapshot**: clones from a pre-approved sanitized snapshot reference

### Isolation guarantees
- No cross-job visibility of data or metadata
- No shared prepared statements, extensions, or schemas unless explicitly declared as read-only base images
- Advisory locks are job-scoped and released on teardown per ADR 043

### Teardown
- Drop database or namespace, revoke credentials, and clear PS caches
- Retry with exponential backoff on drop failure, then mark as LEAKED with cleanup ticket
- Emit a signed deletion receipt for audit when PPg manages the environment

### Path computation and apply
- Resolve path by reconstructing graph from migration files per ADR 028 and optional graph.index.json per ADR 039
- If fromHash cannot be derived, emit CONTRACT.MARKER_MISSING and refuse shadow mode unless policy allows reset to zero
- Apply migrations with advisory locks, respecting per-op transactional boundaries and compensation plans per ADR 037
- Idempotency classification per ADR 038 determines whether a repeated migration is safe no-op or a conflict

### Canonical JSON consumption
- Preflight jobs must consume canonical JSON; if TS is provided, a trusted emitter step produces JSON inside the job sandbox
- Record the exact canonical blob used for the job for auditability
- Contract canonicalVersion and schemaVersion must be validated before processing
- TS contracts are not evaluated directly in preflight for security; only canonical JSON is accepted
- **Migration Bundle Consumption**: For hosted preflight, consumes pre-built migration bundles containing compiled ops and manifests, never resolves user repositories or package managers

## Checks and diagnostics

### What runs in CHECKING
- Pre and post checks defined on edges per [ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md) (SQL) / [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) (Mongo)
- Lint rules at the configured policy level per ADR 022
- Budgets evaluation including EXPLAIN policies per ADR 023
- Optional dry-run of sample Plans against shadow with bounded LIMIT and statement timeouts
- Drift detection between applied state and toHash

### Diagnostics schema
- Summary status and exit code
- Contract context: fromHash, toHash, adapter profile
- Path summary: edgeIds, counts, non-transactional steps, compensation steps
- Violations list with RuntimeError envelopes per ADR 027
- EXPLAIN artifacts normalized and redacted
- Timing and resource usage snapshot
- Links to logs and seed provenance

## EXPLAIN-only mode
- Skips PROVISIONING and MIGRATING
- Compiles Plans and runs static lints and EXPLAIN policies
- Uses adapter capability discovery per ADR 031 to decide EXPLAIN variant and normalization
- Emits the same diagnostics schema with mode = explainOnly, marking checks that were skipped

## Limits and budgets

### Time
- Global job time budget limits.maxRuntimeMs
- Per-statement timeouts for migration steps and Plan checks
- Budget overages produce BUDGET.TIME_EXCEEDED

### Space
- Hard cap limits.maxDbSizeBytes enforced via database quotas or runner monitoring
- Space overage produces BUDGET.SIZE_EXCEEDED and initiates teardown

### Rows
- Row budget applies to Plan checks and is estimated via EXPLAIN or bounded sampling

### Concurrency
- limits.maxConcurrentJobs enforced per project and per organization to prevent noisy neighbor effects

## PPg preflight-as-a-service specifics
- Ephemeral DBs provisioned in the same region and major version as target environments
- Optional sanitized snapshot catalog maintained per customer for realistic statistics
- Webhook signing and replay protection per ADR 086
- UI surfaces path, risks, and diffs between commits with stable links to diagnostics
- Automatic teardown on webhook delivery success or after retention window

## CI integration
- Official GitHub/GitLab app posts status checks with exit code mapping
- CLI returns exit codes described above and prints a concise summary with a link to full diagnostics
- `--explain-only` flag supported as a fallback when shadow is unavailable

## Privacy and redaction
- No raw parameter values or row data persisted in diagnostics unless explicitly enabled
- EXPLAIN artifacts are normalized and may mask identifiers by sensitivity tags per ADR 079
- Seed snapshots must be sanitized and tagged; PPg enforces policy on snapshot usage

## Observability
- Emit telemetry per ADR 024 with plan and migration fingerprints, durations, and outcomes
- Surface percent of jobs blocked by budgets vs lints, median path length, average edge apply time
- Track leaked resources and time-to-cleanup SLOs for PPg

## Failure handling
- Provisioning failure → PREFLIGHT.SHADOW_FAILED with retry advice
- Migration failure → MIGRATION.* error with op context and logs
- Budget or lint failure → BUDGET.* or LINT.* with configured severity
- Infrastructure disruption → RUNTIME.BACKPRESSURE or CONFIG.INCOMPATIBLE_VERSION as appropriate

## Acceptance criteria
- Same job envelope works for CI and PPg with identical exit codes
- Shadow jobs are isolated, bounded, and leave no residue under normal operation
- Deterministic path computation and apply semantics match ADR 028 and ADR 039
- Diagnostics are redacted, stable, and consumable by agents and UIs
- EXPLAIN-only mode provides meaningful signal when shadow is unavailable

## Alternatives considered
- **Always-shadow approach**: More signal but infeasible for restricted environments and higher cost
- **Simulated planner without DB or EXPLAIN**: Too little signal to catch performance regressions and risky plans

## Open questions
- Do we allow limited data sampling from production for statistics only with strict redaction
- Should we support multi-DB preflight for sharded or federated deployments
- Do we expose a plugin hook for custom checks during CHECKING while preserving isolation guarantees
