# ADR 022 — Lint rule taxonomy & configuration model

> **Update — the hook is removed.** The middleware hook `beforeExecute` this ADR describes no longer exists. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced it with lifecycle events and interceptors on a tree of activities.

## Context

Guardrails are first-class in Prisma Next and must be consistent, configurable, and machine readable. Multiple query lanes can produce Plans, and violations must reference rule IDs in a stable taxonomy. Different environments need different defaults and override behavior without code changes.

## Decision

Define a canonical lint rule taxonomy with stable rule IDs used across lanes and runtimes:
- Support three levels per rule: off | warn | error
- Provide two preset modes that set sensible defaults: strict and permissive
- Expose a unified configuration model that supports global, per-rule, and per-lane overrides
- Require lanes to attach rule context to violations so errors are actionable

## Canonical rule taxonomy v1

Rule IDs are lowercase kebab case and namespaced by domain where helpful

### Read safety
- **no-select-star**: disallow SELECT * unless explicitly annotated with annotations.intent = 'introspect'
- **no-missing-limit**: require LIMIT on reads unless projection or lane marks the query as bounded
- **no-unindexed-predicate**: flag equality predicates on columns without a usable index per contract
- **no-cartesian-join**: detect joins without ON conditions or with trivially true predicates

### Write safety
- **mutation-requires-where**: UPDATE/DELETE must include a selective WHERE unless annotated as bulk and budgeted
- **no-unguarded-truncate**: TRUNCATE requires an explicit annotation and elevated role

### Performance hygiene
- **row-count-budget**: enforce max expected rows via EXPLAIN or heuristics
- **latency-budget**: enforce max expected latency per Plan
- **sql-size-budget**: enforce max SQL text size to avoid accidental explosions

### Target constraints
- **adapter-capability-missing**: rule-level signal when lane requires capabilities not available in adapter

### Privacy and PII
- **sensitive-column-read**: reading columns tagged sensitive in the contract requires annotations or role

## Levels and mode presets

### Levels
- **off**: rule disabled
- **warn**: report violation, do not block execution
- **error**: block execution

### Mode presets

#### strict
- no-select-star: error
- no-missing-limit: error
- mutation-requires-where: error
- no-unindexed-predicate: warn
- no-cartesian-join: error
- row-count-budget: error when budget configured
- latency-budget: warn when budget configured
- sql-size-budget: warn
- adapter-capability-missing: error
- sensitive-column-read: error

#### permissive
- no-select-star: warn
- no-missing-limit: warn
- mutation-requires-where: error
- no-unindexed-predicate: off
- no-cartesian-join: warn
- row-count-budget: warn when budget configured
- latency-budget: off
- sql-size-budget: off
- adapter-capability-missing: error
- sensitive-column-read: warn

Rules not listed default to off

## Configuration model

Declarative, mergeable configuration passed to the runtime and visible to plugins

```typescript
type LintLevel = 'off' | 'warn' | 'error'
type Mode = 'strict' | 'permissive'

type LintConfig = {
  mode?: Mode
  rules?: Partial<Record<string, LintLevel>>
  lanes?: Record<
    string, // lane ID like 'dsl', 'orm', 'typed-sql', 'raw'
    {
      rules?: Partial<Record<string, LintLevel>>
    }
  >
  budgets?: {
    maxRows?: number
    maxLatencyMs?: number
    maxSqlBytes?: number
  }
}
```

### Precedence
- Lane-specific override takes precedence over global rules
- Explicit rules entries override mode presets
- Missing entries inherit from the selected mode

### Example
```typescript
lints({
  mode: 'strict',
  rules: {
    'no-unindexed-predicate': 'error',
    'sql-size-budget': 'off'
  },
  lanes: {
    'typed-sql': {
      rules: {
        'no-missing-limit': 'warn' // classroom queries
      }
    }
  },
  budgets: { maxRows: 10000, maxLatencyMs: 200 }
})
```

## How lanes attach rule context

Lanes are responsible for providing structured context to help users remediate issues. Violations must include:
- **ruleId**: canonical rule ID
- **message**: human-readable summary
- **details**: machine-readable payload with lane-specific fields
- **refs**: subset of plan.meta.refs relevant to the violation
- **hints**: suggested fixes or annotations, optionally with code frames or AST paths

### Violation envelope
```typescript
type LintViolation = {
  ruleId: string
  level: LintLevel
  message: string
  details?: unknown
  refs?: {
    tables?: string[]
    columns?: Array<{ table: string; column: string }>
  }
  hints?: Array<{ action: string; payload?: unknown }>
}
```

### Examples
- **no-missing-limit**: details: { reason: 'unbounded-scan', estimatedRows?: number }, hints: [{ action: 'addLimit', payload: { value: 100 } }]
- **no-unindexed-predicate**: details: { table: 'user', column: 'email', operator: '=' }, hints: [{ action: 'createIndex', payload: { table: 'user', columns: ['email'] } }]
- **mutation-requires-where**: details: { table: 'order', mutation: 'update' }, hints: [{ action: 'addWhere' }]

## Mapping to runtime errors

The lint plugin maps LintViolation.level to runtime behavior based on configuration:
- **error** → throw lint/<ruleId> with the violation payload
- **warn** → log structured event and continue
- **off** → suppressed

### Error object
```typescript
type RuntimeError = {
  code: `lint/${string}`
  message: string
  details?: LintViolation
  phase: 'beforeExecute'
}
```

## Lane identification

Plans should include meta.lane as a hint for lane-specific overrides and reporting:
- **dsl** for the contract-aware SQL builder
- **orm** for the higher-level ORM lane
- **typed-sql** for typed SQL factories
- **raw** for the escape hatch

If absent, configuration falls back to global rules

## Testing and conformance
- Golden tests ensure rule IDs, default levels by mode, and messages remain stable
- Each adapter must provide fixtures to validate no-unindexed-predicate against its index semantics
- Lanes must include unit tests that produce deterministic LintViolation shapes for common cases

## Backward and forward compatibility
- Adding new rule IDs is allowed and defaults to off in both modes
- Renaming a rule ID is a breaking change and requires a deprecation cycle with aliasing
- Rule messages may evolve, but details structure must remain backward compatible within a major version

## Open questions
- Whether to add a policy/ namespace for non-lint policy checks that share the same configuration model
- How to surface line/column locations for lanes that originate from textual SQL without a full parser
- Optional PPg-hosted presets for organization-wide defaults and enforcement
