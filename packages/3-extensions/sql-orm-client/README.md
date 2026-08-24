# @internal/sql-orm-client

ORM client for Prisma Next — fluent, type-safe model collections.

This package provides a high-level ORM client surface on top of the runtime that can orchestrate multiple single-statement plans for a single logical operation (for example, parent query + includes).

## Responsibilities

- Expose typed `Collection` primitives for model-level data access
- Build filter/order/include state from fluent APIs (`where`, `include`, `orderBy`, `limit`, `offset`)
- Accept lane-agnostic `WhereArg` filter inputs (`WhereExpr` or `ToWhereExpr`) and normalize bound payloads inside ORM while preserving bound params/descriptors for runtime encoding and adapter lowering
- Compile collection state into SQL AST query plans (`SqlQueryPlan`) without rendering SQL in ORM
- Execute and stitch include trees across multiple plan executions
- Map storage-column rows back to model-field row shapes
- Expose an `orm()` client with typed collection keys (for example `db.Post`)

## Dependency Boundaries

This package depends on:

- `@internal/sql-contract` for contract shape and mappings
- `@internal/contract` for `ExecutionPlan` metadata
- `@internal/framework-components` for `AsyncIterableResult` and the canonical `RuntimeExecutor<TPlan>` interface (imported from `@internal/framework-components/runtime`)
- `@internal/sql-relational-core` for SQL AST and plan types

This package should not depend on target adapters or drivers directly; execution is delegated to the runtime queryable interface.

## Runtime surface

`RuntimeQueryable` is the SQL-domain wrapper this client uses to talk to a runtime. It extends the canonical `RuntimeExecutor<SqlExecutionPlan | SqlQueryPlan>` execute surface (one structural source of truth for the `execute<Row>(plan)` shape across families) and adds the optional SQL-domain primitives the ORM needs for nested-mutation orchestration:

- `execute<Row>(plan)` — borrowed from `RuntimeExecutor` via `Pick`, accepts both AST-level `SqlQueryPlan` and pre-lowered `SqlExecutionPlan`.
- `connection?()` — opt-in connection acquisition for grouped multi-statement work.
- `transaction?()` — opt-in transaction acquisition for atomic mutation scopes.

The optional methods are SQL-specific orchestration capabilities and are intentionally absent from the cross-family `RuntimeExecutor` contract. Runtimes that don't expose them are still valid `RuntimeQueryable`s and are used for single-statement execution.

## Architecture

```mermaid
flowchart LR
  A[Collection API] --> B[CollectionState]
  B --> C[ORM Query Planner]
  C --> D[SqlQueryPlan (AST + params + meta)]
  D --> E[RuntimeQueryable.execute]
  E --> F[Rows by storage column]
  F --> G[Row mapping + include stitching]
  G --> H[Model-field result rows]
```

## Basic Usage

```ts
const db = orm({ contract, runtime });

const posts = await db.Post
  .where((post) => post.userId.eq(userId))
  .limit(10)
  .all();
```

## Pagination

`.orderBy(...)` accepts model-accessor callbacks that return `OrderByItem`s via the column's `.asc()` / `.desc()` helpers:

```ts
// Newest first.
const posts = await db.Post
  .orderBy((post) => post.createdAt.desc())
  .limit(10)
  .all();
```

## Codec Roundtrip

The runtime always awaits codec query-time methods, but rows yielded to user code carry **plain field values** — no `Promise`-typed fields ever reach `.first()` / `.all()` / streaming consumers, regardless of whether a column's codec is sync or async. This is true for both one-shot and streaming usage:

```ts
// Even if `secretCodec.decode` is async, `posts[0].secret` is a plain string here.
const posts = await db.Post.where((p) => p.userId.eq(userId)).all();
posts[0].secret.length;

// Same for streaming via AsyncIterableResult.
for await (const post of db.Post.where(...).stream()) {
  post.secret.length;
}
```

Read and write surfaces share **one** field type-map. `MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`, and `DefaultModelInputRow` accept plain `T` regardless of how the corresponding codec was authored.

See [ADR 204 — Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

## Related Docs

- [Architecture Overview](../../../docs/Architecture%20Overview.md)
- [ADR 164 - Repository Layer](../../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)
- [ADR 204 - Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)
- [Query Lanes Subsystem](../../../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
