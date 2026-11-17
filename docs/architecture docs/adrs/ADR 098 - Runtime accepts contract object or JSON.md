# ADR 098 — Runtime accepts contract object or JSON

**Status: Superseded by [ADR 274](ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md).** A client now takes the contract only as a value, `{ contract }`. Emitted JSON becomes that value through `contractFromJson<Contract>(json)`, and the `contractJson` option is removed. The content below is kept as a historical record.

## Context

We support two authoring modes for the data contract

- **PSL-first**, emitting canonical contract.json and .d.ts types
- **TS-first**, building a pure data contract object via defineContract used directly in app code

To keep developer DX high while preserving deterministic verification and tooling interoperability, the runtime must accept either a TS contract object or canonical JSON and treat them equivalently once verified

## Problem

- For TS-first apps we want no explicit emit in dev, so the runtime must accept a TS object and compute coreHash
- For tools, CI, and hosted services, canonical JSON is the security and determinism boundary
- The runtime needs a single verification flow regardless of input form

## Goals

- A single runtime API that accepts `{ contract }` or `{ contractJson }`
- Canonicalize and validate TS input so its behavior matches JSON input
- Reuse the same verification modes and marker checks defined elsewhere
- Avoid performance regressions by caching canonicalization results

## Non-goals

- Executing arbitrary application code inside hosted services
- Replacing canonical JSON as the artifact used by tools and PPg
- Encoding target-specific logic into the contract

## Decision

### Accepted input forms

- **contract**: a TS contract object created via defineContract, pure JSON-serializable data
- **contractJson**: a parsed canonical JSON object or JSON string conforming to ADR 010

Exactly one of contract or contractJson must be provided

### Canonicalization and validation

- **If contract is provided** the runtime will
  - Validate purity and shape per ADR 096
  - Canonicalize to a canonical JSON string and compute coreHash per ADR 010
  - Cache `{canonicalJson, coreHash, canonicalVersion}` for the process lifetime
- **If contractJson is provided** the runtime will
  - Validate structure against the contract schema
  - If provided as string, compute coreHash as sha256(canonicalString)
  - If provided as object, re-canonicalize to a string and compute coreHash

In both cases the runtime proceeds with the same verification and execution pipeline

### Verification modes

- **verify**: "startup" | "onFirstUse" | "always" per ADR 021
- **Startup**: verify DB marker before accepting connections
- **OnFirstUse**: verify at the first execution that touches the connection
- **Always**: verify on every execution, intended for tests and high-safety contexts

## API shape

```typescript
createRuntime({
  contract,                 // TS object, or
  // contractJson,          // canonical JSON object or string
  adapter,                  // dialect adapter
  verify: "onFirstUse",
  plugins: [/* optional */]
})
```

- Hosted services may restrict to contractJson only for security
- Adapters may expose capability negotiation that depends on the contract target

## Caching and performance

- Canonicalization results are memoized in-process keyed by the object identity or by a JSON fingerprint
- Plan cache keys remain (sqlFingerprint, profileHash, coreHash) per ADR 025
- Changing the contract requires a new runtime instance
- Upgrading canonicalVersion without schema change should not invalidate plan caches

## Error semantics

- Purity or schema validation failure on contract input → ERR_CONTRACT_INVALID
- Unsupported or mismatched canonicalVersion → ERR_CONTRACT_CANONICAL_VERSION
- Marker mismatch according to verification mode → ERR_CONTRACT_MARKER_MISMATCH
- Target profile mismatch (adapter vs contract target) → ERR_ADAPTER_PROFILE_MISMATCH
- JSON canonicalization failure or hash mismatch → ERR_CONTRACT_CANONICALIZE

All errors use the envelope defined in ADR 027 with stable codes

## Security posture

- Hosted runtimes and PPg services process contractJson only unless explicitly allowed by policy
- TS contract evaluation for canonicalization happens only in application processes and developer CI sandboxes
- Param redaction and telemetry follow ADR 024 regardless of input form

## Compatibility

- Existing JSON-first flows are unchanged
- TS-first apps can adopt the runtime without an emit step
- Tools remain artifact-driven per ADR 047

## Rationale

- Unifies DX and safety by letting app code skip emit while preserving deterministic verification
- Keeps the canonical JSON as the single artifact for tools, CI, and PPg
- Localizes any TS evaluation to the application boundary where it is controlled by the developer

## Alternatives considered

- **Require explicit emit even for TS-first apps**
  Rejected to preserve no-emit DX
- **Make runtime accept TS only and derive JSON for tools on demand**
  Rejected because tools must not evaluate application code

## Consequences

### Positive

- No-emit dev loop with full verification guarantees
- Clear boundary between app processes and tools
- Consistent plan caching and verification across modes

### Negative

- Slight startup cost for canonicalizing TS contracts
- Need to document hosted restrictions around TS input

## Implementation notes

- Add overloads to createRuntime and a shared canonicalization utility
- Introduce a small in-process memo for `{canonicalJson, coreHash, canonicalVersion}`
- Reuse contract validator from @prisma/contract-core
- Ensure verification and hook pipeline see the same normalized contract metadata

## Testing

- Golden tests asserting TS and JSON inputs produce identical coreHash and execution behavior
- Fault injection for invalid contracts, marker mismatches, and adapter profile mismatches
- Benchmarks for startup canonicalization and steady-state overhead budgets

## Open questions

- Should we allow supplying both contract and contractJson to assert they match
- Do we need an opt-in fast path that trusts a supplied coreHash for JSON strings to avoid re-canonicalization

## References

- ADR 010 — Canonicalization rules for contract.json
- ADR 021 — Contract marker storage & verification modes
- ADR 025 — Plan caching & memoization in runtime
- ADR 027 — Error envelope & stable codes
- ADR 096 — TS-authored contract parity & purity rules
- ADR 097 — Tooling runs on canonical JSON only
