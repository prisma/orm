# ADR 031 — Adapter capability discovery

## Context

Prisma Next supports multiple SQL dialects via adapters. Lanes (DSL, ORM, TypedSQL, Raw) lower abstract Plans to dialect SQL. Some SQL features are optional or versioned (e.g., LATERAL, json_agg, transactional DDL, concurrent index creation). We need a consistent way for adapters to surface capabilities and for lanes to react when features are missing or discouraged.

## Problem

- Lanes must not emit SQL that the target cannot execute
- Capability presence can be static (dialect design) or runtime-dependent (server version, extensions, config)
- We need deterministic lowering and stable failure modes across environments
- Plans and caches must vary when capabilities change to avoid stale or unsafe SQL

## Goals

- Define a capability model covering static and runtime-discovered features
- Provide a verification flow that checks database capabilities satisfy the contract-declared requirements
- Let lanes declare required vs optional capabilities and degrade or fail deterministically (based on contract-declared caps)
- Allow feature flags to pin or disable capabilities for safety or perf reasons
- Keep the lowering responsibility in adapters, preserving lane portability

## Non-goals

- Implement automatic multi-statement fallbacks that violate the one-call → one-statement rule. This rule binds the lanes. The ORM client is the layer permitted to orchestrate several statements for one call ([ADR 164](ADR%20164%20-%20Repository%20Layer.md))
- Auto-enable database extensions or mutate server config during discovery
- Encode business policies in the capability layer

## Decision

### Capability taxonomy

Capabilities are simple string identifiers, versioned when needed, grouped by domain:

- **SQL core**: `cte`, `recursiveCte`, `lateral`, `windowFunctions`, `generatedColumns`
- **JSON/arrays**: `json`, `jsonb`, `jsonAgg`, `arrayAgg`, `unnest`
- **DDL**: `transactionalDdl`, `concurrentIndex`, `ifExists`, `ifNotExists`, `columnIdentity`
- **Indexes**: `btree`, `hash`, `gist`, `gin`, `partialIndex`, `expressionIndex`
- **Extensions**: `postgis@>=3.1`, `vector@>=0.5`, `pgcrypto`, `citext`
- **Behavioral**: `readCommitted`, `serializable`, `planHints`, `explainAnalyze`
- **Limits**: `maxParams@N`, `maxIdentifierLen@N` (numeric payloads modeled via profile metadata)

Each capability is documented with a short description, references, and conformance tests.

### Surfacing capabilities

Adapters expose two layers:

- **Static**: baked into the adapter for the dialect or profile family
  - Example: MySQL lacks lateral, Postgres has lateral
- **Runtime**: discovered per connection profile by probing the server
  - Example: server version, loaded extensions, config flags, SHOW values

### Discovery API

```typescript
type AdapterProfile = {
  adapterName: 'postgres' | 'mysql' | 'sqlite' | string
  adapterVersion: string
  staticCaps: Set<CapabilityId>
  runtimeCaps: Set<CapabilityId>
  serverMeta: {
    serverVersion?: string
    extensions?: Record<string, string> // name -> version
    limits?: { maxParams?: number; maxIdentifierLen?: number }
  }
  profileHash: string // see below
}
```

### Verification (pinned profile)

During verification (`prisma-next verify` or runner apply):
1. Adapter reports `staticCaps`
2. Adapter runs lightweight probes to compute `runtimeCaps` and `serverMeta`
3. Tooling checks that `(static ∪ runtime)` satisfies the contract-declared capability requirements
4. On success, the runner writes the contract's `coreHash` and `profileHash` to the marker

### Feature flags

```typescript
type CapabilityPolicy = {
  forceEnable?: CapabilityId[]   // pin on, useful in tests
  forceDisable?: CapabilityId[]  // pin off for safety or perf
  prefer?: CapabilityId[]        // tie-break hints for adapters
}
```

The effective capability set is:

```
effective = (static ∪ runtime ∪ forceEnable) \ forceDisable
```

The adapter may use `prefer` to choose among multiple legal lowerings.

### Profile hash

- `profileHash` is contract-derived from declared capability keys/variants and optional adapter pins.
- Included in artifacts and in the database marker; Plans may carry it in `meta` for diagnostics.
- Used to enforce equality with the marker at runtime; caches may key on `(sqlFingerprint, coreHash, profileHash)` for clarity.

