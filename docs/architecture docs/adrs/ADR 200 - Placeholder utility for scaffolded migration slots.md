# ADR 200 — `placeholder(slot)` for unfilled scaffolded migration slots

> **Update — 2026-10:** a placeholder is no longer limited to data transforms. `--convert` puts one in the conversion slot of a type change. See § Where slots are placed and rendered.

## At a glance

When `migration plan` detects a data transform, the scaffolder writes a `migration.ts` file. Most of the file is auto-derived, but two slots — `check.source` and `run` — require hand-authored queries that only the migration author knows. The scaffolder emits them like this:

```ts
import { dataTransform, placeholder } from '@internal/target-mongo/migration'

dataTransform('backfill-product-status', {
  check: {
    source: () => placeholder('backfill-product-status:check.source'),
    expect: 'notExists',
  },
  run: () => placeholder('backfill-product-status:run'),
})
```

If the author runs `migration emit` without replacing those calls, each `placeholder` throws a structured `PN-MIG-2001` error naming the exact slot:

```text
PN-MIG-2001  Unfilled migration placeholder
  The migration contains a placeholder that has not been filled in: backfill-product-status:check.source
  Fix: Open migration.ts and replace the `placeholder(...)` call with your actual query.
```

No silent nonsense, no generic stack trace — a precise diagnostic that flows through the CLI's existing error envelope.

## Decision

We use a `placeholder(slot: string): never` function that always throws a `CliStructuredError` with code `2001`, domain `MIG`, and `meta: { slot }`. It lives in `@internal/errors/migration` and is re-exported from each target's migration entrypoint (e.g. `@internal/target-mongo/migration`).

```ts
export function placeholder(slot: string): never {
  throw errorUnfilledPlaceholder(slot);
}
```

The slot string names what the author must write. A slot the planner places for a statement is named by the field as a statement names it, then the slot: `User.age:convert` for a `--convert` conversion, and `User.name:check` and `User.name:run` for a `--backfill` step. The part after the colon names the statement and what the author writes, not a database's syntax, so a conversion slot is `:convert` both in a Postgres `using` and in a SQLite copy expression. A slot in a hand-written or older scaffold follows `{migrationName}:{slot}`, for example `backfill-product-status:check.source`. Either way the error message is self-locating: the author knows which field or migration, and which slot, to edit.

### Why `never`

The return type `never` is assignable to every type in TypeScript. A scaffolded `() => placeholder('...')` satisfies any `() => T` signature — `() => MongoQueryPlan`, `() => AggregationPipeline`, whatever the slot expects — without the slot's type needing to include a sentinel union arm. No `| TodoMarker` leaking into public API signatures. The scaffold compiles cleanly, the user's editor is happy, and `tsc` passes.

### Where slots are placed and rendered

The planner decides where a slot goes; the scaffolder (each target's `renderTypeScript` implementation) renders it as a `placeholder(...)` call. Because `placeholder()` is typed `never`, it can stand in any slot of any operation the scaffolder renders. A `dataTransform` carries its `check` and `run` slots; when the user passes `--convert`, the Postgres `alterColumnType` call carries its `using` conversion and the SQLite `recreateTable` call the copied column's expression. Filling a slot is not trusted blindly: Postgres refuses a converted value its new type cannot hold, and the SQLite rebuild checks after its copy that every value took the new type, so a wrong or deleted conversion fails the apply naming the field. Every other planned operation is fully specified by the differ.

### Error integration

`PN-MIG-2001` is the first code in the `MIG-2xxx` range (see [ADR 027 — Error Envelope Stable Codes](ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)). The error is a `CliStructuredError` with `domain: 'MIG'`, so it flows through the CLI's structured error formatting identically to any other migration error. Because emit runs in-process, the CLI catches it directly by code.

This is what makes the scaffold-then-emit handoff safe: without a structured throw on unfilled slots, the CLI would need a separate "is this migration ready?" check. With `placeholder`, evaluating the scaffolded file with unfilled slots fails cleanly through the normal error path.

## What this replaces

> **Status:** Planned/target-state. The sentinel→`placeholder()` switch described here is design intent for the upcoming class-flow rollout. The runtime data-transform paths in `@internal/target-mongo/migration` still ship the `TodoMarker` sentinel today; the snippets below show the target API and the deletion catalog the implementation PR will execute against.

The prior design used a sentinel symbol:

```ts
export const TODO = Symbol.for('prisma-next.migration.todo');
export type TodoMarker = typeof TODO;
```

This had several problems:

- **Leaked into type signatures.** `dataTransform`'s `source` parameter was typed `() => MongoQueryPlan | Buildable | TodoMarker`, forcing hand-authored migrations to reason about an unreachable case.
- **Generic error.** Detection was an ad-hoc `typeof result === 'symbol'` check that threw a plain `new Error(...)` — no error code, no structured envelope, no slot identification.
- **Terrible API name.** `import { TODO } from '...'` collides with the `// TODO:` comment convention and reads like debug code that shipped.

The `placeholder` design eliminates all three: `never` keeps types clean, the throw produces a structured diagnostic, and the name communicates intent.

## Alternatives considered

### Sentinel value with runtime detection

Keep a marker value (symbol, string, or branded object) that slots return, with a detection pass before emit. This requires every consumer of the slot's return type to handle the sentinel case — either in types (`| TodoMarker`) or in runtime checks. `placeholder` avoids this entirely: the throw happens at the call site, and the value never propagates.

### Compile-time enforcement (type hole)

Leave the slots unassigned (e.g. `source: undefined as any`) and rely on `tsc` to flag the type mismatch. This breaks the "scaffold compiles cleanly" invariant — the user's editor lights up with errors on first open, before they've had a chance to read the file. Worse, `as any` silences the error entirely. `placeholder` preserves a clean compile while guaranteeing a loud runtime failure.

### Enumerate all unfilled slots in one pass

Instead of failing on the first unfilled slot, walk the scaffolded file and report all of them. This is additive — a future `migration verify` or lint rule could grep for `placeholder(` calls. The current design fails fast, which is the right default for `migration emit`.
