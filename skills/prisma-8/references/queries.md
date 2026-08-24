
# Prisma Next — Queries

> **Edit your data contract. Prisma handles the rest.**

Once the contract is emitted and the DB is up to date, this skill covers everything you do *with* the data: reading, writing, eager-loading relations, aggregating, and the choice between the ORM and the lower-level query lane.

## When to Use

- User wants to read, write, update, or delete data.
- User wants to include / eager-load relations.
- User wants to paginate, sort, filter, project.
- User wants to wrap operations in a transaction (`db.transaction(...)` — Postgres and SQLite).
- User wants to aggregate (`count`, `sum`, `avg`, …).
- User asks about query lanes (ORM vs SQL builder / query builder).
- User mentions: *query, select, where, orderBy, limit, offset, take, skip, include, eager load, first, all, count, aggregate, create, update, delete, upsert, returning, drizzle-style, kysely-style, prisma client*.

## When Not to Use

- User wants to add / change a model → `references/contract.md`.
- User wants to wire `db.ts` or add middleware → `references/runtime.md`.
- User is querying through a Supabase role-bound db (`asUser` / `asAnon` / `asServiceRole`, RLS, `auth.*` admin reads) → `references/supabase.md` for the role-binding surface; everything in this skill then applies to the returned `RoleBoundDb`.
- User wants to debug a query failure (structured error envelope) → `references/debug.md`.

## Pick your target

Prisma Next ships **two query lanes per target** on the same `db` value from `src/prisma/db.ts`. **Before writing queries, read `db.ts` and load the matching target guide:**

| Runtime import in `db.ts` | Load |
| --- | --- |
| `@internal/postgres/runtime` | [`queries-postgres.md`](./queries-postgres.md) — `db.orm.<Model>` + `db.sql.<table>` |
| `@internal/mongo/runtime` | [`queries-mongo.md`](./queries-mongo.md) — `db.orm.<root>` + `db.query.from(...)` |
| `@internal/extension-supabase/runtime` | [`queries-postgres.md`](./queries-postgres.md) — a Supabase `RoleBoundDb` is a Postgres surface (`db.orm.<Model>` + `db.sql.<table>`); bind a role first via `references/supabase.md` |

Both targets share the contract and connection on one `db` value. Reach for the ORM first; drop to the lower-level lane when the ORM can't express the shape. Lane choice is local — one query function picks one lane, not the whole app.

**Do not mix target examples.** Postgres uses PascalCase model roots (`db.orm.User`) and `db.sql.user`; Mongo uses lowercased plural roots (`db.orm.users`) and `db.query.from('users')`. There is no `db.sql` on Mongo and no `db.query` SQL-builder equivalent on Postgres.

## Namespace-aware accessors

When a contract declares more than one namespace (e.g. `public` and `auth`), models and tables are addressed by namespace coordinate:

- **ORM**: `db.orm.<namespace>.<Model>` — e.g. `db.orm.public.User`, `db.orm.auth.User`
- **SQL builder**: `db.sql.<namespace>.<table>` — e.g. `db.sql.public.users`, `db.sql.auth.users`

The flat `db.orm.User` / `db.sql.users` form still works for single-namespace contracts (or when all table names are unique across namespaces). When the same bare name appears in more than one namespace, you must use the namespace coordinate.

