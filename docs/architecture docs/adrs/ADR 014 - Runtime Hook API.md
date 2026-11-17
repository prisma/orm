# ADR 014 — Runtime hook API v1 (lane-neutral)

Status: **Superseded by [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md)**. ADR 271 replaces this hook API with lifecycle events and interceptors on a tree of activities. `beforeCompile` and `onRow` remain; `beforeExecute` and `afterExecute` are removed, and `onError` is not part of the middleware interface: a failed statement ends with the `activityEnded` outcome `failed`.

## Context

We support multiple authoring lanes that all emit a Plan: SQL DSL, ORM over DSL, Raw SQL, future TypedSQL. Guardrails, budgets, telemetry, and vendor features must attach at runtime without lane coupling. We need a stable, minimal hook API that plugins can implement once and have it work for every lane.

## Decision

Ship a lane-neutral hook API v1 with execution mode selection (per ADR 125):
- Execution returns `AsyncIterable<Row>` immediately with runtime-managed buffering/streaming
- Four main hooks: `beforeCompile`, `beforeExecute`, `afterExecute`, `onError`, plus optional per-row `onRow`
- Per-row `onRow` enables light, incremental observation without buffering the entire result
- Hooks operate on immutable inputs and return derived outputs; plugins must not mutate provided objects
- Policy outcomes are expressed via consistent lint levels and budget decisions; the runtime decides whether to allow, warn, or block based on configuration

## Data shapes

```typescript
// From ADR 011
export interface Plan<Row = unknown> {
  ast?: QueryAST
  sql: string
  params: unknown[]
  meta: {
    target: 'postgres' | 'mysql' | 'sqlite'
    coreHash: string
    profileHash?: string
    lane: 'dsl' | 'orm' | 'raw-sql' | 'typed-sql'
    createdAt: string
    refs?: { tables: string[]; columns: Array<{ table: string; column: string }> }
    projection?: Record<string, string>
    annotations?: {
      intent?: 'read' | 'write' | 'admin'
      isMutation?: boolean
      requiresWhereForMutation?: boolean
      hasWhere?: boolean
      hasLimit?: boolean
      sensitivity?: 'none' | 'pii' | 'phi' | 'secrets'
      ownerTag?: string
      budget?: { maxRows?: number; maxLatencyMs?: number }
      ext?: Record<string, unknown>
    }
    codecs?: { params?: unknown; row?: unknown }
    // runtime adds planId and sqlFingerprint per ADR 013
    planId?: string
    sqlFingerprint?: string
  }
}

export interface DraftPlan {
  // For lanes that delay lowering, ast is present and sql/params may be undefined
  ast?: QueryAST
  sql?: string
  params?: unknown[]
  meta: Plan['meta']
}
```

## Diagnostics

```typescript
export type Level = 'off' | 'warn' | 'error'

export interface Violation {
  ruleId: string
  level: Level
  message: string
  ref?: { table?: string; column?: string }
  suggestion?: string
}

export interface BudgetDecision {
  kind: 'row' | 'latency' | 'sqlLength'
  limit: number
  observed: number
  level: Level
}
```

## Hook result

```typescript
export interface HookResult<T = unknown> {
  // A derived DraftPlan or Plan if the plugin rewrites or annotates
  plan?: DraftPlan | Plan<T>
  // Lint violations produced by the plugin
  violations?: Violation[]
  // Budget outcomes produced by the plugin
  budgets?: BudgetDecision[]
  // Decision hint for the runtime
  decision?: 'allow' | 'warn' | 'block'
  // Freeform diagnostics for logs and tooling
  notes?: Array<{ message: string; data?: unknown }>
}
```

## Hook signatures and guarantees

Order of execution matches registration order for all plugins

### beforeCompile(ctx, draft): Promise<HookResult | void>
- Runs before lowering AST to SQL
- Always runs, even if the lane already provided SQL
- Raw-SQL lanes will typically no-op
- **Input**: frozen DraftPlan
- **Allowed**: return a new DraftPlan with added annotations, refs, projection; add violations for structural issues detectable pre-compile
- **Not allowed**: change meta.target or meta.coreHash
- **Runtime behavior**: merges results from all plugins, then compiles to a concrete Plan

