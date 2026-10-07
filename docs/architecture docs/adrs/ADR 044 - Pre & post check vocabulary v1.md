# ADR 044 — Pre/post check vocabulary v1

> **Superseded.** The v1 check vocabulary described here is not used by any target. MongoDB uses `{ source, filter, expect, description }` with reused filter expressions (see [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). SQL uses SQL statements directly. Check semantics are now defined per-family in their respective operation model ADRs (ADR 188 for Mongo, ADR 028 for SQL). This ADR is retained for historical context.

## Context

Migration edges in Prisma Next carry pre and post checks to prove applicability and success. Other ADRs define how we execute and recover (transactions, idempotency, sandboxing), but we lack a shared, versioned vocabulary for checks. Without a canonical set of check IDs, parameter schemas, and evaluation rules, op authors cannot interoperate and PPg or the local runner cannot provide consistent diagnostics

## Decision

Introduce a versioned, minimal check vocabulary with stable identifiers, JSON parameter schemas, evaluation semantics, namespacing for extensions, and capability negotiation. Runners must validate check shapes at load time and apply deterministic evaluation order

## Goals

- Standardize a core set of relational checks that cover most pre and post conditions
- Enable early rejection when a bundle uses unknown checks
- Define outcomes that integrate with ADR 038 idempotency and ADR 037 compensation
- Keep v1 small and extensible via namespacing

## Non-Goals

- SQL parsing of arbitrary assertions
- Data content validation beyond simple aggregates in shadow mode
- Targeting non-relational backends in v1

## Canonical check IDs (relational v1)

Each check has an ID and parameters. IDs are case sensitive. All parameters are part of the check identity and must be canonicalized by producers

- **tableExists(table)**
  Ensures a table is present
- **columnExists(table, column)**
  Ensures a column is present
- **columnTypeIs(table, column, type, nullable?)**
  Ensures a column's normalized type and nullability match the contract
- **defaultIs(table, column, normalizedExpr)**
  Ensures a column default matches a normalized expression. Not built: it would need the text the database stores for the default, predicted at plan time, which is fragile. See "setDefault carries no postcheck" under Idempotency mapping
- **indexCovers(table, columns[], unique?)**
  Ensures an index exists that covers the columns in order with optional uniqueness
- **constraintExists(table, name?, kind?)**
  Ensures a named constraint exists, or any constraint of kind if name omitted
  kind ∈ { primaryKey, unique, foreignKey, check }
- **foreignKeyMatches(table, columns[], refTable, refColumns[], onDelete?, onUpdate?)**
  Ensures an FK exists with the specified shape and actions
- **rowCount(table, where?) shadow only**
  Ensures the table has a count meeting a simple predicate such as >= 0 or = 0
  Intended for data backfill sanity checks, not content verification

## Parameter normalization

- **table**, **column**, **refTable** are contract names after adapter normalization
- **type** is the adapter's normalized type identifier
- **normalizedExpr** is adapter-normalized default expression
- **columns[]** and **refColumns[]** are ordered lists
- **where?** supports a small, JSONable predicate subset in v1
  `{ op: "eq" | "gte" | "lte", value: number }` applied to COUNT(*)

## Check JSON shape

```json
{
  "id": "columnTypeIs",
  "params": {
    "table": "user",
    "column": "email",
    "type": "text",
    "nullable": false
  },
  "mode": "pre"
}
```

### Fields

- **id** is the check ID
- **params** must conform to the schema for id
- **mode** is pre or post at authoring time for readability, but runners evaluate checks based on the op stage they are attached to

## Evaluation semantics

### Pre checks

- All pre checks must pass to proceed
- Some pre checks can establish already applied state for idempotency, enabling the runner to treat the op as a no-op per ADR 038
- If a required pre check fails, the op is conflict and must not apply

### Post checks

- All post checks must pass to consider the op successful
- If any post check fails after application, the op is failed and triggers compensation or rollback per ADR 037

### Order

- Checks are evaluated in a deterministic order derived from their ID and parameter canonical form
- Runners may short-circuit on first failure to minimize DB round trips

## Idempotency mapping (ties to ADR 038)

Pre checks below can imply already applied when true

- **tableExists** for createTable ops
- **columnExists** and **columnTypeIs** for addColumn with matching type
- **indexCovers** for addIndex with matching columns and uniqueness
- **constraintExists** and **foreignKeyMatches** for addConstraint and addForeignKey ops

When a pre check establishes already applied, runners record a no-op outcome rather than error

### setDefault carries no postcheck

The runner skips an op whose post checks already pass before it runs. A post check that the column has a default also passes for the old default, so it would skip a changed default. setDefault ops therefore carry no post check. The run's final schema verification compares the default's value instead, and running `SET DEFAULT` again is harmless

## Namespacing and extensions

- Core IDs are unprefixed and versioned by this ADR
- Vendor or adapter-specific checks must be namespaced
  - `pg.constraintDefMatches`
  - `mysql.storageEngineIs`
  - `mongo.collectionOptionsMatch`
- Unrecognized checks cause a capability error at load time unless marked `optional: true`
- Extension checks must provide a JSON schema in the bundle for validation

### Extended check example

```json
{
  "id": "pg.constraintDefMatches",
  "params": { "table": "user", "name": "user_email_key", "definition": "UNIQUE (email)" },
  "optional": true
}
```

## Capability negotiation

- Bundles declare the set of required check IDs
- Runners and PPg advertise supported check sets via adapter capability discovery
- If a required check is unsupported, the bundle is rejected with a stable error code
- Optional checks are skipped with a warning when unsupported

## Privacy and mode constraints

- **rowCount** and any data-touching checks are only valid in shadow mode
- Checks must never include raw data values beyond normalized metadata
- Results carry redacted diagnostics per ADR 024

## Diagnostics and error mapping

On failure, runners emit a stable error envelope per ADR 027 with

- **code**: CHECK_PRE_FAILED, CHECK_POST_FAILED, CHECK_UNSUPPORTED, CHECK_SCHEMA_INVALID
- **check**: { id, params }
- **stage**: pre or post
- **details**: adapter-normalized message

## Producer obligations

- Use the smallest sufficient set of checks
- Canonicalize parameter values to avoid false mismatches
- Prefer core checks over vendor ones where possible
- Provide extension schemas when using namespaced checks

## Runner obligations

- Validate check shapes against known schemas at load time
- Evaluate deterministically and short-circuit on failure
- Map idempotent pre-check success to already applied per ADR 038
- Enforce shadow-only constraints for data-touching checks
- Emit stable diagnostics and honor sandbox limits per ADR 040

## Examples

### Add column op

**Pre**

```json
{ "id": "tableExists", "params": { "table": "user" } }
```

**Post**

```json
{ "id": "columnTypeIs", "params": { "table": "user", "column": "active", "type": "bool", "nullable": false } }
```

### Add index op

**Pre**

```json
{ "id": "indexCovers", "params": { "table": "user", "columns": ["email"], "unique": true } }
```

**Post**

```json
{ "id": "constraintExists", "params": { "table": "user", "kind": "unique" } }
```

## Versioning

- This ADR defines v1 of the core vocabulary
- Additions are allowed in minor releases with clear adapter support flags
- Breaking changes require a new vocabulary version and negotiation in bundles

## Alternatives considered

- **Free-form SQL assertions**
  Rejected for portability and parsing complexity
- **Only post checks**
  Rejected because we need pre conditions for safe idempotency and early conflicts
- **Vendor-only checks**
  Rejected for portability and parity across runners and PPg

## Consequences

### Positive

- Consistent behavior across local runner and PPg
- Deterministic evaluation with clear diagnostics
- Safe idempotency and minimal false conflicts

### Negative

- Additional schema validation burden for op authors
- New capability surface to maintain across adapters

### Mitigations

- Keep v1 minimal and well documented
- Provide JSON Schema definitions and TypeScript types for checks
- Offer adapter utilities to generate normalized parameters from the contract

## Open questions

- Should we allow a limited check.sql for EXPLAIN-only assertions under strict normalization
- Do we need a tableHasColumnSubset aggregate check for wider index coverage heuristics in v1 or defer to index advisor