## Lane behavior on missing capabilities

Lanes declare capability intent on a per-lowering basis:

- **required**: lowering fails with `ERR_CAPABILITY_MISSING` and a precise hint
  - Example: a lowering that aggregates related rows into JSON requires `jsonAgg`. The ORM client's includes choose between the one-query include and one query per relation from capabilities instead ([ADR 164](ADR%20164%20-%20Repository%20Layer.md))
- **optional**: adapter attempts a deterministic fallback strategy, else fails with a clear message
  - Example: if `jsonAgg` absent, flatten projection and document shape change
- **discouraged**: allowed but gated by lint or budget policy

Lanes do not implement dialect fallbacks themselves. They call adapter lowerers with a declarative intent, adapter decides the SQL or fails.

## Error semantics

Stable error codes per ADR 027:
- `ERR_CAPABILITY_MISSING` when a required cap is absent
- `ERR_CAPABILITY_UNCERTAIN` when discovery is inconclusive
- `ERR_CAPABILITY_DISABLED_BY_POLICY` when `forceDisable` blocks it
- Errors carry `{ capability, lane, reason, suggestions }`

### Discovery cadence and caching

- Discovery runs during verification and runner apply to confirm contract satisfaction
- Revalidation occurs when verification is re-run; runtime does not renegotiate a new profile in pinned mode
- Lanes receive a read-only view of declared capabilities from the contract

### Feature flags use cases

- Pin off `jsonAgg` in environments where it regresses perf to force flattened lowerings
- Disable `transactionalDdl` when running against engines without full support
- Prefer `cte` over subqueries for readability in training or testing contexts

## Deterministic lowering requirement

Adapters must produce the same SQL for the same Plan + effective capabilities set:
- Golden SQL tests validate each lowering combination
- If no valid lowering exists, adapters must fail rather than silently change semantics

## Consequences

### Positive

- Deterministic, testable behavior across dialects and versions
- Clear separation of concerns: lanes are portable, adapters own dialect logic
- Stable caches keyed by profileHash and predictable invalidation (when the contract changes)
- Safer rollouts by feature-flagging risky capabilities

### Negative

- Slight startup cost for discovery probes
- Adapter authors must maintain capability matrices and conformance tests
- Some desirable fallbacks are not possible under the one-statement rule

## Alternatives considered

- **Centralize all capability handling in lanes**: Rejected to keep lanes portable and avoid dialect leakage
- **Omit discovery entirely**: Rejected because extensions and server versions materially affect available features; we still probe to verify satisfaction, but we do not compute a new profile hash at runtime in pinned mode
- **Auto multi-statement fallback when caps are missing**: Rejected for the lanes due to ADR 015 one-call → one-statement rule and policy guardrails. The ORM client, above the lanes, does choose a multi-statement strategy from capabilities ([ADR 164](ADR%20164%20-%20Repository%20Layer.md))

## Implementation notes

- Add `adapter.discover()` and `adapter.lower(plan, caps, hints)` to the SPI
- Provide a shared `CapabilityRegistry` with docs and conformance hooks
- Expose `profileHash` and declared capabilities in runtime diagnostics and telemetry

## Future extension

- A "floating mode" could compute a runtime profile from discovered capabilities, use it for cache scoping, and require only that the runtime profile satisfies the contract. This would be additive and opt-in; the default remains pinned and contract-derived.
- Include capability context in lint rule messages for actionable guidance

## Testing and conformance

- Conformance Kit defines fixtures for capability permutations and expected SQL or errors
- Adapters must pass golden tests for all declared caps and fallbacks
- Fuzz tests check that `profileHash` changes when caps or version flip

## Migration

- Existing Postgres adapter seeds static caps and a minimal discovery probe for `serverVersion` and common extensions
- Lanes begin passing capability intents to lowerers
- Gradually gate advanced features behind required caps with clear errors

## References

- ADR 016 — Adapter SPI for lowering relational AST
- ADR 025 — Plan caching & memoization in runtime
- ADR 027 — Error envelope & stable codes
- ADR 015 — ORM as an optional extension over the DSL
