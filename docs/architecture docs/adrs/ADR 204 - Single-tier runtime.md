# ADR 204 — Single-tier runtime: collapse `runtime-executor` into `framework-components`

> **Update — the hooks are removed.** The middleware hooks `beforeExecute` and `afterExecute` this ADR describes no longer exist. [ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md) replaced them with lifecycle events and interceptors on a tree of activities.

## Status

Accepted.

## Supersedes

- [ADR 140 — Package Layering & Target-Family Namespacing](ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md), specifically the "Runtime Separation" section that introduced the two-tier runtime model. The rest of ADR 140's package-layering, plane-boundary, and naming guidance is unchanged.

## Decision

Every family runtime is a single class that **extends** an abstract `RuntimeCore` base, lives in its family package, and is the only runtime tier. The `RuntimeCore` base class, the `runWithMiddleware` orchestrator helper, and the runtime SPI types (`RuntimeExecutor`, `RuntimeMiddleware`, `RuntimeMiddlewareContext`, `AfterExecuteResult`, `QueryPlan`, `ExecutionPlan`) live in [`@internal/framework-components`](../../../packages/1-framework/1-core/framework-components/) at the framework's **core layer**, exported via the `runtime` subpath.

`RuntimeCore` belongs in the framework layer because what it owns is **behavior**, not plan shape: *when* hooks fire, *how* middleware wraps a driver loop, *which* lifecycle steps a family must implement. It never inspects the contents of a `QueryPlan` or `ExecutionPlan` — those are generic parameters each family narrows to its own concrete types. That's how a target-agnostic core layer can host a runtime base that SQL and Mongo both extend without either family's vocabulary leaking into the framework.

The previous target-agnostic `@internal/runtime-executor` package and the `packages/1-framework/4-runtime/` directory are removed.

## What this looks like

A family runtime, end-to-end, is now this shape:

```ts
import {
  RuntimeCore,
  runWithMiddleware,
} from '@internal/framework-components/runtime';

class SqlRuntime
  extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>
  implements Runtime
{
  constructor(options: RuntimeOptions) {
    // build middleware list + ctx, then call super with them
    super({ middleware, ctx });
    // family-specific fields (driver, adapter, codecs, …)
  }

  protected override async runBeforeCompile(plan: SqlQueryPlan): Promise<SqlQueryPlan> {
    // SQL: run the beforeCompile chain over the plan's AST
  }

  protected override lower(plan: SqlQueryPlan): SqlExecutionPlan {
    // SQL: lowerSqlPlan(adapter, contract, plan) + encode params
  }

  protected override runDriver(exec: SqlExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.driver.execute({ sql: exec.sql, params: exec.params });
  }

  override async close(): Promise<void> {
    await this.driver.close();
  }
}
```

The public `execute(plan)` method is **inherited** from `RuntimeCore`. Its body is a fixed lifecycle template:

```text
execute(plan)
  ├─ runBeforeCompile(plan)        ← family hook (SQL overrides; Mongo uses identity)
  ├─ lower(plan)                   ← family hook (always overridden)
  └─ runWithMiddleware(exec, …, () => runDriver(exec))
       ├─ for each middleware: beforeExecute(exec, ctx)
       ├─ for await (row of runDriver()) {
       │     for each middleware: onRow(row, exec, ctx)
       │     yield row
       │   }
       └─ for each middleware: afterExecute(exec, summary, ctx)
```

`MongoRuntimeImpl` is the same shape with two methods overridden (`lower`, `runDriver`) plus `close`. It does not override `runBeforeCompile`; the base provides an identity default.

Adding a new family runtime — Cassandra, Document, anything else — is one constructor and at most three method overrides. No new package, no wrapping, no lifecycle reimplementation.

## Background — the world this replaces

ADR 140 set up a **two-tier** runtime: a target-agnostic kernel (`@internal/runtime-executor`) owned the SPI and middleware lifecycle, and family runtimes implemented that SPI by **composing** an inner `runtime-executor` instance with their own lowering and driver code.

In practice the two tiers carried very little independent value:

- The inner kernel was always wrapped 1-to-1 by exactly one family runtime. There were no consumers of the SPI other than `*Runtime` classes that delegated to it.
- Each family runtime forwarded every public method (`execute`, `close`, `connection`, `transaction`) to its inner instance. Two places to land a lifecycle bug; two places to keep in sync.
- The middleware orchestration loop existed twice — once in `runtime-executor` for the cross-family path, once in each family for SQL's `beforeCompile` chain. Drift between them was a recurring review concern.
- Plumbing a generic middleware to observe both SQL and Mongo required threading the same context shape through both tiers in each family.

