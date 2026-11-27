# ADR 031 — Adapter capability discovery

## Context

Prisma Next supports multiple SQL dialects via adapters. Lanes (DSL, ORM, TypedSQL, Raw) lower abstract Plans to dialect SQL. Some SQL features are optional or versioned (e.g., LATERAL, json_agg, transactional DDL, concurrent index creation). We need a consistent way for adapters to surface capabilities and for lanes to react when features are missing or discouraged.

## Problem

- Lanes must not emit SQL that the target cannot execute
- Capability presence can follow from the dialect's design or from the server's version, extensions and configuration
- We need deterministic lowering and stable failure modes across environments
- Plans and caches must vary when capabilities change to avoid stale or unsafe SQL

## Goals

- Define a capability model covering what the dialect has by design and what depends on the server's version
- Provide a verification flow that checks database capabilities satisfy the contract-declared requirements
- Let lanes declare required vs optional capabilities and degrade or fail deterministically (based on contract-declared caps)
- Let a contract's author turn capabilities on or off for safety or perf reasons
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

Each capability is declared by the component that knows the fact ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)):

- **The target** declares what each database version provides, in a table by version
  - Example: PostgreSQL has lateral joins in every supported version; a capability that arrives with a later version is in that version's row and the rows after it
- **The driver** declares what the connection provides
  - Example: interactive transactions

On PostgreSQL the contract's author writes the list of capabilities the contract requires, from the list the target exports for each database version and the list the driver exports for its connection. The other targets' contracts take a fixed list from their adapter until each gets its own table.

### Verification (pinned profile)

On PostgreSQL, during verification (`prisma db verify`, `prisma db sign`, and before the runner applies):
1. The adapter reads the server's version during introspection
2. The target compares the capabilities the contract requires of the database with what that version provides
3. On success, `db sign` and the runner write the contract's `storageHash` and `profileHash` to the marker, and `db verify` writes nothing; on failure nothing is signed or applied, and the error states the versions involved

When a client is created, the capabilities the contract requires of the connection are compared with what the adapter and driver declare. The runtime does not probe the database.

### Leaving a capability out

The author's list is everything the contract requires, with no default. A capability is removed by leaving it out:

```typescript
defineContract({
  requiredCapabilities: [...postgres17.filter((key) => key !== 'sql.jsonAgg'), ...postgresDriver],
  // models…
})
```

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
- `ERR_CAPABILITY_UNCERTAIN` when the server's version cannot be read
- Errors carry `{ capability, lane, reason, suggestions }`

### Discovery cadence and caching

- The database is checked during verification and before the runner applies
- The check is repeated when verification is re-run; the runtime does not check the database in pinned mode
- Lanes receive a read-only view of declared capabilities from the contract

### Uses of the list

- Leave out `jsonAgg` where it regresses performance, so the ORM client loads relations with one query per relation
- Leave out a capability the connection does not provide, such as interactive transactions behind a pooler in transaction mode

## Deterministic lowering requirement

Adapters must produce the same SQL for the same Plan + effective capabilities set:
- Golden SQL tests validate each lowering combination
- If no valid lowering exists, adapters must fail rather than silently change semantics

## Consequences

### Positive

- Deterministic, testable behavior across dialects and versions
- Clear separation of concerns: lanes are portable, adapters own dialect logic
- Stable caches keyed by profileHash and predictable invalidation (when the contract changes)
- Safer rollouts by turning a risky capability off in the contract

### Negative

- Target authors must maintain the table of capabilities by version, and it cannot change for a supported version within a major version
- Some desirable fallbacks are not possible under the one-statement rule

## Alternatives considered

- **Centralize all capability handling in lanes**: Rejected to keep lanes portable and avoid dialect leakage
- **Omit discovery entirely**: Rejected because extensions and server versions materially affect available features; verification still reads the server's version to check the contract is satisfied, but we do not compute a new profile hash at runtime in pinned mode
- **Auto multi-statement fallback when caps are missing**: Rejected for the lanes due to ADR 015 one-call → one-statement rule and policy guardrails. The ORM client, above the lanes, does choose a multi-statement strategy from capabilities ([ADR 164](ADR%20164%20-%20Repository%20Layer.md))

## Implementation notes

- A SQL target answers what a database lacks of a contract's requirements through `databaseCapabilitiesNotProvided`
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

- The PostgreSQL target holds the table of capabilities by version, and its adapter reads the server's version number during introspection
- Lanes begin passing capability intents to lowerers
- Gradually gate advanced features behind required caps with clear errors

## References

- ADR 016 — Adapter SPI for lowering relational AST
- ADR 025 — Plan caching & memoization in runtime
- ADR 027 — Error envelope & stable codes
- ADR 015 — ORM as an optional extension over the DSL