See [`queries-postgres.md` § Namespace-aware accessors](./queries-postgres.md#namespace-aware-accessors) for a worked example.

## Consuming the result: `await`, `.toArray()`, or `for await`

Critical to get right early — on **both Postgres and Mongo**, `.all()` returns an **`AsyncIterableResult<Row>`**, which is *both* a `PromiseLike<Row[]>` and an `AsyncIterable<Row>`. That means three consumption forms all work, and the canonical one is the shortest:

```typescript
const users = await db.orm.User.select('id', 'email').all();
//    ^? Row[]   ← the Thenable resolves to a real array. This is the default idiom.
```

You do **not** need a `collect()` / `toArray()` helper — `await` is enough. Internally `await` invokes the result's `then(...)`, which buffers the rows into an array. Two equivalent alternatives exist for the cases where they read better:

```typescript
// `.toArray()` returns a genuine `Promise<Row[]>`. Reach for it only when
// something needs a real `Promise` and not merely a thenable: a slot typed
// `Promise<Row[]>` (an `AsyncIterableResult` has only `then`, not `catch` /
// `finally`, so it does not satisfy that annotation), or a runtime
// `instanceof Promise` check. Note that `await` and the `Promise.all` /
// `Promise.race` combinators all accept the thenable directly — those are
// NOT reasons to call `.toArray()`. Whenever you are just going to await it
// here, use `await ...all()` and skip `.toArray()`.
const rows: Promise<User[]> = db.orm.User.select('id', 'email').all().toArray();

// Streaming — process rows one at a time without buffering the whole result.
// Use for genuinely large result sets (anything that wouldn't fit comfortably
// in memory) or pipelines where you can start work before all rows arrive.
for await (const user of db.orm.User.select('id', 'email').all()) {
  process(user);
}
```

Two single-row shortcuts also exist on the result, in addition to the collection-level `.first()` (which issues `LIMIT 1` on Postgres):

```typescript
const user = await db.orm.User.where({ id }).all().first();
//    ^? Row | null   ← buffers, returns the first row or null. Issues no LIMIT.
const required = await db.orm.User.where({ id }).all().firstOrThrow();
//    ^? Row          ← buffers; throws `RUNTIME.NO_ROWS` if empty.
```

For genuine single-row reads, prefer the *collection*-level `.first()` (which adds `LIMIT 1` to the SQL on Postgres) over `.all().first()` (which fetches all rows and discards the rest). The result-level helpers are for cases where you already need the full result and want the first row without an extra round-trip.

**The result is single-consumption.** Each `AsyncIterableResult` instance can be consumed once — by `await`, by `.toArray()`, or by `for await`. Trying to consume it a second time throws **`RUNTIME.ITERATOR_CONSUMED`**. The fix is almost always to store the array in a variable on first consumption and reuse the variable:

```typescript
// Bad — second await throws RUNTIME.ITERATOR_CONSUMED.
const result = db.orm.User.select('id', 'email').all();
const a = await result;
const b = await result;

// Good — buffer once, reuse the array.
const users = await db.orm.User.select('id', 'email').all();
const a = users;
const b = users;
```

If you've seen `collect(...)` / `toArray(...)` helpers in a codebase wrapping `.all()`, they're vestigial — `await` does the same thing for free. Remove them when you touch the surrounding code.

## Running queries from a short script

When the user is running a one-off `tsx my-script.ts` (not a long-lived server), call `await db.close()` at the end so the process exits cleanly — on Postgres the façade-owned pool keeps Node's event loop alive; on Mongo the façade-owned `MongoClient` does the same. See `references/runtime.md` § *Running as a script (teardown)* for the full pattern including `await using`.

```typescript
// src/scripts/seed.ts
import { db } from '../prisma/db';

// Postgres — PascalCase model root from contract
for (const u of users) {
  await db.orm.User.create(u);
}

// Mongo — lowercased plural root from contract (e.g. users, not User)
// for (const u of users) {
//   await db.orm.users.create(u);
// }

console.log('Seeded.');
await db.close();
```

## Common Pitfalls (cross-target)

1. **Using Postgres examples on a Mongo project (or vice versa).** Check `db.ts` and load the correct target guide ([`queries-postgres.md`](./queries-postgres.md) or [`queries-mongo.md`](./queries-mongo.md)).
2. **Writing a `collect()` / `toArray()` helper to convert `.all()` to an array.** `.all()` returns an `AsyncIterableResult<Row>` which *is* a `PromiseLike<Row[]>` — `await collection.all()` directly yields `Row[]`. See *Consuming the result* above.
3. **Consuming an `AsyncIterableResult` twice.** Each result is single-use. The second consumer throws `RUNTIME.ITERATOR_CONSUMED`. Buffer once into a variable and reuse the variable.

Target-specific pitfalls live in the per-target guides.

## What Prisma Next doesn't do yet

- **N:M `.include()` across a junction table.** The contract IR supports many-to-many relations with a `through` junction table, and `N:M` relations appear as valid relation names on the ORM collection. However, `.include()` on an N:M relation does not emit the two-step junction join — the query plan builder only handles the direct join columns (`localColumn` / `targetColumn`) and ignores the `through` metadata. Attempting it either produces wrong results or an error. Workaround: express the N:M traversal through `db.sql.<table>` with an explicit join on the junction table.
- **N:M nested mutations.** `mutation-executor.ts` explicitly throws `'N:M nested mutations are not supported yet'` for nested creates/links through an N:M relation.
- **`and` / `or` / `not` combinators in the postgres façade.** The combinators currently import from `@internal/sql-orm-client` (an internal package). Workaround today: import them from `@internal/sql-orm-client` directly, the way the example apps do. If you want them on `@internal/postgres/runtime`, file a feature request via `references/feedback.md`.
- **Ordering grouped aggregates by an aggregate alias (Postgres).** `db.orm.<Model>.groupBy(...)` supports `.orderBy(...)` on group keys plus `.limit(...)` / `.offset(...)`, but the grouped collection cannot order by an aggregate alias such as `SUM(amount)`. A "top-N groups by SUM" query therefore falls back to JS-side sort + slice over the full grouped result, which is fine at small cardinalities and bad at scale. Workarounds: (a) drop to `db.sql.<table>` and write the `GROUP BY` + `ORDER BY` + `LIMIT` against the aggregated table directly; (b) live with the JS-side sort/slice if the grouped cardinality is bounded. File a feature request via `references/feedback.md` if this is hitting you in production.
- **A raw-SQL lane.** This one exists. Write whole-query raw SQL through the client's raw lane: ``db.raw.sql`SELECT ...`.returnsRow({ ... }).build()`` for rows, or `.affectedCount()` for a mutation's row count. Each declared column names the codec that decodes it, so the row stays typed. For an expression fragment inside a builder query, use `fns.raw` in a `.select(...)` callback instead.
- **TypedSQL (`.sql` files compiled into typed callables).** Not implemented. Workaround: stick to the SQL builder; for repeated queries, extract a function that returns the built plan and call `db.runtime().execute(plan)` at the call site. If you want a `.sql`-file compile path, file a feature request via `references/feedback.md`.
- **`EXPLAIN` / query-plan inspection.** Prisma Next does not expose an `.explain()` method. Workaround: connect a `pg.Pool` you control via the runtime's `pg:` binding (see `references/runtime.md`) and issue `EXPLAIN ANALYZE` through it. If you want a first-class plan-inspection surface, file a feature request via `references/feedback.md`.
- **Streaming large result sets.** No `.stream()` cursor today. Workaround: paginate via `.offset(n).limit(m)` for moderate sizes; for very large sets, hold a `pg.Client` from the runtime's `pg:` binding and stream through it directly. If you want a built-in streaming surface, file a feature request via `references/feedback.md`.
- **Multi-statement batching (Prisma-7-style `db.$transaction([call1, call2])`).** Prisma Next runs each call sequentially. Workaround: wrap atomically-related work in `db.transaction(async (tx) => { ... })` on Postgres. If you want batch-as-array semantics, file a feature request via `references/feedback.md`.
- **Mongo façade transactions.** `@internal/mongo/runtime` does not expose `db.transaction(...)`. Multi-document atomicity is not yet wrapped in the Prisma Next Mongo façade. Workaround: use the MongoDB driver's session API directly if you control the client binding (`mongoClient:` option). File a feature request via `references/feedback.md` if you need a first-class façade surface.
- **Mongo ORM aggregates.** No `.aggregate(...)` / `.groupBy(...)` on `db.orm.<root>`. Workaround: express aggregations through `db.query.from(...).group(...).build()` and `runtime.execute(plan)`.
- **Mongo filter helpers on the façade.** Rich filters (`.in`, ranges, boolean composition) currently import from `@internal/mongo-query-ast/execution` (`MongoFieldFilter`, etc.) — not yet re-exported on `@internal/mongo/runtime`. Workaround: use object equality `.where({ field: value })` where possible; import from the internal package only when necessary. Tracked alongside façade-completeness gaps in Linear `TML-2526`.
- **Automatic N+1 detection.** Prisma Next does not warn when an `.include(...)` is missing. Workaround: be deliberate about `.include(...)` in code review; the `lints` middleware (see `references/runtime.md`) catches the more common authoring slips (missing `WHERE` on a `DELETE` / `UPDATE`, missing `LIMIT` on a `SELECT`).

## Reference Files

This skill is split for selective loading. Target-specific reference paths live in the per-target guides:

- **Postgres** — [`queries-postgres.md` § Reference Files](./queries-postgres.md#reference-files)
- **Mongo** — [`queries-mongo.md` § Reference Files](./queries-mongo.md#reference-files)

## Checklist

- [ ] Confirmed the active target from `db.ts` and loaded the matching guide ([`queries-postgres.md`](./queries-postgres.md) or [`queries-mongo.md`](./queries-mongo.md)).
- [ ] For multi-namespace contracts, used `db.orm.<ns>.<Model>` / `db.sql.<ns>.<table>` coordinates when the same bare name exists in more than one namespace.
- [ ] Chose the right lane (ORM by default; lower-level builder for shapes the ORM doesn't express).
- [ ] Used `.first()` / `.first({ pk })` (Postgres) or `.where({ ... }).first()` (Mongo) for single-row reads — not `.all()`.
- [ ] Consumed `.all()` with plain `await` (not a `collect()` / `toArray()` helper). Used `for await` only when streaming is actually wanted, and never iterated the same result twice.
- [ ] Did NOT use `db.sql` on a Mongo project or `db.query` where the Postgres SQL builder is meant.
- [ ] Completed the target-specific checklist in the loaded guide.
