
# Prisma 8 — Queries

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

Prisma 8 ships **two query lanes per target** on the same `db` value from `src/prisma/db.ts`. **Before writing queries, read `db.ts` and load the matching target guide:**

| Runtime import in `db.ts` | Load |
| --- | --- |
| `@internal/postgres/runtime` | [`queries-postgres.md`](./queries-postgres.md) — `db.orm.<ns>.<Model>` + `db.sql.<ns>.<table>` |
| `@internal/mongo/runtime` | [`queries-mongo.md`](./queries-mongo.md) — `db.orm.<root>` + `db.query.from(...)` |
| `@internal/extension-supabase/runtime` | [`queries-postgres.md`](./queries-postgres.md) — a Supabase `RoleBoundDb` is a Postgres surface (`db.orm.<ns>.<Model>` + `db.sql.<ns>.<table>`); bind a role first via `references/supabase.md` |

Both targets share the contract and connection on one `db` value. Reach for the ORM first; drop to the lower-level lane when the ORM can't express the shape. Lane choice is local — one query function picks one lane, not the whole app.

**Do not mix target examples.** Postgres uses PascalCase model roots (`db.orm.public.User`) and `db.sql.public.user`; Mongo uses lowercased plural roots (`db.orm.users`) and `db.query.from('users')`. There is no `db.sql` on Mongo and no `db.query` SQL-builder equivalent on Postgres.

## Namespace-aware accessors

On Postgres, models and tables are **always** addressed by namespace coordinate — the storage namespace is the Postgres schema, and a model declared outside any `namespace { }` block lands in `public`:

- **ORM**: `db.orm.<namespace>.<Model>` — e.g. `db.orm.public.User`, `db.orm.auth.User`
- **SQL builder**: `db.sql.<namespace>.<table>` — e.g. `db.sql.public.user`, `db.sql.auth.users`

There is no flat `db.orm.User` / `db.sql.user` on the Postgres façade: `db.sql` is one facet per storage namespace and nothing else, and `db.orm` is keyed the same way (`examples/prisma-8-demo` uses `db.orm.public.User` and `db.sql.public.user` throughout). SQLite has no schemas, so its façade exposes the single unbound namespace directly — `db.orm.User` and `db.sql.user` are the SQLite spellings (`examples/prisma-8-demo-sqlite`). Mongo is keyed by collection storage name (`db.orm.users`).

