# ADR 117 — Extension capability keys

**Profile hash inputs superseded by** [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md): the profile hash covers only `targetFamily`, `target` and the contract's `capabilities` section, with no adapter pins or pack choices, and the rules do not change within a major.

## Context

Targets like Postgres can be extended with packs such as pgvector and PostGIS. These introduce new types, operators, indexes, and DDL features that must be surfaced to:

- Gate migration ops and planner strategies
- Guide lowering choices in lanes without branching on target strings
- Enable preflight guardrails to warn or block when capabilities are missing or underspecified

We need a canonical, namespaced vocabulary for capabilities and a negotiation mechanism that adapters and extension packs can rely on uniformly.

## Problem

- Today, feature checks are ad hoc and scattered across planner, lowerers, and runtime
- Without a stable capability keyspace, community packs cannot reliably gate behavior or provide clear errors
- Version and algorithm choices vary by extension and server version, making boolean flags insufficient
- Results must be deterministic and cacheable so that agents and CI get consistent outcomes

## Decision

Define a canonical capability key schema and a negotiation contract at connect time. Adapters report a capabilities document, extension packs declare requirements and preferred options, and the runtime computes a negotiated profile that downstream components consume via a stable API. Capabilities are namespaced, typed, and hashable, and the negotiated profile contributes to the `profileHash` used in verification.

## Capability key schema

### Namespacing

- **core.*** platform-neutral primitives the runtime expects (e.g. `core.advisoryLock`, `core.transactionalDDL`)
- **sql.*** common SQL features regardless of vendor (e.g. `sql.lateral`, `sql.jsonAgg`, `sql.returning`, `sql.concurrentIndex`)
- **ext.<pack>.*** extension-specific features published by a Target Extension Pack (e.g. `ext.pgvector.*`, `ext.postgis.*`)

### Key naming rules

- Lowercase segments separated by dots
- Family → feature → variant ordering, e.g. `ext.pgvector.index.ivfflat`, `ext.pgvector.metric.cosine`
- No target brand leakage into `sql.*` keys
- Stable across releases; deprecations must keep old keys until a major version of the pack

### Value types

- **boolean**: available or not
- **enum**: one-of values for mutually exclusive variants
- **semver**: version string for installed extension or server
- **range**: semver range supported, expressed as `{ min: "x.y.z", max?: "a.b.c" }`
- **record**: feature map with boolean leaves, used for families of algorithms or operator classes

### Examples

```json
{
  "core.advisoryLock": true,
  "core.transactionalDDL": false,
  "sql.lateral": true,
  "sql.jsonAgg": true,
  "sql.concurrentIndex": true,
  "ext.pgvector.version": "0.7.2",
  "ext.pgvector.metric.cosine": true,
  "ext.pgvector.metric.euclidean": true,
  "ext.pgvector.index.ivfflat": true,
  "ext.pgvector.index.hnsw": false,
  "ext.pgvector.opclass.vector_cosine_ops": true,
  "ext.postgis.version": "3.4.2",
  "ext.postgis.geometry.types": {
    "point": true,
    "linestring": true,
    "polygon": true
  },
  "ext.postgis.index.gist": true,
  "ext.postgis.index.spatialHash": false
}
```

## Negotiation flow

1. **Discovery**
   - On `connect()`, the adapter probes the target with a bounded, deterministic set of catalog queries to produce a capabilities document. The adapter may merge static knowledge (server version) and extension discovery into one report

2. **Pack declaration**
   - Each installed extension pack provides a machine-readable declaration of required and optional keys with constraints and fallbacks, e.g.:

```json
{
  "requires": {
    "ext.pgvector.version": ">=0.6.0",
    "sql.concurrentIndex": true
  },
  "prefers": {
    "ext.pgvector.index.hnsw": "try"
  }
}
```

3. **Runtime negotiation**
   - The runtime validates adapter capabilities against all registered pack declarations. The result is a profile object with:
     - `supported` map of keys and chosen variants
     - `warnings` for unmet preferences
     - `errors` for unmet requirements

4. **Outcome**
   - If any requires fail, `connect()` fails with `E_CAPABILITY_NEGOTIATION_FAILED` and a stable error envelope
   - Otherwise, the runtime exposes `getCapabilities()` and a stable `profileHash` derived from the negotiated profile

5. **Usage**
   - Lanes and planners branch on capabilities, not target strings
   - Extension-aware ops (ADR 116) must check capabilities before emit and before apply
   - Preflight enforces the same profile checks for parity

## Profile hash

- `profileHash = sha256(canonicalize(capabilities ∪ pack choices))`
- Stored in memory and available to tools
- Optional to persist alongside `coreHash` in the DB marker per ADR 021 to detect drift due to infra changes

## Adapter obligations

- Implement capability discovery with bounded, documented queries and timeouts
- Report a complete, canonicalized map that is stable across minor adapter versions
- Version discovery routines and include `adapterVersion` in diagnostics
- Provide golden fixtures for capability reports across supported server versions and common extension states

## Extension pack obligations

- Publish a JSON schema for declared keys and their meanings
- Provide `requires` and `prefers` with explicit failure modes and suggested remediations
- Keep keys stable across pack minor versions and document deprecations
- Ship conformance tests asserting planner and op gating behaves correctly under simulated capability sets

## Error semantics

- Missing required key → `E_EXT_CAPABILITY_MISSING` with key, expected, actual, advice
- Unsupported variant chosen by user hint → `E_EXT_VARIANT_UNSUPPORTED`
- Ambiguous capability state due to permissions → `E_CAPABILITY_PROBE_DENIED`

All map to `RuntimeError` per ADR 027 and adapter-to-runtime mapping per ADR 068.

## Performance and caching

- Capability discovery should complete in under 50 ms p95 on warm connections for common targets
- Adapters may cache results per process with an eviction policy and expose a `capabilityTTL` hint
- The runtime should memoize the negotiated profile per connection pool, recomputing only when server version or extensions change

## Security & privacy

- Discovery queries must not enumerate user data or traverse arbitrary schemas
- No network calls or dynamic imports
- The capability report contains only feature flags and versions, never PII

## Test strategy

- Golden JSON fixtures for capability reports by server and extension version
- Negotiation unit tests with synthetic capability maps covering require/fallback paths
- Planner and op gating integration tests that flip keys to simulate missing features
- Preflight parity tests ensuring the same negotiation outcome in hosted and local modes

## Alternatives considered

- **Encode capabilities inside the data contract**
  - Rejected for dynamism: contract describes intended shape, capabilities describe runtime environment and can change without contract edits
- **Free-form "feature hints" strings**
  - Rejected due to poor tooling, no typing, and fragile branching in lanes

## Consequences

### Positive

- Removes target string conditionals from lanes and planners
- Makes extension ops and guardrails predictable and easy to reason about
- Enables adapter ecosystem to converge on a shared vocabulary

### Negative

- Requires upfront investment to define and maintain key catalogs
- Adds a negotiation step at connect time, albeit fast and cacheable

## Open questions

- Do we persist `profileHash` in the DB marker by default or only in PPg
- Should we allow capability overrides for testing to simulate future upgrades
- How do we model capabilities for non-SQL targets in a way that keeps key reuse sensible across families
