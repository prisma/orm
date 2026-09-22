# ADR 051 — PPg preflight-as-a-service contract

**Status:** Superseded as a core-CLI contract. Diffing is fully offline against on-disk contract snapshots, the CLI never provisions a shadow database, and there is no core sandbox-execution verb. Preflight returns as a database-extension hook: an extension may execute the attested `ops.json` against a fork of a target database and report timing and errors, and Prisma Postgres will provide such a hook. See [CI Integration § No shadow database](../subsystems/8.%20CI%20Integration.md#no-shadow-database). The content below is preserved as a historical record of the superseded design.

## Context

Prisma Postgres (PPg) will offer a hosted preflight that validates schema changes and query Plans before they reach production. The service must be deterministic, secure, and yield the same outcomes as local preflight while never accessing user repositories or package managers. Custom migration operations must run in a tightly sandboxed environment with no network access

## Problem

- Hosted preflight must execute user-authored custom ops safely without network access
- Inputs must be deterministic and self-contained for validation and execution in isolation
- Results must be cryptographically tied to inputs and consistent with local preflight
- The service must integrate cleanly with CI and promotion gates without repo checkout

## Decision

PPg accepts only a deterministic migration bundle artifact, optionally signed, and executes preflight in two modes

- **EXPLAIN-only**
  Validate Plans and budgets via normalized EXPLAIN without applying DDL
- **Shadow apply**
  Apply the migration path in an isolated branch database with pre and post checks, then tear down

Parity with local tools is guaranteed via shared schemas, hashing, capability discovery, and stable error envelopes

## Inputs: Bundle format and signature

### Bundle structure

- **bundle.json**
  Index with bundleSchemaVersion, coreHash, profileHash, target profile, edge list, Node target, creation metadata
- **contract.json**
  Canonical data contract
- **migrations/*/migration.json**
  Migration definitions pinned by fromHash → toHash with op refs and arguments
- **ops/*.js**
  Self-contained ESM files for each op used by edges, deps inlined
- **ops/*.manifest.json**
  Manifests declaring inputs schema, pre and post checks, privilege, idempotency, requiresTx, target compatibility
- **fixtures/**
  Optional seed or fixtures for shadow DB

### Validation rules

- **Content integrity**
  SHA-256 digests of bundle members must match the index
- **ESM compliance**
  ops/*.js must be valid ESM with no dynamic import() or require
- **Manifest validation**
  Required security and compatibility fields present and valid
- **Node target compatibility**
  Bundle declares a supported Node target that PPg advertises for preflight
- **Size limits**
  Bundle size capped per tier with clear errors when exceeded

### Signature policy

- **Production**
  Signed bundles required by org policy
  JSON Web Signature (JWS) with Ed25519 or RSA-PSS containing a digest of the bundle
  Trust roots managed per org or project, rotation supported
- **Development**
  Signature optional, integrity checks still enforced

## Modes and lifecycle

### Submission

CI or PPg UI uploads a bundle, selects mode explain | shadow, and specifies the base DB contract hash detected from the live marker

### Validation

PPg verifies signature, integrity, bundle schema version, capability compatibility, and forbids unsupported features

### Execution

- **EXPLAIN-only**
  Compile Plans using the adapter profile, run lints and budgets, collect diagnostics
- **Shadow apply**
  Provision an isolated branch DB, apply fixtures, acquire advisory lock, resolve a path from current DB coreHash to target coreHash, execute edges with pre and post checks, collect diagnostics, tear down

### Completion

Store diagnostics and artifacts, emit results and optional webhooks, and enforce promotion gates if configured

## Job states

ACCEPTED → QUEUED → PROVISIONING (shadow only) → EXECUTING → COMPLETED | FAILED | INCONCLUSIVE

## API surface

- `POST /preflight/bundle`
  Submit bundle and options
- `GET /preflight/{jobId}/status`
  Poll status and progress
- `GET /preflight/{jobId}/results`
  Retrieve diagnostics and artifact links
- `POST /preflight/{jobId}/cancel`
  Best-effort cancellation

### Request example

```json
{
  "bundle": {
    "signature": "eyJhbGciOiJFZERTQSJ9...",
    "digest": "abc123...",
    "metadata": {
      "coreHash": "def456...",
      "profileHash": "ghi789...",
      "nodeTarget": "18.19.x",
      "createdAt": "2025-10-18T12:00:00Z"
    }
  },
  "preflight": {
    "mode": "shadow",
    "budgets": { "maxRows": 10000, "maxLatencyMs": 200, "maxSqlBytes": 200000 },
    "lint": { "mode": "strict" }
  }
}
```

### Result example

```json
{
  "status": "pass",
  "jobId": "pf_2025_10_18_12_03_11_Z_abc123",
  "mode": "shadow",
  "summary": { "plans": 42, "errors": 0, "warnings": 3, "durationMs": 45000 },
  "violations": [
    { "type": "lint", "rule": "no-select-star", "severity": "warning", "planId": "0a3c6e4b-..." }
  ],
  "artifacts": {
    "events": "https://ppg.example.com/preflight/pf_123/events.ndjson",
    "summary": "https://ppg.example.com/preflight/pf_123/summary.json",
    "explain": "https://ppg.example.com/preflight/pf_123/explain.tar.gz"
  }
}
```

## Parity guarantees

- **Rules**
  Same taxonomy and levels as client runtime per ADR 022
- **Budgets**
  Same evaluation semantics, EXPLAIN policy, and SQL fingerprinting per ADR 023 and ADR 092
- **Errors**
  Same error envelope and codes per ADR 027
- **Capabilities**
  Same adapter capability discovery per ADR 031 and ADR 065
- **Hashing**
  Same contract hashing and lane-agnostic Plan hashing per ADR 004 and ADR 013
- **Determinism**
  Shadow preflight uses advisory locks and idempotency semantics per ADR 037 and ADR 038

## Sandbox constraints

- No network egress from ops
- No WASM engines in v1
- Process isolation with per-op CPU, memory, and wall-clock limits
- No shell execution, no external processes
- Limited temporary filesystem access only
- Least-privilege database roles per ADR 078

## Promotion gates

- Configurable gate conditions per project
- Contract markers aligned between app and DB
- Budgets passed and lint levels satisfied
- Path from DB hash to target hash exists and edges apply cleanly
- Index advisor findings acknowledged when required
- PPg attaches gate results to PRs or change sets and stores evidence artifacts for audits

## SLOs and observability

- SLO bands by bundle size and plan count published for
  - Bundle validation duration
  - EXPLAIN-only duration
  - Shadow apply duration
- Metrics and telemetry per ADR 024 with param redaction
- Queue latency, execution latency, and artifact availability tracked
- Graceful degradation to EXPLAIN-only mode when shadow provisioning is impaired

## Security, privacy, and compliance

- Auth via API key or OAuth token, project-scoped authorization and rate limits
- Optionally require signed bundles for non-dev orgs
- Parameter redaction, sensitivity taxonomy, and evidence artifacts per ADR 024 and ADR 079
- Data residency controls for artifacts and logs
- Retention windows configurable by tier

## Failure modes

- **Bundle errors**
  Invalid signature, unsupported schema version, malformed structure, missing files
- **Execution errors**
  Sandbox violations, resource caps exceeded, migration failures, pre or post checks failing
- **Infrastructure errors**
  Shadow DB provisioning failures or service incidents return inconclusive with stable error codes
- Deterministic retries for transient errors with bounded backoff

## Compatibility and versioning

- bundleSchemaVersion declared in the bundle and validated by PPg
- Node target declared and pinned in the bundle with a published compatibility window
- Backward-compat policy documented, with clear rejection for unsupported versions

## Alternatives considered

- **Evaluating user repositories or monorepos in PPg**
  Rejected for security and non-determinism
- **Dynamic network fetching of ops or registry-based loading**
  Rejected for supply chain and determinism concerns
- **Container images per run**
  Rejected for complexity and cold start overhead for v1

## Consequences

### Positive

- Strong isolation and determinism without accessing user repos
- Parity with local preflight through shared schemas and hashing
- Clear integration with CI and promotion gates

### Negative

- Users must bundle ops, which increases dev workflow complexity
- Larger artifacts due to inlined deps
- Shadow provisioning adds cold-start latency

### Mitigations

- Provide a one-command migrate bundle with clear diagnostics and tree-shaking
- Cache sandbox images and pre-provision pool capacity
- Offer rich artifacts and explainability for quick iteration

## References

- ADR 029 — Shadow DB preflight semantics
- ADR 041 — Custom operation loading via local packages + preflight bundles
- ADR 022 — Lint rule taxonomy & configuration model
- ADR 023 — Budget evaluation & EXPLAIN policy
- ADR 027 — Error envelope & stable codes
- ADR 031 — Adapter capability discovery
- ADR 013 — Lane-agnostic Plan identity and hashing
- ADR 039 — Migration graph path resolution & integrity
- ADR 024 — Telemetry schema & privacy
