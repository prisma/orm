# ADR 125 — Execution Mode Selection & Streaming Semantics

> **Update — the hook is removed.** The middleware hook `beforeExecute` this ADR describes no longer exists. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced it with lifecycle events and interceptors on a tree of activities.

## Context

Per ADR 124, all queries return `AsyncIterable<Row>`. But when should the runtime buffer results in memory vs. streaming from a cursor?

**The tradeoff:**
- Small queries (< 1K rows): buffering is faster (no cursor overhead) and simpler
- Large queries (exports, reports): streaming is memory-safe and scales
- Most adapters don't have perfect cost estimators
- Connection pools are a shared resource; long-lived cursors tie up capacity

This ADR defines how the runtime selects buffering vs. streaming, the required adapter support, budget enforcement across both modes, and observability for frameworks and tooling.

## Decision

### One-time pre-emission decision

Before the first row is emitted:

1. Runtime runs contract verification and pre-execution lints/budgets
2. Runtime attempts to estimate result size via:
   - **EXPLAIN**: If adapter supports cost estimates with rows/bytes
   - **Probe fetch**: If no EXPLAIN, fetch first `firstFetchRows` rows into a buffer (adapter-provided threshold)
3. Compare estimates against configured thresholds (rows, bytes)
4. Make final decision: **buffer** or **stream**
5. **Lock the decision**: Never change for the life of this iterator

This guarantees semantic stability: a query that starts buffered won't flip to streaming mid-emission.

### Configuration

Operators configure selection policy when creating the runtime:

```typescript
interface ExecutionConfig {
  defaultMode: 'auto' | 'buffer' | 'stream'

  thresholds: {
    rows: number              // if EXPLAIN rows > N → stream
    bytes: number             // if est bytes > N → stream
    firstFetchRows: number    // rows to probe-fetch if no EXPLAIN
  }

  cursor: {
    fetchSize: number         // rows per batch during streaming
    holdable?: boolean        // prefer holdable cursors (avoids txn pinning)
    idleTimeoutMs?: number    // abort stream if no consumer pull for N ms
  }
}
```

**Defaults:**
```typescript
{
  defaultMode: 'auto',
  thresholds: { rows: 1_000, bytes: 2_000_000, firstFetchRows: 256 },
  cursor: { fetchSize: 1_000, holdable: true, idleTimeoutMs: 15_000 }
}
```

### Selection Algorithm

```
if defaultMode == 'buffer':
  return BUFFER
if defaultMode == 'stream':
  return STREAM

// auto mode
estimates = getEstimates(plan, adapter)  // EXPLAIN or probe

if estimates.rows > thresholds.rows OR estimates.bytes > thresholds.bytes:
  return STREAM
else:
  return BUFFER
```

### Estimate acquisition

#### Via EXPLAIN (preferred)
If adapter declares `canExplain: true`:
- Runtime issues EXPLAIN for the plan
- Adapter provides row count and/or byte estimate
- Runtime uses estimates immediately (no probe needed)

#### Via Probe fetch (fallback)
If adapter doesn't support EXPLAIN or EXPLAIN is disabled:
- Runtime asks adapter to `openCursor(plan, { fetchSize: firstFetchRows })`
- Adapter fetches first `firstFetchRows` rows
- Runtime records row count, samples bytes per row to estimate total
- Runtime decides: if sample indicates > threshold, stream; else collect remaining rows
- Cursor remains open if streaming, or is closed if buffering

Example (Postgres):
```sql
-- EXPLAIN-based
EXPLAIN (FORMAT JSON, ANALYZE true) SELECT ...  -- get row estimates

-- Probe-based
BEGIN;
DECLARE cursor_xyz CURSOR FOR SELECT ...;
FETCH 256 FROM cursor_xyz;  -- get first 256 rows, estimate total
-- If buffering: FETCH ALL; CLOSE cursor_xyz;
-- If streaming: START YIELDING FROM cursor_xyz
```

## Adapter Capabilities

Adapters declare what they support via capability flags:

