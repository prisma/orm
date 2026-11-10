# ADR 023 — Budget evaluation & EXPLAIN policy

> **Update — the hooks are removed.** The middleware hooks `beforeExecute` and `afterExecute` this ADR describes no longer exist. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced them with lifecycle events and interceptors on a tree of activities.

## Context

Prisma Next provides guardrails via budgets to prevent accidental expensive queries. We need a clear policy for when to run EXPLAIN, how to cache results, and how to fall back safely when EXPLAIN is unavailable or too costly. Budgets must be predictable, low overhead by default, and configurable per environment.

## Decision

Define three budgets with stable semantics:
- **row-count** (expected rows)
- **latency** (wall clock)
- **sql-size** (text length in bytes)
- Evaluate budgets in a fixed order with phase awareness: cheap static checks before execute, dynamic checks after execute
- EXPLAIN is adapter-mediated, opt-in in production, on by default in CI and preflight
- Cache EXPLAIN outcomes by sqlFingerprint with invalidation on contract or adapter profile changes
- Provide safe fallbacks when EXPLAIN is unavailable, disabled, or too slow

## Budget definitions
- **row-count budget**: expected upper bound on rows read or returned for reads, and rows affected for writes; evaluated via EXPLAIN if enabled, else via heuristics and post factum rowCount when available
- **latency budget**: maximum acceptable end-to-end execution latency measured by the runtime clock; enforced after execute
- **sql-size budget**: maximum bytes of SQL text to catch runaway query construction; enforced before execute

## Evaluation order and phases

### Before execute
- **sql-size**: deterministic O(1), always evaluated first
- **row-count precheck**: if EXPLAIN is enabled and cheap, run once and cache; else apply heuristics; never block solely on heuristics unless configured strict

### After execute
- **latency**: measured per Plan execution
- **row-count postcheck**: if driver provides rowCount for reads or writes, evaluate against budget; when EXPLAIN estimate is available, report both estimated and observed

### Rationale
- Cheap checks first to avoid unnecessary work
- Estimates before, measurements after, with consistent error semantics

## EXPLAIN policy

### When to run
- Always in CI preflight and PPg preflight unless disabled in config
- In development, run on first sight of a sqlFingerprint and then sample every N executions
- In production, off by default, opt-in per rule or per Plan annotations

### What to run
- EXPLAIN for SELECT and DML where the adapter can produce a non-mutating plan
- EXPLAIN ANALYZE is disabled by default to avoid executing the query
- Lanes may add hints such as projected cardinality or index expectations to improve diagnostics

### Mutations
- Do not run EXPLAIN on mutations unless the adapter guarantees non-execution explain and the user opts in
- When disabled, rely on mutation-requires-where, index presence checks, and observed rowCount after execute

### Timeouts and cost caps
- Each EXPLAIN call has a strict timeout budget (default 50 ms)
- If the adapter cannot return within the budget, treat as explain-unavailable and fall back

## Caching

### Key
- sqlFingerprint computed from normalized SQL with placeholders and stable whitespace rules
- plus contract.coreHash and adapter.profileHash to guard against schema and capability changes

### Value
- estimated rows, used indexes, access paths as adapter-normalized payload
- timestamp, adapter version, and an ok flag

### Invalidation
- on contract hash change
- on adapter profile hash change
- on TTL expiry (configurable, default 10 minutes dev, 24 hours CI)

### Param sensitivity
- We do not include params in the cache key by default
- Adapters may declare paramSensitive: true for patterns like LIMIT $1 to disable cache use or force multi-bucket caching by param shape

### Sampling
- Dev default: run EXPLAIN on first sight and then every 20th hit per sqlFingerprint
- CI default: always
- Prod default: never unless enabled

## Safe fallbacks

When EXPLAIN is unavailable, disabled, or times out:
- **Reads**: require LIMIT unless query is provably bounded by key equality or unique index predicates; if no bound, emit row-count-budget warning or error per configuration
- **Writes**: require WHERE and check index coverage of equality predicates; observed rowCount post-execute enforces the budget
- **Heuristics**: presence of LIMIT, equality on unique keys, and small IN lists are treated as bounding signals; the lints plugin provides hints to add indexes or limits

## Configuration

