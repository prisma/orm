# ADR 027 — Error Envelope & Stable Codes

> **Superseded by [ADR 239 — Errors are structural envelopes with dotted namespace codes](ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md).** The envelope idea survives; its specifics do not. Codes are dotted `NAMESPACE.SUBCODE` names — no numeric `PN-DOMAIN-NNNN` range, and no separate `ErrorCategory` union (the namespace *is* the category). Errors are recognized by a structural predicate, not a shared class. See ADR 239 for the namespace list and the crosswalk from every code defined here.

## Context

Prisma Next spans lanes (DSL, ORM, raw), runtimes, adapters, migrations, and PPg preflight. Users and agents need machine-parsable, stable errors with actionable detail. Today, SQLSTATEs, driver exceptions, lint violations, and budget overages surface inconsistently. We need a single envelope and a stable code registry so policies, dashboards, and retries work uniformly.

## Decision

Define a canonical RuntimeError envelope and a stable error code registry shared across lanes, runtime, adapters, migrations, and PPg:
- Errors are returned or thrown only as RuntimeError envelopes
- Codes are short, namespaced, immutable once published
- Mapping rules translate source errors and policy outcomes into envelopes
- Redaction rules ensure messages are safe by default
- Severity and policy determine whether an error is blocking or advisory

## Error envelope

```typescript
export type ErrorSeverity = 'error' | 'warn' | 'info'
export type ErrorCategory =
  | 'PLAN'       // Plan construction, validation, hashing
  | 'RUNTIME'    // Execution pipeline and hooks
  | 'ADAPTER'    // Driver, connectivity, protocol, capability
  | 'BUDGET'     // Time/rows/size budgets and EXPLAIN policies
  | 'LINT'       // Guardrail rule violations
  | 'MIGRATION'  // Planner, runner, pre/post checks
  | 'PREFLIGHT'  // CI and PPg preflight
  | 'CONTRACT'   // Contract hash, marker, capability negotiation
  | 'CONFIG'     // Misconfiguration, unsupported options

export interface RuntimeError {
  code: string                 // Stable code, e.g. 'ADAPTER.TIMEOUT'
  category: ErrorCategory
  severity: ErrorSeverity      // 'error' blocks, 'warn' advises, 'info' annotates
  message: string              // Human oriented, redacted
  details?: Record<string, unknown> // Structured, redacted by policy
  cause?: RuntimeErrorCause    // Optional chain for provenance

  // Correlation and context
  planId?: string
  planHash?: string
  sqlFingerprint?: string
  coreHash?: string
  profileHash?: string
  lane?: string                // 'dsl' | 'orm' | 'raw' | external
  ruleId?: string              // For LINT.* codes
  budgetId?: string            // For BUDGET.* codes
  migration?: { edgeId?: string; opId?: string }
  environment?: { project?: string; env?: string; tenantId?: string }

  // Remediation hints
  hints?: string[]             // Short actionable suggestions
  docs?: string[]              // Doc anchors or ADR refs
}

export interface RuntimeErrorCause {
  code?: string                // If source was mapped from a known code
  message?: string
  origin?: 'adapter' | 'driver' | 'engine' | 'db' | 'lane' | 'system'
  sqlState?: string            // For SQL targets
  raw?: unknown                // Redacted by policy
}
```

### Envelope principles
- Stable codes and categories support long-lived policies, alerts, and dashboards
- Redacted by default for messages and details
- Deterministic context fields for correlation and policy routing
- No raw SQL or params unless explicitly enabled by secure debug policy

## Stable code registry

### Format
NAMESPACE.SUBCODE where NAMESPACE ∈ { PLAN, RUNTIME, ADAPTER, BUDGET, LINT, MIGRATION, PREFLIGHT, CONTRACT, CONFIG } and SUBCODE is UPPER_SNAKE_CASE

### Core set v1

#### PLAN
- **PLAN.INVALID**: malformed or incomplete Plan
- **PLAN.UNSUPPORTED**: lane emitted a Plan the adapter cannot lower
- **PLAN.HASH_MISMATCH**: identity conflicts within a pipeline step

