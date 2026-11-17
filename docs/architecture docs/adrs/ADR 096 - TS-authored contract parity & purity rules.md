# ADR 096 — TS-authored contract parity & purity rules

**Amended by [ADR 274](ADR%20274%20-%20A%20client%20takes%20a%20typed%20contract%20value%2C%20so%20every%20other%20option%20is%20inferred.md):** the rule that the runtime accepts `{ contract }` or `{ contractJson }` is superseded. A client takes only `{ contract }`; emitted JSON becomes that value through `contractFromJson<Contract>(json)`.

## Context

We support two authoring modes for the data contract

- **PSL-first**: author schema.psl, emit canonical contract.json and .d.ts types
- **TS-first**: author a TypeScript contract object via defineContract, use it directly in app code, and optionally emit canonical contract.json for tools

To make TS-first safe and interoperable with all tooling, TS-authored contracts must be as deterministic, auditable, and machine-readable as PSL-first. This ADR defines the parity and purity rules that TS contracts must follow.

## Problem statement

Without guardrails, TS contracts could introduce nondeterminism or side effects

- Hash instability if contract shape depends on environment or ordering
- Tooling drift if CI and developers evaluate different code paths
- Security risk if tools import application code to read the contract

We need clear rules so TS-first yields the same canonical JSON and coreHash as PSL-first, with no code execution required by tools.

## Goals

- TS-authored contracts are pure data and deterministically canonicalize to the same coreHash as PSL for equivalent schemas
- Runtime can accept either a TS object or canonical JSON, with identical verification behavior
- Tools and CI operate on canonical JSON only
- Great DX: no explicit emit required in day-to-day dev, instant types from the TS object

## Non-goals

- Replacing PSL as an authoring mode
- Executing arbitrary application code in tooling or hosted services
- Encoding target-specific execution logic inside contracts

## Decision

### Contract object purity

- TS contracts must be composed of plain JSON-serializable values
- No functions, getters, class instances, Symbols, BigInt, Dates, or RegExp in the contract object graph
- No environment-dependent values such as process.env, Date.now(), random IDs, or filesystem reads
- Contract objects are treated as immutable after construction

### Deterministic canonicalization

- `canonicalize(contract)` produces a canonical JSON string and coreHash (SHA-256)
- Canonicalization follows ADR 010 rules and carries a canonicalVersion
- TS-first and PSL-first must canonicalize to identical JSON and coreHash for equivalent schemas
- A recanonicalize tool upgrades stored blobs when canonicalVersion changes without altering coreHash

### Authoring API constraints

- `defineContract` and target helpers (e.g., `pg.table`, `pg.int4`) return branded POJOs that encode type metadata as data
- Helpers may not capture closures or store behavior inside the contract
- Builders enforce structure at compile time and validate at runtime with a strict schema

### Runtime acceptance

- Runtime accepts `{ contract }` (TS object) or `{ contractJson }`
- When given a TS object, runtime canonicalizes at startup, validates, and computes coreHash
- Marker verification and guardrails operate identically regardless of input form

### Tooling consumption

- Planner, preflight, ledger tools, PPg services, and Studio consume canonical JSON only
- In TS-first projects, CI may run an isolated emit step that imports the contract module and calls `canonicalize(contract)`
- Hosted services do not evaluate TS by default

### Linting and policy

- Provide an ESLint plugin to enforce purity and immutability rules
- Optional precommit check verifies that canonicalization is stable and matches committed blobs
- CI fails if PSL-first and TS-first artifacts disagree on coreHash in dual authoring mode

### Security posture

- CI emission runs in a sandboxed environment with a restricted import graph, locked Node version, and no network by default
- Canonical JSON blobs stored in repo or DB carry canonicalVersion and integrity metadata

## Alternatives considered

- **Allow functions inside contracts with custom serialization**
  Rejected due to unpredictability and tool complexity
- **Make tools import TS contract directly**
  Rejected for security and determinism reasons
- **Keep TS-first behind an explicit always-on emit step**
  Rejected to preserve the no-emit DX advantage

## Consequences

### Positive

- Consistent safety and determinism across PSL-first and TS-first
- No explicit generate in dev while retaining artifact-driven tooling
- Easier contribution and review with both code diffs and canonical JSON diffs

### Negative

- Authoring API is stricter than a free-form builder
- Some patterns are disallowed to preserve determinism
- Requires minimal CI plumbing to materialize JSON when missing

## Implementation notes

- Add @prisma/contract-core with defineContract, target helpers, validateContract, and canonicalize
- Update runtime to accept TS object or JSON with the same verification path
- Ship ESLint rules for purity and immutability
- Provide a tiny CLI prisma-next contract emit and dev plugin integration for auto-emit on watch
- Extend ADR 010 and ADR 021 to carry canonicalVersion and optional DB-side contract JSON

## Testing and conformance

- Golden canonicalization tests comparing PSL-first and TS-first outputs for the same schema
- Fuzz tests for key ordering, array normalization, and scalar encodings
- Negative tests for non-serializable values and side effects
- Conformance Kit updates to accept TS-first fixtures and verify coreHash parity

## Migration strategy

- Teams may adopt TS-first incrementally
- Dual authoring is allowed temporarily under ADR 035 with CI enforcing a single canonical artifact
- Provide a one-shot tool to emit canonical JSON from TS and to regenerate PSL from a canonical JSON if desired

## Open questions

- Do we allow BigInt in contracts for engines that support it, and if so how do we canonicalize
- Should we provide a pretty-printer from canonical JSON back to PSL for review workflows
- Minimum Node and TypeScript versions for TS-first guarantee

## References

- ADR 010 — Canonicalization rules for contract.json
- ADR 017 — Extension and alternate runtime compatibility policy
- ADR 021 — Contract marker storage & verification modes
- ADR 032 — Dev auto-emit integration
- ADR 035 — Dual authoring conflict resolution
- ADR 045 — Contract snapshots attached to edges and markers