### Runtime plugin configuration
```typescript
budgets({
  maxRows: 10_000,           // optional
  maxLatencyMs: 200,         // optional
  maxSqlBytes: 200_000,      // optional
  explain: {
    enabled: { dev: true, ci: true, prod: false },
    timeoutMs: 50,
    sampleRate: 0.05,        // 5% after first hit in dev
    forMutations: false
  },
  onViolation: {
    rowCount: 'error',       // warn | error
    latency: 'warn',
    sqlSize: 'warn'
  }
})
```

### Adapter options
- Adapters expose supportsExplain, supportsExplainForWrites, and explain(options) with timeout
- Adapters normalize explain output to { estimatedRows?: number, usedIndexes?: string[], details?: unknown }

### Lane annotations
- Plans may include annotations.intent = 'introspect' | 'bulk' | 'bounded' to guide heuristics
- Plans may attach an expected row bound for rare queries annotations.maxExpectedRows

## Precedence and outcomes

### Budget precedence
1. sql-size blocks before execute if over limit
2. row-count blocks before execute if EXPLAIN estimate exceeds budget; if only heuristics are available and mode is strict, block, else warn
3. latency blocks after execute if over limit

### Multiple violations
- All detected violations are reported
- The most severe level determines execution outcome in beforeExecute
- Post-execute violations are surfaced even if execution succeeded

### Error codes
- budget/sql-size-exceeded
- budget/row-count-exceeded with source: 'explain' | 'heuristic' | 'observed'
- budget/latency-exceeded
- budget/explain-unavailable for diagnostics when falling back

## Reporting & telemetry (plugins)
- **Runtime outcome**: blocking violations raise structured errors (e.g., `budget/row-count-exceeded`, `budget/sql-size-exceeded`) in `beforeExecute`. Non-blocking violations are surfaced as warnings to plugins and may be logged.
- **Lints & budgets**: violations are produced by the lints/budgets plugins in `beforeExecute` (prechecks) and `afterExecute` (postchecks). The runtime maps violation level to allow/warn/block using standard policy.
- **Telemetry (optional)**: telemetry plugins may emit events per ADR 024 (e.g., `sqlFingerprint`, `estimatedRows`, `observedRows`, `latencyMs`, and budget outcomes). Emission, sampling, and sinks are plugin-owned and strictly opt-in.

### Emission mechanics (brief)
- **No core logging**: the runtime core never writes to stdout/stderr or remote sinks.
- **Shared hub**: a telemetry plugin exposes a shared `ctx.telemetry?.emit(event)` to other plugins; if no telemetry plugin is registered, nothing is emitted.
- **Sinks** (configured by the telemetry plugin):
  - `console()` → NDJSON to stdout (dev)
  - `file({ path })` → append-only NDJSON (CI/local)
  - `http({ url, headers })` → POST NDJSON lines (self-hosted)
  - `otlp({ endpoint, headers })` → OpenTelemetry exporter (prod)
  - `custom({ write(event) })` → integrate with app loggers (e.g., pino/winston)
- **Defaults by environment** (recommendation):
  - Dev: `console()`; EXPLAIN sampled; warn on non-blocking
  - CI/Preflight: `file(.ndjson)` artifacts; EXPLAIN on; strict policy
  - Prod: `otlp()` with low sampling; EXPLAIN off by default; block on configured errors
- **Volume & privacy**: per-row emission is discouraged by default; aggregate events only. Redaction happens in the telemetry plugin before any sink.

## Testing
- Fixture queries with known cardinalities validate EXPLAIN normalization across adapters
- Cache correctness tests for invalidation on contract and adapter profile changes
- Heuristic tests for bounded reads and index coverage detection
- End-to-end tests asserting precedence and error mapping in both strict and permissive modes

## Performance
- Target median overhead of budget checks under 1 ms with caching and no EXPLAIN
- EXPLAIN calls are capped by timeout and sampling to avoid tail latency impact
- Cache is O(1) lookups keyed by sqlFingerprint with size limits and LRU eviction

## Open questions
- Whether to add a budget for result payload size to catch large JSON aggregations
- Adapter-specific cost models to map EXPLAIN cost units into a portable severity score
- Auto-tuning budgets per Plan by learning typical latency and row counts over time