```typescript
interface AdapterCapabilities {
  canExplain: boolean              // EXPLAIN with cost estimates available
  canServerCursor: boolean         // Server-side cursor support
  cursorHoldable?: boolean         // Cursors survive transaction boundaries
  hasAccurateRowEstimates: boolean // EXPLAIN row estimates are reliable
}
```

At runtime creation, the runtime negotiates:
- If `canExplain: false`, use probe fetch
- If `canServerCursor: false`, always buffer (cursors not available)
- If `cursorHoldable: true`, prefer holdable cursors to avoid pinning transactions

### Adapter Cursors (Adapter SPI)

Adapters implement cursor semantics via new SPI:

```typescript
interface Cursor {
  read(fetchSize: number): Promise<{ rows: unknown[]; done: boolean }>
  close(): Promise<void>
}

interface Adapter {
  // Existing
  execute(plan, ctx): Promise<{ rows: unknown[]; summary }>

  // New (for mode selection & streaming)
  openCursor(plan, ctx, opts: { fetchSize: number; rowMode?: 'object' | 'array' }): Promise<Cursor>

  explain(plan, ctx, opts?: { analyze?: boolean }): Promise<{
    rowCount?: number
    bytes?: number
    cost?: number
  }>
}
```

**Adapter implementations:**
- **Postgres**: Use `DECLARE CURSOR`, `FETCH N`, `EXPLAIN (ANALYZE)`
- **MySQL**: Use streaming rows from mysql2, `EXPLAIN`
- **SQLite/libsql**: Chunked iteration, approximate row count via `COUNT(*)`

Adapters that can't truly stream declare `canServerCursor: false` and the runtime always buffers (with optional pseudo-streaming via chunked buffering).

## Budgets & Guardrails

### Pre-execution budgets (fail fast)

Before streaming or buffering begins:
- EXPLAIN row estimate vs. `maxRows` → fail if exceeded
- EXPLAIN byte estimate vs. `maxBytes` → fail if exceeded
- SQL length check → fail if query is suspiciously long
- Policy checks (capability validation, PII sensitivity) → fail if violated

On pre-execution violation: `RuntimeError(BUDGET_EXCEEDED, phase: 'beforeExecute')`

### In-stream budgets (terminate early)

While rows are being emitted (buffering or streaming):
- **Row count**: if rows emitted > `maxRows`, terminate stream
- **Bytes**: if estimated/actual bytes > `maxBytes`, terminate stream
- **Latency**: if wall-clock since first row > `maxLatencyMs`, terminate stream
- **Idle timeout**: if no consumer pulls for > `idleTimeoutMs`, terminate stream

On in-stream violation: Stream is closed, consumer sees `RuntimeError(BUDGET_EXCEEDED, streaming: true)` on next `for await` iteration

### Error taxonomy

```
phase: 'beforeExecute'  → budget violated before iteration (fail-fast)
streaming: true         → budget violated during iteration (terminate-early)
partial: true           → some rows were emitted before termination
```

## Observability

### Iterator info

The result iterator exposes:

```typescript
interface StreamResult<T> extends AsyncIterable<T> {
  info: {
    executionMode: 'buffer' | 'stream'  // final decision
    estimatedRows?: number
    estimatedBytes?: number
    cursorFetchSize?: number
    abortSignal?: AbortSignal
  }

  // Resolves when iteration ends (complete or terminated)
  summary: Promise<{
    executionMode: 'buffer' | 'stream'
    actualRows: number
    actualBytes?: number
    durationMs: number
    completed: boolean  // true if fully iterated; false if terminated
    error?: RuntimeError
  }>
}
```

### Telemetry

Telemetry events include:

```typescript
interface ExecutionEvent {
  plan: Plan
  executionMode: 'buffer' | 'stream'
  estimatedRows?: number
  estimatedBytes?: number
  actualRows: number
  actualBytes?: number
  durationMs: number
  completed: boolean
  budgetViolations?: { rule: string; limit: number; observed: number }
}
```

### Hooks (per ADR 014 extension)

Optional streaming lifecycle hooks:

