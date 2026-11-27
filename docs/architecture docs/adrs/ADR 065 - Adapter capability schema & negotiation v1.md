# ADR 065 — Adapter capability schema & discovery

## Decision

Define a versioned capability schema and a discovery flow where:
- The target, the driver and the adapter each declare the capabilities they know, in one schema; on PostgreSQL a contract lists the capabilities its author's stated database version and connection provide, and the other targets' contracts take a fixed list from their adapter ([ADR 335](ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md))
- Compile profiles (target-specific lowerers, e.g. `sql/pg`) consume capabilities to choose deterministic lowering strategies
- Lanes and plugins branch on capabilities, never on target strings
- The runtime goes by the contract's capabilities; they change only when the contract is emitted again

**Adapters do not lower Plans to SQL. Lowering is the responsibility of compile profiles.**

## Why

- Keep dialect logic deterministic and testable with golden SQL in compile profiles
- Allow one runtime to execute across heterogeneous deployments by branching on declared capabilities rather than hardcoding "postgres" or "mysql"
- Make fallbacks explicit when a feature is unavailable and avoid silent differences across environments
- Enable reproducible builds by fixing the capability set in the emitted contract; ADR 004 says which hash covers it

## Capability schema

Capabilities are a JSON-serializable object with stable key ordering:

```json
{
  "schemaVersion": "1",
  "target": { "family": "sql", "profile": "pg", "version": "15" },
  "sql": {
    "placeholderStyle": "$n",
    "cte": true,
    "lateral": true,
    "window": true,
    "jsonAgg": true,
    "returning": "all"  // "none" | "insert-only" | "all"
  },
  "ddl": {
    "transactional": true,
    "concurrentIndex": true,
    "partitioning": "native", // "none" | "emulated" | "native"
    "renameColumn": true
  },
  "types": {
    "uuid": "native", // "emulated" | "native"
    "jsonb": true,
    "timestamptz": { "timezone": "UTC-preserving" }
  },
  "limits": {
    "maxParams": 32767,
    "identifierMaxLen": 63,
    "identifierCase": "preserve"
  },
  "explain": {
    "format": "text", // "text" | "json"
    "costs": true,
    "buffers": true
  },
  "tx": {
    "savepoints": true,
    "advisoryLocks": "session" // "none" | "transaction" | "session"
  },
  "vendor": {
    "pg": { "extensions": { "postgis": false, "vector": false } }
  }
}
```

### Rules

- Reserved top-level segments: `target`, `sql`, `ddl`, `types`, `limits`, `explain`, `tx`, `vendor`, `schemaVersion`
- `vendor.*` is freeform for adapter-specific data
- Values are booleans, enums, strings, numbers, or small structured objects
- No functions or code references

### profileHash

- `profileHash = sha256(canonicalize(capabilities) + compileProfileId)`
- Used for reproducibility, caching, and change detection per ADR 004
- Changes whenever capabilities or the compile profile implementation changes in a way that affects lowering

## How capabilities are checked

1. **Authoring** (PostgreSQL)
   - The contract's author states the database version; the facade writes that version's capabilities, plus the connection's, into the contract

2. **Signing** (PostgreSQL)
   - Verification reads the server's version and refuses a database that does not provide what the contract requires of it

3. **Client creation**
   - The capabilities the contract requires of the connection are compared with what the adapter and driver declare, at compile time and when the client is created

4. **Execute**
   - Compile profiles lower by the contract's capabilities; if a required feature is missing, they fail with a stable error
   - The adapter executes `{ sql, params }` and maps errors to runtime codes

## Lane and plugin usage

- Lanes must not branch on target strings
- They read the contract's capabilities and guard behavior with explicit keys
- Plugins can attach rule context using capability checks, e.g. `if (!capabilities.sql.jsonAgg) rule('no-nested-array-projection').warn(...)`

## Failure modes and defaults

