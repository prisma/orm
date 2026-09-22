# Error Handling: Failures, Operational Errors, and Bugs

This document defines shared error concepts for Prisma 8 so we can be consistent across packages and planes (CLI, migration planning, query planning, runtime execution).

See [ADR 239 — Errors are structural envelopes with dotted namespace codes](architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md) for the concrete code format, namespace list, and the `StructuredError` mechanism that implements the taxonomy below. The [error reference](reference/error-reference.md) lists every published code; CI keeps it complete (`pnpm check:error-reference`).

## Goals

- **Make error handling composable** across modular packages (domain/layer/plane).
- **Keep failures actionable** (clear “why / fix / docs”) without turning every API into “Result plumbing”.
- **Preserve stack traces for bugs** and unexpected faults.
- **Ensure boundaries are predictable** (stable codes, deterministic output, consistent exit codes).

## Taxonomy

### Failure (expected)

An expected, explainable outcome where a logical condition is not met.

Examples:
- Invalid user input or config shape
- Plan-builder misuse (e.g., missing `from()` / missing `select()`)
- Capability gating (feature requires capability but it’s absent/false)
- Policy/guardrail blocks (e.g., budgets/lints in strict mode)

Properties:
- **Actionable**: caller can fix something deterministically.
- **Stable**: should have a stable code and structured metadata when surfaced.

Recommended handling:
- **Internals may throw** a structured failure error to abort quickly and keep context/stack.
- **System boundaries convert** structured failures into a returned `Result` / envelope.

### Operational error (expected external fault)

An expected error caused by an external system state, not a bug in Prisma 8.

Examples:
- Database connection refused / timeout
- Network interruptions
- Permission/auth failures (if/when modeled)
- Driver-level errors (e.g., Postgres errors)

Properties:
- Often transient and environment-dependent.
- May be actionable but not always fixable in-process.

Recommended handling:
- **Throw through lower layers** (drivers/adapters typically throw).
- **Catch at boundaries** when we can translate to a stable, actionable envelope (while still retaining stack/context where available).

### Bug (unexpected fault)

An invariant break or programming error where the system cannot reliably continue.

Examples:
- Unexpected `undefined` / impossible branch
- Internal assertion failure
- Serialization/type invariants broken after validation

Recommended handling:
- **Throw and fail fast**.
- Only catch at the outermost boundary for crash reporting / last-resort formatting, without disguising the issue as an “expected failure”.

**Bugs throw `InternalError`**, never a structured envelope. Use `InternalError` and `assertNever` from `@internal/utils/internal-error`; `assertNever` also gives a compile-time exhaustiveness check for switches over discriminated unions. A `throw new Error(...)` is neither a structured failure nor a labeled bug, so it's banned by the `no-bare-throw` lint ratchet — convert bare throws to one of the two paths above.

## Representation in this codebase

### Generic Result type: Ok / NotOk envelopes

We provide a generic `Result<T, F>` type for representing success or failure outcomes at system boundaries. This type is used when a function can return either a success value or a structured failure.

```typescript
import type { Result, Ok, NotOk } from '@internal/utils/result';
import { ok, notOk, okVoid } from '@internal/utils/result';

// Success with a value - both T and F must be specified
function divide(a: number, b: number): Result<number, { code: string; message: string }> {
  if (b === 0) {
    return notOk({ code: 'DIVISION_BY_ZERO', message: 'Cannot divide by zero' });
  }
  return ok(a / b);
}

// Validation that returns void on success
function validateInput(input: string): Result<void, { code: string; message: string }> {
  if (input.length === 0) {
    return notOk({ code: 'EMPTY_INPUT', message: 'Input cannot be empty' });
  }
  return okVoid();
}

// Usage
const result = divide(10, 2);
if (result.ok) {
  console.log('Result:', result.value);
} else {
  console.log('Error:', result.failure.code);
}
```

**Naming and design rationale:**
- `Ok<T>` / `NotOk<F>` mirror the `ok: true/false` discriminator property
- `NotOk` avoids collision with domain-specific "Failure" or "Error" types
- `value` for success, `failure` for unsuccessful—distinct names prevent confusion
- `failure` (not `error`) distinguishes structured failure data from JS `Error` semantics
- **No default for `F`** - Both type parameters are required; the whole point is to strictly type failures, not to propagate JavaScript's untyped error handling