The cross-family runtime unification project introduced three primitives — `QueryPlan` / `ExecutionPlan` markers, the abstract `RuntimeCore<TPlan, TExec, TMiddleware>` class, and the `runWithMiddleware` helper — that, together, leave the inner kernel with no responsibilities the abstract base cannot own. At that point the composition tier becomes pure forwarding and is worth removing.

## Rationale

The change collapses three duplicated concerns into one site each:

- **One lifecycle template.** `RuntimeCore.execute` is the only place in the codebase that defines `runBeforeCompile → lower → runWithMiddleware(beforeExecute → driver loop → onRow → afterExecute)`. Family runtimes pick which steps to override; they cannot accidentally diverge from the framework lifecycle.
- **One middleware orchestrator.** `runWithMiddleware` is the only place that iterates middleware around a driver loop. Subtle semantics — registration order, error-path swallowing of `afterExecute` throws so telemetry middleware still observes `completed: false` — live in one file, with one set of tests.
- **One SPI surface.** `RuntimeExecutor`, `RuntimeMiddleware`, `RuntimeMiddlewareContext`, and the `QueryPlan` / `ExecutionPlan` markers live alongside the other framework primitives that family runtimes already import (`Contract`, `ExecutionContext`, `AsyncIterableResult`). Per [ADR 185](ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md), the SPI is at the lowest layer that consumes it.

A useful corollary of the abstract-base shape: any middleware typed against the framework SPI is observable from any family runtime by construction. Cross-family middleware no longer relies on convention — the type system enforces it.

## Affected packages

| Package | Before | After |
|---------|--------|-------|
| `@internal/runtime-executor` (framework, runtime layer) | Owned the runtime SPI + plugin lifecycle. | **Deleted.** Contents folded into `@internal/framework-components`. |
| `@internal/framework-components` (framework, core layer) | Component descriptors; control / execution / emission types. | Adds a `runtime` subpath export with the SPI, abstract `RuntimeCore`, and `runWithMiddleware`. |
| `@internal/sql-runtime` (SQL, runtime layer) | Composed an inner `runtime-executor`. | `SqlRuntime extends RuntimeCore` directly. |
| `@internal/mongo-runtime` (Mongo, runtime layer) | Composed an inner `runtime-executor`. | `MongoRuntimeImpl extends RuntimeCore` directly. |

The dependency-direction enforcement chain in `architecture.config.json` collapses from

```text
core → authoring → tooling → lanes → runtime-executor → family-runtime → adapters
```

to

```text
core → authoring → tooling → lanes → runtime → adapters
```

Family runtimes import the SPI from the core layer of the framework domain — the same way they already import other cross-family abstractions.

## Trade-offs

- **The runtime SPI is no longer in a layer named `runtime`.** Readers used to ADR 140's two-tier model may look for it there first. The durable architecture docs ([Package-Layering](../Package-Layering.md), [subsystem doc 4](../subsystems/4.%20Runtime%20%26%20Middleware%20Framework.md)) now point at the core layer, but anyone with the old map will need to reorient.
- **Composition gives way to subclassing.** Wrapping pre-/post-execution behavior was easy with the old composed-kernel pattern (instantiate the kernel, hold it as a field, intercept at the boundary). Now a family must subclass `RuntimeCore` to do equivalent work. The lifecycle template is enforced in exchange — but the cost is real for families that wanted maximal flexibility at the wrapper boundary.

## Alternatives considered

### Keep `runtime-executor` as a thin facade over `RuntimeCore`

Reduce `@internal/runtime-executor` to a re-export of `RuntimeCore`, `runWithMiddleware`, and the SPI types from `@internal/framework-components`. Preserves the "runtime SPI lives in a runtime-named package" mental model.

Rejected: an extra package, an extra tsconfig project, and an extra import path with no boundary behind it. With every consumer already crossing into `framework-components` for adjacent SPIs, the facade adds no clarity and one more thing to maintain.

### Keep two-tier composition but unify the orchestrator

Leave the composition tier in place; require both tiers to delegate middleware orchestration to a shared `runWithMiddleware` helper.

Rejected: addresses the orchestrator-drift concern but leaves the wrap-and-forward layer and the cognitive cost of two runtime packages. Family runtimes still own their own `execute` method, so the lifecycle template is still reimplemented per family.

### Move the runtime SPI to its own core-layer package

Introduce `@internal/runtime-spi` at the core layer, separate from `framework-components`.

Rejected: keeps the SPI isolated but creates yet another core-layer package with a thin surface. The SPI naturally co-locates with the other framework primitives (`Contract`, `ExecutionContext`, `AsyncIterableResult`) family runtimes already import. Splitting it adds a package without adding a boundary anyone needs.
