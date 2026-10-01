# ADR 255 — Relation ordering lowers to correlated subqueries

**Status:** Accepted
**Date:** 2026-09-24
**Builds on:** [ADR 121 — Contract.d.ts structure and relation typing](ADR%20121%20-%20Contract.d.ts%20structure%20and%20relation%20typing.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

This ADR covers the SQL ORM only; the Mongo ORM's `orderBy` has a different shape. Inside a SQL ORM `orderBy`, a to-one relation exposes the related model's orderable fields and a to-many relation exposes `count(predicate?)`:

```ts
collection.orderBy([(post) => post.author.name.asc(), (post) => post.id.asc()]);
collection.orderBy((user) => user.posts.count((post) => post.views.gt(10)).desc());
collection.orderBy((user) => user.tags.count().asc());
collection.orderBy((user) => user.invitedBy.name.desc({ nulls: 'last' }));
```

Each relation order is a correlated scalar subquery in the `ORDER BY`. On Postgres the four calls render as:

```sql
SELECT "posts"."id" AS "id" FROM "public"."posts" ORDER BY (SELECT "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = "posts"."user_id") ASC, "posts"."id" ASC

SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND "posts"."views" > $1)) DESC

SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."tags" INNER JOIN "public"."user_tags" ON "user_tags"."tag_id" = "tags"."id" WHERE "user_tags"."user_id" = "users"."id") ASC

SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT "__orm_rel_1"."name" AS "name" FROM "public"."users" AS "__orm_rel_1" WHERE "__orm_rel_1"."id" = "users"."invited_by_id") DESC NULLS LAST
```

## Decision

**Relation orders are subqueries built from the relation's join metadata.** A to-one field order projects the related column; a count order projects `count(*)`. Both correlate to the outer row with the same join predicate `some` / `every` / `none` build for their `EXISTS` subqueries, including the junction join for an `N:M` relation and the inner-table alias for a self-relation. A count predicate is bound exactly as a `some` predicate is. The ORM chooses between the two shapes from the relation's contract cardinality (`1:1` / `N:1` versus `1:N` / `N:M`), never from the target. A to-many relation offers no fields because a field of many rows needs a reducer to become one value; a to-one relation offers no `count` because its count is 0 or 1, which `some()` already expresses.

**The count is the plain aggregate.** The subquery projects `count(*)` even where the target's aggregate registry declares a lowering for projected counts (SQLite renders projected counts as text). `ORDER BY` compares the value inside the database, where a text rendering would sort `'10'` before `'9'`. A plain `COUNT(*)` always orders numerically, so every to-many relation offers `count`.

**Null placement is AST data.** `OrderByItem` carries `nulls: 'first' | 'last' | undefined`. Each SQL adapter renders `NULLS FIRST` / `NULLS LAST` after the direction in query, window and aggregate `ORDER BY`. `reverse()` flips `nulls` along with the direction. An item without `nulls` renders no null-placement suffix, so the database default applies. `OrderByItem` refuses any other direction or placement at construction, and adapters render both from fixed tables, so no caller-supplied string reaches the SQL. An adapter for a dialect without native `NULLS FIRST` / `NULLS LAST` must emulate the placement, for example with a leading `expr IS NULL` key, and must not drop it. `withExpr(expr)` rebuilds an item around a new expression with the same direction and placement.

**Cursor and DISTINCT ON refuse orders they cannot key on.** A keyset needs a cursor value for every order axis, and a cursor value exists only for a plain column. `cursor()` therefore throws `ORM.ARGUMENT_INVALID`, naming the `orderBy` position, for any active order that is not a column of the model (a relation field, a count, an extension-operation result) or that sets `nulls` (a null-aware comparison is not built). The keyset builder makes the same check when the query is planned, so an order added after `cursor()` is refused too. Postgres requires the leading `ORDER BY` items to match the `DISTINCT ON` expressions, so `distinctOn()` and every plan builder that applies `DISTINCT ON` refuse an expression order among the first N items, where N is the number of `distinctOn` columns. Later items only choose which row represents each group and may be any expression. The checks are `assertCursorCompatibleOrder` and `assertDistinctOnCompatibleOrder`.

## Why

The relation filters build correlated subqueries from the contract's relation metadata. Ordering by a relation needs the same correlation, projected as a value instead of tested for existence, so it reuses that construction (`correlateRelatedRows`) rather than adding another way to reach related rows.

An included relation's `count()` (`include('posts', (p) => p.count())`) is the nearest existing concept. It projects a count for the application, so it goes through the target's aggregate lowering and takes its predicate by refining the include with `where`. A count order compares inside the database, so it uses the plain aggregate, and it takes its predicate as an argument because an order has no refinement chain to attach one to.

## Consequences

- The main query gains no join. Its rows never multiply, so `limit`, `offset` and includes behave exactly as for a column order.
- Where a plan wraps the base table in a derived table that exposes only a projection (the `distinct()` wrap under `aggregate()` and `groupBy().aggregate()`, and the include dedup wraps), each expression order is projected inside the wrap as a hidden `__order_N` column and the outer order reads that column.
- The subquery runs per outer row inside the database. The client issues one statement.
- Inside an include, a relation order goes through the same table remapper as a child filter: outer references move to the child alias, and the inner table keeps its own name or alias.
- Keyset pagination over a relation order, a count, an extension-operation result such as a vector distance, or a `nulls` order is not supported; `cursor()` throws for each. Supporting it needs cursor values for computed expressions and null-aware comparisons.

## Alternatives considered

**LEFT JOIN the related table into the main query.** For a to-many relation the join multiplies rows, so a count needs `GROUP BY` over every selected column, and `limit`, `offset` and `DISTINCT` then apply to the grouped rows. A to-one join cannot multiply rows; there the case for the subquery is one lowering for both cardinalities and no alias management in the main query, at the cost of evaluating the subquery once per outer row.

**Skip non-column orders when building the keyset.** The keyset then ignores an ordered axis, so the next page starts at the wrong row. Rejected in favour of refusing the cursor.

**Sort in memory after fetching.** This breaks `limit` and `offset`, which must apply after ordering, and loads every row. Rejected.