#### RUNTIME
- **RUNTIME.BACKPRESSURE**: enqueue timeout or queue cap exceeded
- **RUNTIME.HOOK_FAILURE**: plugin threw or returned invalid result
- **RUNTIME.TIMEOUT**: statement timeout exceeded
- **RUNTIME.CANCELLED**: cancellation propagated

#### DRIVER
- **DRIVER.PREPARE_FAILED**: prepared statement error or reuse invalidation (see [ADR 210](ADR%20210%20-%20Prepared%20Statements%20-%20Author%20Surface%20and%20Driver%20SPI.md) for the prepared-statement contract and retry semantics)

#### ADAPTER
- **ADAPTER.CONNECTION_FAILED**: could not acquire or initialize connection
- **ADAPTER.TIMEOUT**: driver or server timeout distinct from runtime timeout
- **ADAPTER.SYNTAX_ERROR**: target rejected payload as invalid
- **ADAPTER.CAPABILITY_MISSING**: capability required not available

#### BUDGET
- **BUDGET.TIME_EXCEEDED**: elapsed time over budget
- **BUDGET.ROWS_EXCEEDED**: returned or estimated rows over budget
- **BUDGET.SIZE_EXCEEDED**: payload size over budget
- **BUDGET.EXPLAIN_RISK**: normalized EXPLAIN indicates risk per policy

#### LINT
- **LINT.NO_LIMIT**: select lacks LIMIT where required
- **LINT.NO_WHERE_MUTATION**: mutation lacks WHERE
- **LINT.SELECT_STAR**: projection uses *
- **LINT.UNINDEXED_PREDICATE**: predicate lacks supporting index

#### MIGRATION
- **MIGRATION.PRECHECK_FAILED**: preconditions not met
- **MIGRATION.POSTCHECK_FAILED**: postconditions not satisfied
- **MIGRATION.IDEMPOTENT_ALREADY_APPLIED**: safe no-op replay
- **MIGRATION.CONFLICT**: state differs in conflicting ways
- **MIGRATION.NON_TRANSACTIONAL_STEP**: requires compensation plan
- **MIGRATION.DIR_EXISTS**: migration directory already exists on disk
- **MIGRATION.FILE_MISSING**: expected migration file (migration.json or ops.json) not found
- **MIGRATION.INVALID_JSON**: migration file contains malformed JSON
- **MIGRATION.INVALID_MANIFEST**: migration manifest missing required fields or has invalid values
- **MIGRATION.INVALID_NAME**: migration name/slug empty after sanitization
- **MIGRATION.SAME_SOURCE_AND_TARGET**: migration edge has from === to (graph invariant violation)

#### PN-MIG (Migration Authoring)

The migration authoring subsystem uses a separate error construction (`CliStructuredError` with `domain: 'MIG'`) and a numeric code range `2000–2999`. The envelope format is `PN-MIG-{code}` (e.g. `PN-MIG-2001`). These codes cover authoring, planning, and emit-level errors, complementing the runner-level `MIGRATION.*` codes above.

- **PN-MIG-2001**: unfilled placeholder thrown at emit time when scaffolded `placeholder(slot)` was not replaced (see [ADR 200](ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md))
- **PN-MIG-2002**: `migration.ts` not found in the migration package directory (see [ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md))
- **PN-MIG-2003**: invalid default export — `migration.ts` does not default-export a `Migration` subclass or a factory function returning `{ plan() }` (see [ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md))
- **PN-MIG-2004**: `plan()` returned a non-array value (see [ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md))
- **PN-MIG-2010**: plan does not support TypeScript authoring surface (see [ADR 194](ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md))
- **PN-MIG-2011**: target registers a migrations capability but implements neither `resolveDescriptors` nor `emit` (see [ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md))

#### PREFLIGHT
- **PREFLIGHT.SHADOW_FAILED**: shadow DB provision or migrate failed
- **PREFLIGHT.DIAGNOSTIC_TIMEOUT**: exceeded job budget for diagnostics
- **PREFLIGHT.INSUFFICIENT_SIGNAL**: explain-only mode lacks required fields

