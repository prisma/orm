# ADR 018 — Plan Annotations Schema and Validation

> **Update — the hook is removed.** The middleware hook `beforeExecute` this ADR describes no longer exists. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced it with lifecycle events and interceptors on a tree of activities.

## Context

- Raw SQL Plans intentionally do not carry an AST, so guardrails must rely on explicit annotations
- Even AST-backed lanes benefit from standardized annotations for policy routing, sensitivity, and budgets
- Without a canonical schema and validation rules, plugins would diverge, weakening safety guarantees

## Decision

- Define a canonical JSON schema for `Plan.meta.annotations` and validate it at build time and runtime
- Reserve a small set of top-level annotation keys for core policies and direct all custom claims to `annotations.ext`
- Keep annotations out of plan identity per ADR 013 to avoid hash churn, while still enforcing them during execution

## Goals

- Make raw Plans verifiable without SQL parsing
- Provide a stable contract for plugins and platform policies to read from
- Allow policies to evolve safely through an extension surface that does not collide with reserved keys

## Non-goals

- SQL parsing in core to infer annotations
- Encoding result schemas or parameter types in annotations beyond optional codecs already defined on `Plan.meta`

## Schema

`Plan.meta.annotations` must conform to the following JSON Schema
```json
{
  "$id": "https://prisma.dev/schemas/plan-annotations-v1.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Plan Annotations v1",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "intent": {
      "type": "string",
      "enum": ["read", "write", "admin"]
    },
    "isMutation": {
      "type": "boolean"
    },
    "requiresWhereForMutation": {
      "type": "boolean",
      "default": true
    },
    "hasWhere": {
      "type": "boolean"
    },
    "hasLimit": {
      "type": "boolean"
    },
    "sensitivity": {
      "type": "string",
      "enum": ["none", "pii", "phi", "secrets"],
      "default": "none"
    },
    "ownerTag": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._:-]{1,64}$"
    },
    "budget": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "maxRows": { "type": "integer", "minimum": 1 },
        "maxLatencyMs": { "type": "integer", "minimum": 1 },
        "maxSqlLength": { "type": "integer", "minimum": 1 }
      }
    },
    "ext": {
      "type": "object",
      "description": "Extension namespace for custom claims",
      "additionalProperties": true
    }
  },
  "required": ["intent", "isMutation"],
  "allOf": [
    {
      "if": { "properties": { "intent": { "const": "read" } } },
      "then": { "properties": { "isMutation": { "const": false } } }
    },
    {
      "if": { "properties": { "isMutation": { "const": true } } },
      "then": {
        "properties": { "requiresWhereForMutation": { "const": true } }
      }
    }
  ]
}
```

### Notes

- Reserved keys are explicit in properties
- `ext` is the only place custom keys may appear
- Future core keys are added through schema versioning, not by repurposing `ext`

## Validation rules

### Build-time validation

- Lanes and helpers that construct Plans must validate annotations against the schema
- Raw Plans must include all required keys and should include `hasWhere` and `hasLimit` when meaningful
- Failing validation is an error in strict mode and a warning in permissive mode

### Runtime validation

- The runtime validates annotations again before `beforeExecute`
- Cross-field rules are enforced regardless of lane
  - **Examples**:
    - `intent = read` implies `isMutation = false`
    - `isMutation = true` and `requiresWhereForMutation = true` requires `hasWhere = true`
- Policy modules map annotations to rule decisions
  - **Example**: `sensitivity: pii` may require a limit or server-side redaction

### Modes

- **strict**: missing required keys or violated rules block execution
- **permissive**: produce warnings and proceed, but plugins may still block at error level

## Reserved keys

- **intent**: read, write, or admin operation routing
- **isMutation**: data or schema changing
- **requiresWhereForMutation**: policy expectation for mutation predicates
- **hasWhere**: author's declaration of predicate presence
- **hasLimit**: author's declaration of row limiting
- **sensitivity**: data classification for policy routing
- **ownerTag**: short tag for ownership, cost center, or service mapping
- **budget**: soft limits for rows, latency, and SQL length
- **ext**: namespaced custom claims

## Extension guidance

- Namespacing in `ext` should follow `vendor.pluginName.key` or a nested object per plugin
  - **Example**: `ext: { "acme.guardrails": { rowset: "large" } }` or `ext: { acme: { guardrails: { rowset: "large" } } }`
- Do not duplicate reserved keys inside `ext`
- Extension claims should be pure JSON values and reasonably small to avoid telemetry bloat

## Interactions with other ADRs

- **ADR 011**: annotations live under `Plan.meta.annotations`
- **ADR 012**: raw Plans must provide the minimal set so guardrails can function without an AST
- **ADR 013**: annotations are excluded from plan identity and hashing to avoid churn across lanes
- **ADR 014**: hooks may read and enrich annotations but must not mutate in place
  - Plugins return a derived Plan with updated annotations if needed

## Error semantics

- **Schema violation**: surfaced as `policy/annotations-invalid` with a JSON pointer to the failing path
- **Contradictory claims**: surfaced as `policy/annotations-contradiction`
  - **Example**: `intent = read` with `isMutation = true`
- **Missing minimal claims in raw lane**: surfaced as `policy/annotations-missing-minimal` in strict mode

## Stability and versioning

- This is annotations v1: stored as `$id` in the published schema and referenced in docs
- **Backward-compatible additions**: introducing new optional keys or enum values with tolerant readers
- **Breaking changes**: require v2 with dual-reader support in the runtime and a migration guide

## Testing

- JSON Schema validation tests for positive and negative cases
- Runtime integration tests ensuring the same Plan is allowed or blocked consistently across lanes when annotations match
- Fuzz tests for `ext` payload size and shape to ensure resilience

## Consequences

### Positive

- Raw Plans become first-class citizens for safety and policy without SQL parsing
- Plugins and PPg features can rely on a stable, minimal contract
- Lane portability is preserved because reserved keys have consistent meaning

### Trade-offs

- Requires authors of raw Plans to supply truthful annotations or enable adapter enrichment
- Some policies are weaker without structural hints like `refs` and `projection`, which remain optional and outside annotations

## Open questions

- Whether to add an optional `annotationsVersion` field on `Plan.meta` to ease multi-schema transitions
- Standard sensitivity sub-classes or mappings to legal or compliance regimes without hard-coding them in core

## Decision record

- Adopt a canonical JSON schema for plan annotations with validation at build time and runtime
- Reserve a small set of core keys and route all custom claims to `annotations.ext`
- Keep annotations out of plan identity while using them for policy and guardrails