**When to use Result:**
- At system boundaries (CLI commands, migration runner, SDK entrypoints)
- When a function can fail in expected ways that callers should handle
- When you want to avoid throwing for expected failures

**When NOT to use Result:**
- Deep within package internals (prefer ergonomic throws + catch at boundary)
- For bugs/unexpected errors (throw and fail fast)
- For streaming APIs (use AsyncIterable that throws on error)

See:
- `packages/1-framework/0-foundation/utils/src/result.ts`

### CLI boundary: structured errors + Result conversion

CLI commands use structured errors and convert them to a `Result` at the command boundary. Non-structured errors propagate (fail fast) to preserve stack traces.

`CliStructuredError` implements the structural `StructuredError` interface from `@internal/utils/structured-error` (ADR 239), so it's recognizable by `isStructuredError` across the control/execution plane split, not just by its own class.

See:
- `packages/1-framework/1-core/errors/src/control.ts` (`CliStructuredError`)
- `packages/1-framework/3-tooling/cli/src/utils/result.ts` (`performAction`)
- `docs/CLI Style Guide.md` ("Errors", exit codes)

### Plan/build-time failures: stable RuntimeError codes

Plan-building failures are represented as a `RuntimeErrorEnvelope` with a dotted `NAMESPACE.SUBCODE` code (e.g. `PLAN.*`, `CONTRACT.*`, `LINT.*`, `BUDGET.*`, `DRIVER.*`, `MIGRATION.*`, `ORM.*`); see `RuntimeErrorEnvelope`/`runtimeError` in `packages/1-framework/1-core/framework-components/src/shared/runtime-error.ts`.

Migration runner failures use stable `SqlMigrationRunnerErrorCode` values, all under the `MIGRATION.*` namespace (e.g., `MIGRATION.EXECUTION_FAILED`, `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED`) returned as part of `Result<SqlMigrationRunnerSuccessValue, SqlMigrationRunnerFailure>`. This follows the pattern described in "Provide stable codes for 'expected failures'" (see Guidelines section below) where stable codes enable deterministic error handling at system boundaries.

See:
- `packages/2-sql/9-family/src/core/migrations/types.ts` (`SqlMigrationRunnerErrorCode`, `SqlMigrationRunnerFailure`)
- SQL lane helpers that throw these for invalid builder usage/capability gating.

### Runtime execution: streaming API throws on failure

Runtime execution is modeled as an `AsyncIterable` that throws on error. This is a deliberate shape: it allows early abort and preserves context/stack in async workflows.

Guardrails (budgets/lints) may block execution by throwing a structured runtime error (a failure) in strict mode.

See:
- `packages/1-framework/1-core/framework-components/src/runtime-core.ts`
- `packages/2-sql/5-runtime/src/middleware/budgets.ts`
- `packages/2-sql/5-runtime/src/middleware/lints.ts`

## Guidelines

### 1) “Return Result” is a boundary policy, not a universal implementation rule

- **Within packages**, prefer APIs that are ergonomic for the domain (builders, streams, plugin hooks).
- **At system boundaries**, prefer returning a `Result`/envelope for *expected failures* so callers (CLI/apps/agents) can handle them deterministically.

Boundaries include:
- CLI command actions
- Migration runner entrypoints
- Public SDK entrypoints that are the “edge” of the system

### 2) Only catch what you intend to handle

- Catch structured failures that you can translate to an actionable `Result`/envelope.
- Do not broadly catch and wrap unknown errors; let them fail fast.

### 3) Provide stable codes for “expected failures”

- “Failure” surfaces should use stable dotted codes (e.g., `CONFIG.FILE_NOT_FOUND`, `MIGRATION.PRECHECK_FAILED`, `BUDGET.ROWS_EXCEEDED`).
- Codes are how agents/CI should match and branch—not brittle string matching.

### 4) Preserve stacks where they matter

- Bug paths must retain stacks.
- For failures, stacks are still useful for debugging, but user-facing surfaces should emphasize `why/fix/docs` and treat stacks as “trace/verbose”.

## Practical heuristics

- If a caller can **reasonably continue** or present an actionable fix → model as a **failure** and return/convert to `Result` at the boundary.
- If the system is **not in a valid state** or behavior is undefined → it’s a **bug**; throw and fail fast.
- If it comes from a **driver/network/DB** → it’s usually an **operational error**; throw through, translate at the boundary when helpful.