#### CONTRACT
- **CONTRACT.MARKER_MISSING**: DB not stamped with contract marker
- **CONTRACT.MARKER_MISMATCH**: DB marker hash differs from app
- **CONTRACT.NEGOTIATION_FAILED**: profile capability negotiation failed

#### CONFIG
- **CONFIG.INVALID**: invalid project or runtime configuration
- **CONFIG.INCOMPATIBLE_VERSION**: mismatched lane/runtime/adapter versions

### Stability policy
- Codes and their semantics are immutable once released
- New codes can be added in minor releases
- Codes can be deprecated in minor, removed only in major with a crosswalk published
- Message text may change but must remain compatible and redacted

## Mapping rules

### From adapters and databases
- Driver errors map to ADAPTER.* using adapter-specific tables
- SQLSTATE classification informs subcode and severity where applicable
- Adapter attaches cause.origin = 'db' | 'driver' and cause.sqlState for SQL

### From budgets and lints
- Policy decides whether a rule is warn or error and sets severity accordingly
- Violations become LINT.* or BUDGET.* with ruleId or budgetId populated
- When severity is warn, runtime continues and attaches the envelope to diagnostics

### From migrations and preflight
- Runner emits MIGRATION.* with op context and idempotency classification
- Preflight emits PREFLIGHT.* with job identifiers and links to artifacts

### From runtime pipeline
- Queue saturation maps to RUNTIME.BACKPRESSURE
- Hook throw maps to RUNTIME.HOOK_FAILURE and includes which hook name
- Statement timer expiration maps to RUNTIME.TIMEOUT

## Severity and outcomes
- **error** indicates blocking behavior and throws or rejects
- **warn** is advisory and logged or attached to the result diagnostics
- **info** is non-blocking annotation for visibility only
- Policy can escalate warn to error per environment or downgrade in incident mode

## Redaction and privacy
- Envelope messages are safe for logs by default
- details must pass through redaction policy before emission
- Params and raw SQL are excluded unless a secure debug feature flag is on
- Sensitive identifiers may be masked according to contract sensitivity tags

## Construction API

```typescript
import { err } from '@prisma/runtime/errors'

throw err('ADAPTER.TIMEOUT', {
  category: 'ADAPTER',
  message: 'Adapter timeout after 10s',
  severity: 'error',
  details: { elapsedMs: 10023 },
  cause: { origin: 'driver', message: 'socket timeout', sqlState: '57014' },
  planId, planHash, sqlFingerprint, coreHash, profileHash
})
```

- Central factory validates codes and applies redaction
- Helpers exist for common maps, e.g. fromSqlState(state, context)
- Hooks may return RuntimeError to signal warn without throwing

## Versioning and upgrades
- The code registry is versioned with the runtime
- Adding fields to the envelope is backward compatible
- Removing fields or changing code semantics requires a major version
- A JSON Schema for the envelope is published for agents and CI

## Observability
- All envelopes are emitted to telemetry with code, category, severity, and selected context fields
- Dashboards group by code and category for SLOs and incident runbooks
- Budgets and lints expose top offenders by sqlFingerprint and ruleId

## Acceptance criteria
- All errors thrown by lanes, runtime, adapters, migrations, and preflight are wrapped in RuntimeError
- Stable mapping tables exist for each adapter and are covered by conformance tests
- Lint and budget plugins consistently use LINT.* and BUDGET.* codes with severity from policy
- PPg services accept and persist envelopes without modification and surface them in UI

## Alternatives considered
- **Propagate native errors and let callers normalize**: Fails ecosystem interoperability and breaks policy routing
- **Single numeric code space**: Harder to read and maintain, lacks namespacing for ownership

## Open questions
- Do we reserve sub-namespaces for community adapters, e.g. ADAPTER.VENDOR_*
- Should we include a retryable: boolean hint derived from code and policy
- Do we add spanId/traceId fields directly to the envelope or rely on context propagation