- **Unknown schema version**: Warn and treat unknown keys as opaque, but do not assume capabilities exist
- **Missing critical key**: Assume the most conservative default, e.g. `ddl.transactional: false`, and allow compile profile to reject if it cannot provide a safe lowering
- **Degraded capabilities**: Compile profile may choose a fallback lowering or return a deterministic error with a suggested capability requirement. The ORM client, which may run several statements for one call, chooses how to load includes from capabilities: the one-query include where the contract's `sql` group reports `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`, otherwise one query per relation ([ADR 164](ADR%20164%20-%20Repository%20Layer.md))

## Versioning

- `schemaVersion` is semver-like but single integer for v1
- New optional keys may be added without bumping the major version
- Changing meaning of existing keys requires a major bump
- Compile profiles declare supported `schemaVersion` ranges

## Examples

### Postgres 15 example

```json
{
  "schemaVersion": "1",
  "target": { "family": "sql", "profile": "pg", "version": "15" },
  "sql": { "placeholderStyle": "$n", "cte": true, "lateral": true, "window": true, "jsonAgg": true, "returning": "all" },
  "ddl": { "transactional": true, "concurrentIndex": true, "partitioning": "native", "renameColumn": true },
  "types": { "uuid": "native", "jsonb": true, "timestamptz": { "timezone": "UTC-preserving" } },
  "limits": { "maxParams": 32767, "identifierMaxLen": 63, "identifierCase": "preserve" },
  "explain": { "format": "text", "costs": true, "buffers": true },
  "tx": { "savepoints": true, "advisoryLocks": "session" },
  "vendor": { "pg": { "extensions": { "postgis": false, "vector": false } } }
}
```

### SQLite baseline

```json
{
  "schemaVersion": "1",
  "target": { "family": "sql", "profile": "sqlite", "version": "3.45" },
  "sql": { "placeholderStyle": "?", "cte": true, "lateral": false, "window": true, "jsonAgg": false, "returning": "none" },
  "ddl": { "transactional": true, "concurrentIndex": false, "partitioning": "none", "renameColumn": false },
  "types": { "uuid": "emulated", "jsonb": false, "timestamptz": { "timezone": "local-converted" } },
  "limits": { "maxParams": 999, "identifierMaxLen": 63, "identifierCase": "preserve" },
  "explain": { "format": "text", "costs": true, "buffers": false },
  "tx": { "savepoints": true, "advisoryLocks": "none" }
}
```

## Adapter responsibilities

- Declare accurately what the adapter can write as a query
- Read the server's version during introspection, as a number, for the target's check
- Map database errors to stable runtime error codes per ADR 027
- Do not embed lowering logic or transform ASTs

## Compile profile responsibilities

- Deterministically lower `(AST, capabilities)` to `{ sql, params }`
- Prefer conservative fallbacks when possible
- Emit stable diagnostics when a Plan cannot be lowered under the active capabilities
- Ship reference capability profiles for offline compilation and testing
- Participate in `profileHash` creation per ADR 004

## Security and privacy

- Capability maps must not leak sensitive configuration like passwords or hostnames
- Vendor sections should avoid revealing internal infrastructure details and stick to feature availability or extension flags

## Open questions

- Should we allow a small set of runtime probes behind a feature flag to verify high-risk claims like `ddl.transactional`?
- Do we need a standardized way to express performance characteristics in capabilities, e.g. `limits.maxExplainCost`, or should that remain policy in budgets?

## Consequences

### Positive
- Deterministic compilation tied to explicit features
- Better portability and fewer target-string branches in code
- Clear error paths when a feature is unavailable

### Negative
- More upfront work to define and maintain the capability map
- Targets must keep the table of capabilities by version accurate

## Alternatives considered

- **Hardcode target strings and scatter conditionals**: Rejected as brittle and untestable across environments
- **Let adapters perform lowering**: Rejected because it breaks determinism, complicates testing, and conflates execution with compilation
