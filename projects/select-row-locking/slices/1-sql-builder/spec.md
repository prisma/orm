# Slice 1: typed SQL builder (TML-3402)

Parent: [../../spec.md](../../spec.md). Design: [../../design.md](../../design.md), sections "What you write: the typed SQL builder", "Why a method may be missing", "What the tree holds", "What the renderer prints", "What is refused, and where".

## At a glance

After this slice, this builds and renders on a Postgres contract:

```ts
db.sql.public.job
  .select('id')
  .where((f, fns) => fns.eq(f.state, 'queued'))
  .orderBy((f) => f.createdAt.asc())
  .limit(1)
  .forUpdate({ skipLocked: true })
  .build();
// SELECT "id" AS "id" FROM "public"."job" WHERE "state" = $1 ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
```

On a SQLite contract none of the four methods exists in the types, and a hand-built `SelectAst` carrying a lock is refused by the SQLite renderer.

## Chosen design

Exactly as the design document states. The parts this slice owns:

1. `LockingClause` (`strength`, `of`, `wait`) and `SelectAst.locking` in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`, carried through the constructor, `from()`, `noFrom()`, `toOptions()`, `rewrite()`, with `withLocking()`. The node carries no validity rule of its own.
2. Seven flags reported by the Postgres adapter (`adapter.ts`, `descriptor-meta.ts`) and documented in `docs/reference/capabilities.md`.
3. The Postgres renderer takes the adapter's capabilities as a required parameter, prints each clause after `OFFSET`, and throws `RUNTIME.AST_UNSUPPORTED` with `feature: 'locking-clause'` and the missing `capability` for a strength or option that set does not report. The SQLite renderer throws a structured error for any lock.
4. `SelectQuery` gains `forUpdate`, `forNoKeyUpdate`, `forShare`, `forKeyShare` as `GatedMethod`s on their flags, with `LockOptions` built from the flags; the runtime goes through `_gate` and appends to `BuilderState.locking`; `build()` refuses a lock with `distinct`, `distinctOn`, `having`, an aggregate or window function in the projection, or on a subquery (`ORM.LOCK_INCOMPATIBLE`, `meta.conflict`).
5. `STATUS.md` and `README.md` of the builder updated; a locking section in `docs/reference/query-patterns.md`; an integration test against PGlite.

## Coherence rationale

One reviewer can hold it: one new node, one renderer clause, four methods that share one option type and one state field. The ORM is a separate slice because its lowering has its own refusals and its own `OF` rule.

## Scope

In: the five parts above and the tests the design lists for slice 1. Out: the ORM client (TML-3415), `include` with a lock, locked subqueries, renderers for other targets, SQLSTATE `55P03` mapping.

## Pre-investigated edge cases

- `of` names must not be schema-qualified; Postgres refuses `OF "public"."contact"`.
- The renderer's capability check is what protects a hand-built tree; the builder's `_gate` only protects builder output.
- `GroupedQuery` must not gain the methods; that is already the type `groupBy()` returns.

## Done conditions

- The tests listed under "Delivery > Tests > Slice 1" in the design exist and pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm test:packages` and `test/integration/test/sql-builder/lock.test.ts` pass.
- The row-locking line in `STATUS.md` has moved to what is supported.
