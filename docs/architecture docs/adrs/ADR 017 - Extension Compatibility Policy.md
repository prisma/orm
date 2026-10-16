# ADR 017 — Extension and Alternate Runtime Compatibility Policy

**Amended by [ADR 274](ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md):** the clients no longer accept `contractJson`. They take a contract value, and emitted JSON becomes that value through `contractFromJson<Contract>(json)`.

## Context

- Prisma Next intentionally supports multiple query authoring lanes and invites third parties to add new lanes or even alternate runtimes
- Safety and observability must remain consistent regardless of who authored the Plan or who executes it
- Without a clear compatibility policy, ecosystem contributions risk fragmenting safety guarantees and developer experience

## Decision

- Define a compatibility policy for third-party lanes and alternate runtimes
- Conformance is measured against a small set of normative contracts:
  - Data contract JSON, Unified Plan model, Plan identity and hashing, Hook API v1
- Publish a versioning and compatibility matrix so contributors know which combinations are supported

## Requirements for third-party lanes

A lane is any tool or library that produces executable Plans.

### Must

- Emit Plans that conform to ADR 011 Unified Plan model
- Stamp `meta.coreHash` of the active data contract and target in `meta.target`
- Respect Plan immutability per ADR 002
- Produce deterministic SQL for a given input and adapter profile
- For raw SQL lanes, include the required annotations per ADR 012
- Avoid embedding ephemeral data in SQL or meta that would break hashing stability per ADR 013
- Document the adapter capability expectations and minimum versions they rely on
- Accept either `contractJson` or a TS contract object, but must canonicalize the latter to compute coreHash

### Should

- Populate `meta.refs` and `meta.projection` when available to strengthen guardrails
- Provide a stable Plan factory API for agents and CI use
- Ship golden tests demonstrating byte-stable SQL for representative inputs

### Must not

- Depend on private runtime internals or mutate Plans in place

## Requirements for hosted runtimes

Hosted runtimes (e.g., PPg services) have additional security constraints:

- Must not evaluate TS contracts; JSON-only allowed for security
- Must accept only canonical contract JSON from trusted sources
- Must validate `contract.canonicalVersion` and `schemaVersion` before processing
- Must not execute untrusted codecs or custom extensions without explicit policy

## Requirements for alternate runtimes

A runtime is any executor that accepts Plans and talks to a database.

### Must

- Verify `meta.coreHash` against the active data contract marker before execution
- Implement the Hook API v1 contract per ADR 014 and call registered plugins in order
- Enforce lint levels and budget decisions consistently with core semantics:
  - `error` blocks, `warn` logs and continues, `off` ignores
- Treat Plans as immutable inputs and only return derived results
- Compute and attach `planId` and `sqlFingerprint` per ADR 013 for telemetry
- Respect canonicalization rules from ADR 010 when reading the data contract
- Use adapter profiles conforming to ADR 016 for lowering when the lane provides an AST

### Should

- Expose a configuration surface to toggle strict vs permissive policy modes
- Provide structured error envelopes with phase and stable error codes
- Record execution metrics and violations in an exportable format

### Must not

- Execute a Plan whose `meta.target` does not match the configured adapter
- Downgrade violations from error without explicit configuration

## Conformance levels

To make adoption incremental, we define levels:

### Producer levels
- **L0 Producer**: emits valid Plans with `sql`, `params`, `meta.target`, `meta.coreHash`, and minimal annotations for raw
- **L1 Producer**: adds deterministic emission guarantees and fills `refs` and `projection`
- **L2 Producer**: ships golden tests and an agent-friendly Plan factory API

### Runtime levels
- **L0 Runtime**: executes Plans and verifies coreHash
- **L1 Runtime**: implements Hook API v1, lint levels, and budgets
- **L2 Runtime**: surfaces telemetry with `planId`, `sqlFingerprint`, and structured diagnostics

We will certify third-party components at L0, L1, or L2.

## Versioning and compatibility matrix

### Artifacts and contracts with semver

- **Data contract JSON schema**: `contractSchema` version in file and package version in `@prisma/relational-ir`
- **Unified Plan model**: exported TypeScript types and JSON schema
- **Hook API**: `hooksVersion: 1` for v1, bump on breaking change
- **Adapter SPI**: per-adapter version and capability set

### Minimum compatible versions

| Producer Lane | Plan model | Hook API required | Adapter SPI | Contract schema |
|---------------|------------|-------------------|-------------|-----------------|
| SQL DSL core | v1 | none | v1 | v3 |
| ORM over DSL | v1 | none | v1 | v3 |
| Raw SQL | v1 | none | n/a | v3 |
| TypedSQL CLI | v1 | none | v1 for validation | v3 |

| Runtime | Accepts Plan model | Hook API | Adapter SPI | Contract schema |
|---------|-------------------|----------|-------------|-----------------|
| Core runtime | v1 | v1 | v1 | v3 |
| Alt runtime L1 | v1 | v1 | v1 | v3 |

### Rules

- A runtime must reject Plans whose `meta.target` requires an adapter profile the runtime does not have or whose Plan model major version is unknown
- Lanes may support newer Plan minor versions if they are backward compatible

## Validation and certification

- Provide a conformance test kit:
  - JSON fixtures for Plans, golden SQL cases, simulated hook pipelines
- Third-party maintainers can run the kit locally and submit results for certification
- Certified components are listed with their conformance level and supported versions

## Rationale

- Encourages ecosystem growth while keeping a consistent safety story
- Lane neutrality plus Plan immutability means plugins and policies work the same everywhere
- Versioned contracts make upgrades predictable and reversible

## Alternatives considered

- **No policy, rely on informal guidance**: Leads to fragmentation and undermines trust
- **Forcing contributions to live in core**: Slows innovation and violates thin core, fat target

## Consequences

### Positive

- Clear path for community lanes and runtimes to integrate without weakening safety
- Easier to reason about support boundaries and debug cross-component issues
- Enables PPg to run the same guardrails server-side on third-party Plans

### Trade-offs

- Conformance and certification introduce some overhead for contributors
- Version skew must be managed with tooling and documentation

## Testing

- Add conformance suite to the repo and CI
- Require conformance on core components and publish results
- Gate adapter and Plan changes on golden tests and identity stability

## Open questions

- Whether to include an official badge program and automated nightly conformance runs
- How to handle experimental hook APIs without fracturing v1

## Decision record

- Adopt a formal compatibility policy for third-party lanes and alternate runtimes
- Require honoring the Plan contract, verifying coreHash, respecting immutability, and documenting hooks
- Publish a versioning and compatibility matrix and ship a conformance kit to enable safe ecosystem growth
