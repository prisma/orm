# @internal/sql-orm-client

ORM client for Prisma 8 — fluent, type-safe model collections.

This package provides a high-level ORM client surface on top of the runtime. Ordinary and prepared SELECT reads with includes compile to a single correlated-subquery plan and use the supplied runtime without acquiring an additional connection scope. Caller-owned connections and transactions remain caller-owned; nested mutations orchestrate several statements inside one scope.

## Responsibilities

- Expose typed `Collection` primitives for model-level data access
- Build filter/order/include state from fluent APIs (`where`, `include`, `orderBy`, `limit`, `offset`)
- Accept lane-agnostic `WhereArg` filter inputs (`WhereExpr` or `ToWhereExpr`) and normalize bound payloads inside ORM while preserving bound params/descriptors for runtime encoding and adapter lowering
- Compile collection state into SQL AST query plans (`SqlQueryPlan`) without rendering SQL in ORM
- Buffer SELECT include results and decode embedded include payloads in the ORM consumer
- Orchestrate multi-statement mutations, such as nested creates
- Map storage-column rows back to model-field row shapes
- Expose an `orm()` client with typed collection keys (for example `db.Post`)

## Dependency Boundaries

This package depends on:

- `@internal/sql-contract` for contract shape and mappings
- `@internal/contract` for the contract shape and `PlanMeta`
- `@internal/framework-components` for `AsyncIterableResult`
- `@internal/sql-relational-core` for SQL AST, plan types, and the `RuntimeScope` interface

This package should not depend on target adapters or drivers directly; execution is delegated to the runtime queryable interface.

## Runtime surface

`RuntimeQueryable` is the SQL-domain wrapper this client uses to talk to a runtime. It extends `RuntimeScope` from `@internal/sql-relational-core` and adds the optional primitives the ORM needs for nested-mutation orchestration:

- `query<Row>(plan)` — streams rows; `execute(plan)` — returns statement stats. Both come from `RuntimeScope` and accept AST-level `SqlQueryPlan` and pre-lowered `SqlExecutionPlan`.
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

## Prepared row descriptions

Built-in collection chains expose terminal-only `.prepared.all(configure?)` and `.prepared.first(filter?, configure?)` views. They synchronously return a `Preparable<DbRow, Result>` without executing it: a description containing a SQL `plan` and a required `consume` function. The description is not itself a `SqlQueryPlan`. Filters, projection, includes, variants, first-row limit replacement and read annotations use the ordinary row pipeline.

`createPreparedRowQuery(description, statement)` is the composition seam for client integrations: prepare `description.plan` through SQL runtime, then wrap that SQL row statement with the description. SQL runtime remains plan-only; the ORM consumer owns model mapping and include decoding.

```ts
import { createPreparedRowQuery } from '@internal/sql-orm-client';

const description = posts.select('title').prepared.all();
const statement = await runtime.prepare({}, () => description.plan);
const prepared = createPreparedRowQuery(description, statement);
const rows = prepared.query(runtime, {});
for await (const row of rows) {
  console.log(row.title);
}
```

`query(target, params, options?)` requires an explicit compatible runtime, connection or transaction, independent of the authoring collection. It returns the terminal result directly: a thenable `AsyncIterableResult<Row>` for `all`, or `Promise<Row | null>` for `first`. Each call creates independent consumption state. Include paths retain their existing buffering; database value decoding and execution lifecycle remain SQL runtime responsibilities.

The [Postgres](../postgres/README.md#prepared-sql-and-orm-rows) and [SQLite](../sqlite/README.md#prepared-sql-and-orm-rows) facades compose this surface through `db.prepare({}, () => db.orm.public.Post.select('title').prepared.all())` (SQLite uses `db.orm.Post`). SQL callbacks capture `db.sql` and receive only params. Non-nullable scalar placeholders work in shorthand filters, callback comparisons, relation/include predicates, `prepared.first` filters and fixed lists such as `user.id.in([params.first, 42, params.second])`. Repeated placeholders retain their bind identity; each target keeps its stable slot layout across invocations. Comparisons retain codec identity, existing literal types and field trait requirements.

ORM equality and inequality accept nullable prepared parameters: two nulls compare equal, and null differs from every non-null value. Declaration nullability selects the null-safe operator when the ORM callback or shorthand comparison is created, so the SQL stays fixed across invocations. Ordering, pattern and list comparisons still reject nullable prepared operands with `ORM.FILTER_UNSUPPORTED`. A nullable column can still be compared to a non-nullable parameter; literal-null filters retain their existing null checks. Raw SQL remains opaque, including its interpolations: ORM does not parse, rewrite or reject raw SQL based on parameter nullability. Hand-authored structured ASTs and SQL-builder comparisons retain their explicit operators; ORM does not rewrite them.

Root and nested `.limit(params.take).offset(params.skip)` accept SQL's non-nullable numeric expression operands, including paginated row/scalar/combine include refinements and distinct wrappers. Prepared executions keep SQL and binding slots fixed while pagination values change. `prepared.first()` replaces an earlier limit with `1`; a placeholder used only by that replaced limit remains subject to unused-declaration validation.

Aggregate or mutation terminals, custom helper preparation and dynamic parameter lists are not supported.

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
for await (const post of db.Post.where(...).all()) {
  post.secret.length;
}
```

Read and write surfaces share **one** field type-map. `MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, and `ShorthandWhereFilter` accept plain `T` regardless of how the corresponding codec was authored.

See [ADR 204 — Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

## Related Docs

- [Architecture Overview](../../../docs/Architecture%20Overview.md)
- [ADR 164 - Repository Layer](../../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)
- [ADR 204 - Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)
- [Query Lanes Subsystem](../../../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- [Naming model and result types](../../../docs/reference/model-and-result-types.md)