### beforeExecute(ctx, plan): Promise<HookResult | void>
- Runs after compile and before initiating streaming
- **Input**: frozen Plan with sql, params, meta.planId
- **Allowed**: return a derived Plan with additional annotations or redactions; report violations and budget prechecks
- **Runtime behavior**: contract verification runs here; lints and preflight budgets are evaluated here; if any plugin requests block or a violation at error level maps to block, streaming is skipped and onError is invoked with a policy error

### onRow(ctx, plan, row): Promise<HookResult | void> (optional)
- Runs for each row as it streams from the driver
- **Input**: frozen Plan and the current row value
- **Allowed**: record per-row telemetry, sampling, or early termination signals
- **Runtime behavior**: if a plugin returns a termination signal, the stream is closed

### afterExecute(ctx, plan, result): Promise<HookResult | void>
- Runs after the stream completes or is closed
- **Input**: frozen Plan and a result envelope { rowCount, latencyMs, completed: boolean }
- **Allowed**: record aggregated telemetry, emit budget violations based on observed totals, attach notes
- **Runtime behavior**: if observed budgets exceeded error thresholds and streaming completed, violations are surfaced post-hoc

### onError(ctx, phase, planOrDraft, err): Promise<void>
- Runs when a compile, execute, or plugin failure occurs
- **Input**: phase: 'compile' | 'execute' | 'plugin'; planOrDraft: the latest DraftPlan or Plan if available; err: error with a structured kind field when possible
- **Contract**: must not throw; should log and attach diagnostics

## Error semantics
- **Policy violation**: produced by plugins via violations or by runtime checks; mapped by level: error blocks, warn logs and continues, off ignored
- **Budget breach**: treated like a violation with ruleIds budget.maxRows, budget.maxLatency, budget.maxSqlLength
- **Plugin error**: treated as phase = 'plugin' error, triggers onError, does not crash the process; runtime may disable the offending plugin instance for the request
- **Execution error**: driver or adapter thrown errors with phase = 'execute', bubbled to caller after onError

## Lint levels and configuration
- Each rule has a level off | warn | error; configured at runtime creation and overridable per request
- **Recommended defaults**: no-select-star: error, mutation-requires-where: error, limit-required: warn, unindexed-predicate: warn
- **Budgets configured globally or per request**: maxRows, maxLatencyMs, maxSqlLength

## Allowed Plan modifications by plugins
- Add or refine meta.annotations, meta.refs, meta.projection
- Redact literals in sql when producing diagnostics only
- Replace Plan with an equivalent Plan that keeps plan.meta.target and plan.meta.coreHash unchanged

## Not allowed
- Changing meta.target or meta.coreHash
- Mutating the input object in place

## Why this ADR
- Locks a lane-independent extension surface so guardrails and telemetry do not depend on how queries were authored
- Prevents API drift as new lanes are added
- Ensures plugin authors have clear guarantees about when their code runs and what they may change

## Alternatives considered

### Lane-specific hook sets
- Fragments the ecosystem and doubles work for plugin authors

### Single monolithic aroundExecute hook
- Harder to separate compile-time and run-time concerns and budgets

## Consequences

### Positive
- One plugin works across DSL, ORM, raw, and future TypedSQL
- Clear blocking semantics and consistent diagnostics
- Compatibility with PPg preflight where the same hooks run in a service

### Trade-offs
- Plugins that need deep AST access may be less effective on raw Plans without annotations; acceptable given the escape-hatch intent

## Versioning and compatibility
- This is v1 of the hook API; backward compatible changes add optional fields or hooks
- Breaking changes require a new major hook API version negotiated at runtime

## Testing
- Contract tests with a sample plugin exercising all hooks
- Golden tests asserting consistent blocking behavior for equivalent Plans across lanes
- Fault-injection tests for plugin throws routed to onError without process crash

## Open questions
- Whether to expose an opt-in enrichment stage for adapters to add refs to raw Plans behind a feature flag
- Standard naming for ruleIds to avoid collisions across plugins