```typescript
interface Plugin {
  onStreamOpen?(plan, ctx, mode: 'buffer' | 'stream'): Promise<void>
  onStreamChunk?(plan, ctx, stats: { chunkSize, totalRows, elapsedMs }): Promise<void>
  onStreamClose?(plan, ctx, summary): Promise<void>
  onStreamError?(plan, ctx, err): Promise<void>
}
```

These fire at **batch granularity**, not per-row, to keep overhead bounded.

## Transaction & Connection Semantics

### For buffered queries
- Open transaction (if needed for consistency)
- Fetch all rows into buffer
- Close transaction
- Yield rows from buffer (no connection held)

### For streamed queries
- Open transaction
- Keep cursor open during streaming
- Prefer holdable cursors (survive commit boundary)
- Close transaction after stream ends or is terminated
- Raise error if timeout/idle triggers first

### Pool protection

- Cursor `idleTimeoutMs` prevents long-lived streams from stalling
- `fetchSize` is tunable to avoid single huge fetch
- Holdable cursors prevent transaction pinning (Postgres specific)
- Runtime provides `signal: AbortSignal` for framework integration (HTTP request cancellation, etc.)

## Cancelation & Backpressure

```typescript
await runtime.execute(plan, { signal: req.signal })
// or
const it = runtime.execute(plan)
// consumer controls pull rate naturally via async iteration
```

On `signal.abort()` or timeout, the stream terminates and the consumer sees an error.

## Pseudo-streaming for non-streaming adapters

Adapters that can't provide true server-side cursors (SQLite, some cloud providers) can still participate:

```typescript
// Adapter reports canServerCursor: false
// Runtime always buffers but can chunk internally if result is large
// To user, it still looks like AsyncIterable (no difference in API)
```

This ensures consistent semantics across targets without forcing all adapters to implement cursors.

## Examples

### EXPLAIN-based decision (Postgres with cost estimates)

```typescript
const rt = createRuntime({
  execution: {
    thresholds: { rows: 1_000, bytes: 2_000_000 }
  }
})

const plan = db.bigTable.select(/* ... */).build()

const it = rt.execute(plan)
console.log(it.info.executionMode) // 'stream' (EXPLAIN said 50k rows)
```

### Probe-based decision (SQLite, adapter has no EXPLAIN)

```typescript
const rt = createRuntime({
  execution: {
    thresholds: { firstFetchRows: 256 }
  }
})

const plan = db.someTable.select(/* ... */).build()

const it = rt.execute(plan)
// Adapter probes first 256 rows, estimates 320 total → buffer
console.log(it.info.executionMode) // 'buffer'
```

### In-stream budget violation

```typescript
const it = rt.execute(plan, { maxRows: 1_000 })

try {
  for await (const row of it) {
    // ...
  }
} catch (err) {
  if (err.code === 'BUDGET_EXCEEDED') {
    console.log(err.details) // { rule: 'maxRows', limit: 1_000, observed: 1_001, streaming: true }
  }
}
```

## Testing Strategy

- Unit tests for selection algorithm (EXPLAIN output → buffer vs stream)
- Probe fetch tests (partial rows → decision logic)
- Budget enforcement (pre-execution and in-stream, both modes)
- Resource tests (connections returned, cursors closed, timeouts enforced)
- Adapter conformance tests (cursor semantics, capabilities declared correctly)
- Integration tests with various result sizes and framework patterns
- Chaos tests (stream abort, timeout, network failures)

## Open Questions

- Adaptive thresholds that learn per plan (sampling-based)
- Streaming chunk size auto-tuning based on memory/throughput
- Integration with PPg's preflight and streaming preview mode

## Decision Record

The runtime selects buffer vs. stream mode before the first row is emitted, based on EXPLAIN estimates or a small probe fetch. This decision is locked for the lifetime of the iterator, ensuring predictable semantics. Adapters declare capabilities (EXPLAIN, cursors, holdable) and implement cursor semantics for streaming. Budgets apply in both modes: pre-execution (fail-fast) and in-stream (terminate-early). Observability via iterator `.info`, `.summary`, hooks, and telemetry gives frameworks full visibility into the selection and execution.