See [`queries-postgres.md` § Namespace-aware accessors](./queries-postgres.md#namespace-aware-accessors) for a worked example.

## Consuming the result: `await`, `.toArray()`, or `for await`

Critical to get right early — on **both Postgres and Mongo**, `.all()` returns an **`AsyncIterableResult<Row>`**, which is *both* a `PromiseLike<Row[]>` and an `AsyncIterable<Row>`. That means three consumption forms all work, and the canonical one is the shortest:

```typescript
const users = await db.orm.public.User.select('id', 'email').all();
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
const rows: Promise<User[]> = db.orm.public.User.select('id', 'email').all().toArray();

// Iterate — decode and handle rows one at a time. Whether the raw rows are
// also fetched incrementally depends on the façade; see *Streaming* below.
for await (const user of db.orm.public.User.select('id', 'email').all()) {
  process(user);
}
```

Two single-row shortcuts also exist on the result, in addition to the collection-level `.first()` (which issues `LIMIT 1` on Postgres):

```typescript
const user = await db.orm.public.User.where({ id }).all().first();
//    ^? Row | null   ← buffers, returns the first row or null. Issues no LIMIT.
const required = await db.orm.public.User.where({ id }).all().firstOrThrow();
//    ^? Row          ← buffers; throws `RUNTIME.NO_ROWS` if empty.
```

For genuine single-row reads, prefer the *collection*-level `.first()` (which adds `LIMIT 1` to the SQL on Postgres) over `.all().first()` (which fetches all rows and discards the rest). The result-level helpers are for cases where you already need the full result and want the first row without an extra round-trip.

**The result is single-consumption.** Each `AsyncIterableResult` instance can be consumed once — by `await`, by `.toArray()`, or by `for await`. Trying to consume it a second time throws **`RUNTIME.ITERATOR_CONSUMED`**. The fix is almost always to store the array in a variable on first consumption and reuse the variable:

```typescript
// Bad — second await throws RUNTIME.ITERATOR_CONSUMED.
const result = db.orm.public.User.select('id', 'email').all();
const a = await result;
const b = await result;

// Good — buffer once, reuse the array.
const users = await db.orm.public.User.select('id', 'email').all();
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
  await db.orm.public.User.create(u);
}

// Mongo — lowercased plural root from contract (e.g. users, not User)
// for (const u of users) {
//   await db.orm.users.create(u);
// }

console.log('Seeded.');
await db.close();
```

## Streaming

Every read terminal (`.all()`, and `runtime.query(plan)` for a SQL-builder plan) returns an `AsyncIterableResult`, so `for await` is always available. What it buys you depends on the façade:

- **Long-lived `postgres()` façade** (the usual `db.ts`): the driver runs with cursors disabled. The full result set is fetched from the server before the first row is yielded; only *decoding* happens per row. `for await` therefore does not bound the memory held by the raw result. For very large sets, paginate (`.limit()` / `.offset()`, or `.orderBy(...).cursor(...)`) instead.
- **Serverless façade** (`@prisma/orm-postgres/serverless`, one `connect()` per invocation): the driver reads through a server-side cursor in batches of 100 rows by default (`cursor: { batchSize }` on the façade options), so `for await` really does stream.

There is no `.stream()` method on either façade.

## Prepared statements (Postgres, SQLite)

`db.prepare(declaration, (sql, params) => plan)` builds a statement once and binds it per call. The declaration names each parameter's codec (`{ email: 'pg/text@1' }`); the callback receives the façade's `sql` builder plus typed `params` and returns a plan. A row-returning plan gives a `PreparedStatement` you run with `ps.query(runtime, params)`; a plan whose result is an affected count gives a `PreparedExecution` you run with `ps.execute(runtime, params)`. Declaring a parameter the plan never references throws `RUNTIME.PREPARE_UNUSED_PARAM`. `runtime.prepare(declaration, (params) => plan)` is the same thing on a `Runtime`.

```typescript
// examples/prisma-8-demo/src/queries/get-user-by-email-prepared.ts
const ps = await db.prepare({ email: 'pg/text@1' }, (sql, params) =>
  sql.public.user
    .select('id', 'email', 'displayName', 'createdAt', 'kind')
    .where((f, fns) => fns.eq(f.email, params.email))
    .limit(1)
    .build(),
);

const runtime = db.runtime();
for (const email of emails) {
  const rows = await ps.query(runtime, { email });
}
```

## Naming model and result types

The model is the whole row plus its relations, and each related model carries its own relations in turn, so no query returns a value of the model type. A query returns the fields it fetched. The default fetch returns `Scalars<Model>`, the model without relations: `db.orm.public.User.first()` returns `Scalars<Model> | null`, and `db.orm.public.User.all()` returns `Scalars<Model>[]` (or its async iterable). Four types cover every case, and none needs a client in scope:

- `Models.<ns>_<Model>` (from `contract.d.ts`) — every scalar field and every relation. On SQLite, which has no schemas, the name is bare: `Models.User` and `typeof models.User`. On Postgres the schema is part of the name: `Models.public_User`, or `typeof models.public.User` by dotted access — a model declared outside any `namespace { }` block is in `public`, so that is also its name. Mongo names its models the same way. A polymorphic base also emits one member per variant and an `Any<Base>` union (`Models.public_AnyTask`).
- `Scalars<M>` — the model without relations; what a default fetch returns. Distributes over unions, so `Scalars<Models.public_AnyTask>` is the union of variant rows.
- `Shape<M, Spec>` — a data structure derived from the model, for declaring an endpoint's response type once and having the compiler check the body at the `return`. At every level of `Spec`: `'+'` is a union of scalar and relation names to keep (a relation named there comes with all of its scalars and none of its relations; the scalars are narrowed only when `'+'` names a scalar, so `'+': 'posts'` alone is every scalar plus posts); `'-'` is a union of scalar names to drop; `'+'` naming a scalar beside `'-'` is a compile error, while `{ '-': 'passwordHash'; '+': 'posts' }` is every scalar but the hash plus posts; any other key is a relation whose value is a nested spec that narrows the related model. Relations are absent unless asked for; `X[]`, `X | null`, or `X` comes from the model. Wrong names, a relation in `'-'`, a non-object relation value, and a relation both in `'+'` and as a key are compile errors. No `where`/`orderBy`/`limit`; compose extras with TypeScript (`Shape<M> & { postCount: number }`).
- `ResultType<typeof query>` — the row of any ORM collection value (plain, `.include()`, `.select()`, `.variant()`), and of SQL lane plans. Bind the query to a name first; `typeof` needs a value.

```ts
import type { models, Models } from './prisma/contract';
import type { Scalars, Shape } from '@prisma/orm-postgres/family-contract/types';
import type { ResultType } from '@prisma/orm-postgres/components/runtime';

type User = typeof models.public.User; // same type as Models.public_User
type UserRow = ResultType<typeof db.orm.public.User>; // Scalars<Models.public_User>

const usersWithTasks = () => db.orm.public.User.include('tasks');
type UserWithTasks = ResultType<ReturnType<typeof usersWithTasks>>; // Shape<Models.public_User, { '+': 'tasks' }>

const projected = db.orm.public.User.select('id');
type UserId = ResultType<typeof projected>; // { id: number }

// An endpoint declares its response from the model; the query behind it is an implementation detail.
type UserResponse = Shape<Models.public_User, { '-': 'email'; posts: { '+': 'id' | 'title' | 'tags' } }>;

async function getUserWithPosts(userId: Models.public_User['id']): Promise<UserResponse | null> {
  const user = await db.orm.public.User.where({ id: userId })
    .include('posts', (posts) => posts.include('tags'))
    .first();
  if (user === null) return null;
  const { email: _email, ...rest } = user;
  return { ...rest, posts: user.posts.map(({ id, title, tags }) => ({ id, title, tags })) };
}

// @ts-expect-error 'nope' is not a relation of User
type Bad = Shape<Models.public_User, { nope: {} }>;
```

On Mongo the imports are `@prisma/orm-mongo/family-contract/types` and `@prisma/orm-mongo/components/runtime`; embedded documents are fields, so they stay in `Scalars`. To name a model plus some of its relations, write `Shape<Models.public_User, { '+': 'id' | 'posts' }>`, not `Pick<Models.public_User, 'id' | 'posts'>`: `Pick` demands fully loaded nested posts that no query returns. Input types (`CreateInput<Contract, 'User'>`, `MutationUpdateInput<Contract, 'User'>`, `ShorthandWhereFilter<Contract, 'public', 'User'>`) come from `@prisma/orm-postgres/orm-client`.

Coming from Prisma 7: `Prisma.User` → `Models.public_User` (note: now carries relations; the scalars-only row is `Scalars<Models.public_User>`); `Prisma.UserGetPayload<{ include: { posts: true } }>` → `Shape<Models.public_User, { '+': 'posts' }>`; `Prisma.UserGetPayload<{ select: { id: true; posts: { select: { title: true } } } }>` → `Shape<Models.public_User, { '+': 'id'; posts: { '+': 'title' } }>`; `Prisma.UserCreateInput` → `CreateInput<Contract, 'User'>`; `Awaited<ReturnType<typeof fn>>` → `ResultType<typeof query>`.

## Common Pitfalls (cross-target)

1. **Using Postgres examples on a Mongo project (or vice versa).** Check `db.ts` and load the correct target guide ([`queries-postgres.md`](./queries-postgres.md) or [`queries-mongo.md`](./queries-mongo.md)).
2. **Writing a `collect()` / `toArray()` helper to convert `.all()` to an array.** `.all()` returns an `AsyncIterableResult<Row>` which *is* a `PromiseLike<Row[]>` — `await collection.all()` directly yields `Row[]`. See *Consuming the result* above.
3. **Consuming an `AsyncIterableResult` twice.** Each result is single-use. The second consumer throws `RUNTIME.ITERATOR_CONSUMED`. Buffer once into a variable and reuse the variable.

Target-specific pitfalls live in the per-target guides.

## What Prisma 8 doesn't do yet

- **Many-to-many relations work through the junction.** `.include('tags', (tag) => tag.select(...))` traverses an N:M relation's `through` table, and nested `create` / `connect` / `disconnect` on an N:M relation write the junction rows for you (`examples/prisma-8-demo/src/orm-client/get-post-tags.ts`, `create-post-with-tags.ts`). The one refusal: a junction with required payload columns the relation API cannot populate throws `ORM.RELATION_MUTATION_UNSUPPORTED` — write that junction directly or use the SQL builder.
- **Ordering grouped aggregates by an aggregate alias (Postgres).** `db.orm.<ns>.<Model>.groupBy(...)` supports `.orderBy(...)` on group keys plus `.limit(...)` / `.offset(...)`, but the grouped collection cannot order by an aggregate alias such as `SUM(amount)`. A "top-N groups by SUM" query therefore falls back to JS-side sort + slice over the full grouped result, which is fine at small cardinalities and bad at scale. Workarounds: (a) drop to `db.sql.<ns>.<table>` and write the `GROUP BY` + `ORDER BY` + `LIMIT` against the aggregated table directly; (b) live with the JS-side sort/slice if the grouped cardinality is bounded. File a feature request via `references/feedback.md` if this is hitting you in production.
- **A raw-SQL lane.** This one exists. Write whole-query raw SQL through the client's raw lane: ``db.raw.sql`SELECT ...`.returnsRow({ ... }).build()`` for rows, or `.affectedCount()` for a mutation's row count. Each declared column names the codec that decodes it, so the row stays typed. For an expression fragment inside a builder query, use `fns.raw` in a `.select(...)` callback instead.
- **TypedSQL (`.sql` files compiled into typed callables).** Not implemented. For a repeated query, use `db.prepare(...)` (see *Prepared statements* above) or a function that returns the built plan and `db.runtime().query(plan)` at the call site. If you want a `.sql`-file compile path, file a feature request via `references/feedback.md`.
- **`EXPLAIN` / query-plan inspection.** Prisma 8 does not expose an `.explain()` method. Workaround: connect a `pg.Pool` you control via the runtime's `pg:` binding (see `references/runtime.md`) and issue `EXPLAIN ANALYZE` through it. If you want a first-class plan-inspection surface, file a feature request via `references/feedback.md`.
- **Cursor-backed streaming on the long-lived façade.** `for await` works everywhere, but on `postgres()` the raw result is fetched in full before iteration (see *Streaming* above); only the serverless façade reads through a cursor. Paginate for very large sets on the long-lived façade. If you want cursor streaming there, file a feature request via `references/feedback.md`.
- **Multi-statement batching (Prisma-7-style `db.$transaction([call1, call2])`).** Prisma 8 runs each call sequentially. Workaround: wrap atomically-related work in `db.transaction(async (tx) => { ... })` on Postgres. If you want batch-as-array semantics, file a feature request via `references/feedback.md`.
- **Mongo façade transactions.** `@internal/mongo/runtime` does not expose `db.transaction(...)`. Multi-document atomicity is not yet wrapped in the Prisma 8 Mongo façade. Workaround: use the MongoDB driver's session API directly if you control the client binding (`mongoClient:` option). File a feature request via `references/feedback.md` if you need a first-class façade surface.
- **Mongo ORM aggregates.** No `.aggregate(...)` / `.groupBy(...)` on `db.orm.<root>`. Workaround: express aggregations through `db.query.from(...).group(...).build()` and `runtime.query(plan)`.
- **Mongo filter helpers on the façade.** Rich filters (`.in`, ranges, boolean composition) currently import from `@prisma/orm-mongo/query-ast/execution` (`MongoFieldFilter`, etc.) — not re-exported on `@internal/mongo/runtime`. Workaround: use object equality `.where({ field: value })` where possible; import from the internal package only when necessary. Tracked alongside façade-completeness gaps in Linear `TML-2526`.
- **Automatic N+1 detection.** Prisma 8 does not warn when an `.include(...)` is missing. Workaround: be deliberate about `.include(...)` in code review; the `lints` middleware (see `references/runtime.md`) catches the more common authoring slips (missing `WHERE` on a `DELETE` / `UPDATE`, missing `LIMIT` on a `SELECT`).

## Reference Files

This skill is split for selective loading. Target-specific reference paths live in the per-target guides:

- **Postgres** — [`queries-postgres.md` § Reference Files](./queries-postgres.md#reference-files)
- **Mongo** — [`queries-mongo.md` § Reference Files](./queries-mongo.md#reference-files)

## Checklist

- [ ] Confirmed the active target from `db.ts` and loaded the matching guide ([`queries-postgres.md`](./queries-postgres.md) or [`queries-mongo.md`](./queries-mongo.md)).
- [ ] On Postgres, used `db.orm.<ns>.<Model>` / `db.sql.<ns>.<table>` coordinates (usually `public`) — not a flat `db.orm.User`, which exists only on SQLite.
- [ ] Chose the right lane (ORM by default; lower-level builder for shapes the ORM doesn't express).
- [ ] Used `.first()` / `.first({ pk })` (Postgres) or `.where({ ... }).first()` (Mongo) for single-row reads — not `.all()`.
- [ ] Consumed `.all()` with plain `await` (not a `collect()` / `toArray()` helper). Used `for await` only when per-row handling is actually wanted — and did not promise it bounds memory on the long-lived façade — and never iterated the same result twice.
- [ ] Did NOT use `db.sql` on a Mongo project or `db.query` where the Postgres SQL builder is meant.
- [ ] Completed the target-specific checklist in the loaded guide.
