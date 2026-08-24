# Prisma Next — Queries (Postgres)

> Load this guide when `db.ts` imports from `@internal/postgres/runtime`.

Shared concepts (result consumption, script teardown, cross-target pitfalls, capability gaps) live in [`queries.md`](./queries.md).

## Key Concepts

**Postgres** (`postgres<Contract>(...)` from `@internal/postgres/runtime`):

- **`db.orm.<Model>`** — ORM, PascalCase model name (`db.orm.User`). Fluent `.where(...).select(...).orderBy(...).all()`, fully typed against `Contract`. Default lane for CRUD with relations.
- **`db.sql.<table>`** — SQL builder, lowercase storage name (`db.sql.user`). Produces a *plan* executed via `db.runtime().execute(plan)`. Use when the ORM is too high-level — explicit `JOIN`, computed projections, set operations, window functions.

Reach for the ORM first; drop to `db.sql` when the ORM can't express the shape. Lane choice is local — one query function picks one lane, not the whole app.

**Lane decision table:**

| Need | Choose | Why |
| --- | --- | --- |
| Standard CRUD with relations | **ORM (`db.orm.<Model>`)** | Highest ergonomics; fully typed; model-shaped. |
| Eager-load related records | **ORM `.include(...)`** | Composes with `.where` / `.select` / `.orderBy` / `.limit` per branch. |
| Aggregate (count, sum, avg) | **ORM `.aggregate(...)`** | Typed result; works with grouping (`.groupBy(...).aggregate(...)`). |
| `INSERT ... RETURNING` / `UPDATE ... RETURNING` typed result | **ORM mutations** (returns updated rows) or **`db.sql.<t>.insert(...).returning(...)`** | ORM returns inserted/updated rows; SQL builder exposes `.returning(...)` explicitly. |
| Computed projection (e.g. `ST_DistanceSphere(location, point) AS meters`) alongside model fields | **SQL builder (`db.sql.<t>`)** | The ORM projects model fields; arbitrary expression projection is the SQL builder's seam. |
| Complex `JOIN`, set operation, window function | **SQL builder** | The ORM doesn't express arbitrary joins. |
| Postgres-specific feature (`LATERAL`, `FILTER`, custom aggregates) | **SQL builder**, falling back to extension operators when the extension provides them | DSL first; extensions can contribute operators (`postgis`, `pgvector`, `cipherstash`). |

## Workflow — ORM reads

The concept: `db.orm.<Model>` returns a *collection* you compose method-by-method. Each call returns a new collection (immutable chaining); the terminal verb (`.all()` / `.first()` / `.count()` / `.aggregate(...)`) issues the query. Predicates are lambdas over a field proxy: `u.field.<op>(value)`.

```typescript
// src/queries/users.ts — one directory deep under src/, so the import is '../prisma/db'
import { db } from '../prisma/db';

// Find one record by primary key shorthand.
const user = await db.orm.User.first({ id: userId });
// Returns the full row or `null`.

// Find one matching a predicate.
const alice = await db.orm.User
  .where((u) => u.email.eq('alice@example.com'))
  .first();

// Find many with projection, sort, and limit.
const recentUsers = await db.orm.User
  .select('id', 'email', 'createdAt')
  .orderBy((u) => u.createdAt.desc())
  .limit(10)
  .all();
```

**Predicates** (`.where(...)`) come in two forms:

```typescript
// Lambda form — full expression power.
db.orm.User.where((u) => u.email.eq('alice@example.com'));

// Shorthand object form — equality on the named fields.
db.orm.User.where({ kind: 'admin' });
```

Operators on the field proxy include `.eq`, `.neq`, `.lt`, `.lte`, `.gt`, `.gte`, `.like`, `.ilike`, `.in([...])`, `.isNull()`, `.isNotNull()`. Extensions add target-specific operators on extension-typed columns (`pgvector`'s `.cosineDistance(...)`, `postgis`'s `.within(...)` / `.intersectsBbox(...)` / `.distanceSphere(...)`, `cipherstash`'s `.cipherstashEq(...)` / `.cipherstashGt(...)` / …).

**There is no `.between(a, b)` operator.** Express ranges either as two chained `.where(...)` clauses (the idiomatic form — clauses AND-compose) or with the `and(...)` combinator inside one clause:

```typescript
// Chained .where() — each clause AND-composes with the previous one.
await db.orm.Sale
  .where((s) => s.day.gte(start))
  .where((s) => s.day.lte(end))
  .all();

// Equivalent with an explicit `and(...)` inside one clause.
import { and } from '@internal/sql-orm-client'; // façade re-export pending — see *What PN doesn't do yet* in queries.md
await db.orm.Sale
  .where((s) => and(s.day.gte(start), s.day.lte(end)))
  .all();
```

The two forms emit the same SQL. Pick chained `.where()` when each clause adds a separate condition that reads as its own thought; pick `and(...)` when one logical predicate happens to have two parts and you want the visual grouping. Don't reach for a `between` helper — there isn't one.

**Combinators** (`and`, `or`, `not`) compose predicates, and **relation predicates** (`.some(...)`, `.none(...)`, `.every(...)`) recurse into a relation. These currently come from the internal `@internal/sql-orm-client` package — see *What Prisma Next doesn't do yet* in [`queries.md`](./queries.md):

```typescript
import { and, or, not } from '@internal/sql-orm-client';

await db.orm.User
  .where((u) =>
    and(
      or(u.kind.eq('admin'), u.email.ilike('%@example.com')),
      not(u.posts.none((p) => p.title.ilike('%draft%'))),
    ),
  )
  .all();
```

**Sorting and pagination.** `.orderBy(...)` accepts a single lambda or an array of lambdas (each calling `.asc()` / `.desc()` on a field). `.limit(n)` limits; `.offset(n)` offsets.

```typescript
await db.orm.Post
  .where((p) => p.authorId.eq(userId))
  .orderBy([(p) => p.createdAt.desc(), (p) => p.id.desc()])
  .limit(20)
  .all();
```

**Cursor pagination.** Call `.cursor({ field: lastValue })` after `.orderBy(...)` to resume from a known position. The cursor requires a prior `orderBy` — the type system enforces this. Direction (forward or backward) follows the sort: ascending order means "greater than the cursor value", descending means "less than".

```typescript
const page1 = await db.orm.Post
  .orderBy((p) => p.createdAt.desc())
  .limit(20)
  .all();

const last = page1[page1.length - 1]!;
const page2 = await db.orm.Post
  .orderBy((p) => p.createdAt.desc())
  .cursor({ createdAt: last.createdAt })
  .limit(20)
  .all();
```

Cursor keys must match fields in the active `orderBy`. For a composite `orderBy`, pass a value for each ordering column — a partial cursor seeks only on the columns you supply, which gives an incomplete keyset. An empty cursor object is a no-op: you get the unfiltered first page back.

**`.first()` vs `.first({ pk })` vs `.all()`.** Use `.first()` for a single row (issues a `LIMIT 1`); use `.first({ pk })` for primary-key lookups; reserve `.all()` for the genuine many case (no implicit `LIMIT`).

## Workflow — Eager-loading relations (`.include`)

The concept: `.include('<relation>', (branch) => branch.<chain>)` adds a relation branch to the parent query. The branch is its own collection — compose `.where` / `.select` / `.orderBy` / `.limit` on it just like the parent.

```typescript
await db.orm.User
  .select('id', 'email')
  .include('posts', (post) =>
    post
      .select('id', 'title', 'createdAt')
      .orderBy((p) => p.createdAt.desc())
      .limit(5),
  )
  .limit(10)
  .all();
// → Array<{ id, email, posts: Array<{ id, title, createdAt }> }>
```

**Reduce a to-many relation to a scalar.** A refinement callback may return a *reducer* — `count()`, `sum(field)`, `avg(field)`, `min(field)`, `max(field)`, plus the lossless `countBigInt()`, `sumBigInt(field)`, and `avgDecimal(field)` — instead of a collection. The parent's relation field then carries that one value rather than an array. Reducers exist only inside an `include(...)` callback; calling one elsewhere throws.

```typescript
await db.orm.User.include('posts', (posts) => posts.count()).all();
// → Array<{ ...user, posts: number }> — a parent with no posts reads 0

await db.orm.User.include('posts', (posts) => posts.sum('views')).all();
// → Array<{ ...user, posts: number | null }>

await db.orm.User.include('posts', (posts) => posts.avg('views')).all();
// → Array<{ ...user, posts: number | null }>

await db.orm.User.include('posts', (posts) => posts.min('views')).all();
await db.orm.User.include('posts', (posts) => posts.max('views')).all();
// → Array<{ ...user, posts: number | null }>

// The lossless form, for a total that may outgrow a JS number:
await db.orm.User.include('posts', (posts) => posts.sumBigInt('views')).all();
// → Array<{ ...user, posts: bigint | null }>

// Several sub-views of one relation at once:
await db.orm.User.include('posts', (posts) =>
  posts.combine({ recent: posts.limit(3), total: posts.count() }),
).all();
// → Array<{ ...user, posts: { recent: Post[]; total: number } }>
```

A reducer's result type is the one the target declares for that aggregate — the same types *Workflow — Aggregates* tabulates below, including the `null` a field-taking reducer answers for a parent with no related rows. The reducer set is read from the contract, so an operation a target or extension contributes shows up as a reducer under its own name, with no client change.

Nested `1:N → 1:N` includes (e.g. `User → posts → comments`) require the contract to advertise the `lateral` + `jsonAgg` capabilities for the active target. The Postgres adapter advertises both by default, so most apps get this for free; if the type system rejects a nested include with a *missing capability* error, route to `references/contract.md` to add the required capability declarations and use `references/queries.md` for query-shape guidance.

## Workflow — ORM writes

```typescript
// Create — returns the inserted row.
const user = await db.orm.User.create({ id, email, displayName, kind, createdAt });

// Create with selected return — narrows the return shape.
const summary = await db.orm.User
  .select('id', 'email', 'kind')
  .create({ id, email, displayName, kind, createdAt });

// Update by predicate.
await db.orm.User.where({ id }).update({ email: newEmail });

// Update with selected return.
await db.orm.User
  .where({ id })
  .select('id', 'email', 'kind')
  .update({ email: newEmail });

// Delete by predicate.
await db.orm.User.where({ id }).delete();

// Upsert — typed by the create branch's shape.
await db.orm.User
  .select('id', 'email', 'kind', 'createdAt')
  .upsert({
    create: { id, email, displayName, kind, createdAt: new Date() },
    update: { email, displayName, kind },
  });
```

The ORM returns inserted / updated rows by default. The `.returning(...)` selector lives on the SQL builder (next section), where you build a plan and execute it explicitly.

## Workflow — Aggregates

```typescript
const totals = await db.orm.User.aggregate((aggregate) => ({
  totalUsers: aggregate.count(),
}));

const adminTotals = await db.orm.User
  .where({ kind: 'admin' })
  .aggregate((aggregate) => ({
    adminUsers: aggregate.count(),
  }));

// Group-by + aggregate.
const byKind = await db.orm.User
  .groupBy('kind')
  .having((having) => having.count().gte(minUsers))
  .aggregate((aggregate) => ({
    totalUsers: aggregate.count(),
  }));
```

`aggregate` exposes `.count()`, `.sum(field)`, `.avg(field)`, `.min(field)`, `.max(field)`, and the lossless `.countBigInt()`, `.sumBigInt(field)`, `.avgDecimal(field)`. Project the aggregates into named result keys; the result type narrows accordingly.

**The bare operations answer as JS numbers. The suffixed ones answer losslessly.** An aggregate's type is the one its target declares and its nullability matches SQL semantics, both read from the contract. On PostgreSQL:

| Aggregate | Type | Empty result |
| --- | --- | --- |
| `count()` | `number` | `0` |
| `countBigInt()` | `bigint` | `0n` |
| `sum(field)` over `int2` / `int4` / `int8` / `BigIntNumber` | `number \| null` | `null` (SQL `SUM` over zero rows is `NULL`) |
| `sumBigInt(field)` over any integer | `bigint \| null` | `null` |
| `sum(field)` over `float4` / `float8` | `number \| null` | `null` |
| `sum(field)` over `numeric` | decimal `string \| null` | `null` |
| `sum(field)` over `UnboundedInt` | `bigint \| null` — that column's own family | `null` |
| `avg(field)` over any integer | `number \| null` | `null` |
| `avgDecimal(field)` over any integer or `numeric` | decimal `string \| null` | `null` |
| `avg(field)` over a float | `number \| null` | `null` |
| `min(field)` / `max(field)` | the column's own type `\| null` — `text` where the column is `varchar` | `null` |

**`count()`, and `sum` over an integer column, throw outside ±(2^53 − 1) — they never round.** Those two are the results a guarded integer codec produces. The rows above the guard does not reach: `sum` over `numeric`, `UnboundedInt`, or a float column, and every `avg`, which is a fraction already. The error is `RUNTIME.DECODE_FAILED` (`… value must be an integer within the safe integer range, got …`), and it fires on the include path too. That is the trade the defaults make: a `number` you can compare, serialise, and do arithmetic with, and a loud failure instead of a quietly wrong total. Switch that one call to `sumBigInt` / `countBigInt` where the magnitude is real.

**Float and Decimal columns keep their own family.** `sum` over `numeric` is still a decimal string, and `sum` over `float8` still a `number` — the defaults policy is about integers, and a column whose author chose `numeric` already chose its representation.

**SQLite states the same policy.** `count`, `sum` over integers, and `avg` all read as `number`; `countBigInt` and `sumBigInt` are there too. There is no `avgDecimal` — SQLite has no exact decimal type, so the method does not exist on a SQLite contract.

**The ORM's `having(...)` stays a `number`.** Its comparand is typed `number` outright, whatever result type the aggregate carries, so `having.count().gte(minUsers)` takes a plain number — the value is inlined as a SQL literal and compared inside the database. Only the aggregate's *result*, the value that reaches your code, carries its target's type. The lossless variants are projection-only and have no HAVING method at all.

**The SQL builder types its comparands differently.** `fns.gt(a, b)` types both operands from one codec, so a literal compared against an aggregate follows that aggregate's result codec — `fns.gt(fns.count(), 1)`, not `1n`. That applies in `having(...)`, in `where(...)`, and inside any larger expression.

Nullability isn't a typing bug — it's faithful to what the database returns. Coalesce client-side when you want zero-fill:

```typescript
const revenue = await db.orm.Sale
  .where((s) => s.day.gte(start))
  .aggregate((a) => ({ total: a.sum('amount') }));
// revenue.total: number | null

const safe = revenue.total ?? 0;   // ← apply at the consumption site, not in the aggregate spec.
```

If `?? 0` is showing up on every aggregate, that's a signal you're calling `sum` (or peers) over potentially-empty filters — which is exactly when SQL returns NULL. The pattern is correct; the typing is honest.

## Workflow — SQL builder (`db.sql.<table>`)

The concept: `db.sql.<table>` is a table-shaped builder that produces a *plan*. The plan is a serialisable description of the query (AST + parameters); you execute it through the runtime with `db.runtime().execute(plan)`. The builder gives you the lanes the ORM doesn't express — explicit `JOIN`, arbitrary expression projection, target-specific operations through extension helpers — without dropping to raw SQL.

```typescript
// src/queries/posts.ts — adjust the relative import to match file depth.
import { db } from '../prisma/db';

// Select with predicate and limit.
const plan = db.sql.post
  .select('id', 'title', 'userId', 'createdAt')
  .where((f, fns) => fns.eq(f.userId, userId))
  .limit(limit)
  .build();

const rows = await db.runtime().execute(plan);
```

The `.where(...)` callback receives `(fields, fns)` — `fields` is the field proxy (column references), `fns` is the operator namespace (`fns.eq`, `fns.ne`, `fns.gt`, …). Extensions inject extension-shaped helpers into the same `fns` namespace (`fns.distanceSphere`, `fns.cosineDistance`, etc.).

### `INSERT` / `UPDATE` / `DELETE` with `RETURNING`

```typescript
// Insert and return selected columns.
const plan = db.sql.user
  .insert({ email })
  .returning('id', 'email')
  .build();
const [row] = await db.runtime().execute(plan);

// Update with predicate and returning.
const updatePlan = db.sql.user
  .update({ email: newEmail })
  .where((f, fns) => fns.eq(f.id, userId))
  .returning('id', 'email')
  .build();
const rows = await db.runtime().execute(updatePlan);

// Delete with predicate.
const deletePlan = db.sql.user
  .delete()
  .where((f, fns) => fns.eq(f.id, userId))
  .build();
await db.runtime().execute(deletePlan);
```

`.returning(...)` requires the target adapter to advertise the `returning` capability. The Postgres adapter advertises it by default.

### Computed projections and joins

```typescript
// Project a computed expression alongside model fields.
const plan = db.sql.cafe
  .select('id', 'name')
  .select('meters', (f, fns) => fns.distanceSphere(f.location, point))
  .orderBy((f, fns) => fns.distanceSphere(f.location, point), { direction: 'asc' })
  .orderBy((f) => f.id, { direction: 'asc' })
  .limit(limit)
  .build();
const rows = await db.runtime().execute(plan);

// Self-join with an alias.
db.sql.post
  .innerJoin(db.sql.post.as('p2'), (f, fns) => fns.ne(f.p1.userId, f.p2.userId))
  // ...
  .build();
```

## Workflow — Transactions

The concept: `db.transaction(fn)` opens a transaction and passes a `tx` context to the callback. `tx.orm` and `tx.sql` mirror `db.orm` / `db.sql` but ride the same transaction; `tx.execute(plan)` executes a SQL-builder plan within it. The transaction commits on the callback's successful return and rolls back on any thrown error.

```typescript
await db.transaction(async (tx) => {
  const user = await tx.orm.User.create({ id, email });
  await tx.orm.Post.create({ userId: user.id, title: 'hello' });

  // SQL-builder plan inside the transaction.
  const plan = tx.sql.post.update({ status: 'archived' })
    .where((f, fns) => fns.lt(f.createdAt, cutoff))
    .build();
  await tx.execute(plan);

  // If anything throws, all three operations roll back.
});
```

The callback's return value passes through `db.transaction(...)`. Capture inserted ids out of the callback and use them downstream after commit.

## Namespace-aware accessors

When the contract declares multiple namespaces, both `db.sql` and `db.orm` expose a namespace coordinate alongside the flat bare-name surface:

```typescript
// db.sql.<namespace>.<table>
const plan = db.sql.public.users.select('id', 'email').build();
const authPlan = db.sql.auth.users.select('id', 'token').build();
await db.runtime().execute(plan);

// db.orm.<namespace>.<Model>
const user = await db.orm.public.User.create({ id: 1, email: 'a@x.io' });
const authUser = await db.orm.auth.User.create({ id: 2, token: 'tok' });
```

The flat `db.sql.users` / `db.orm.User` form still works when bare names are unique across all namespaces. When the same bare name appears in more than one namespace, use the coordinate form — both the type system and the runtime require it to resolve to the right table.

Cross-namespace relations (e.g. `public.Profile` → `auth.User`) follow the same `.include()` syntax; the ORM resolves the correct schema-qualified join automatically.

## Common Pitfalls (Postgres)

1. **Reaching for the lower-level lane when the ORM would have done.** The ORM covers most CRUD shapes; drop to `db.sql` only for shapes the ORM can't express. Default to the ORM.
2. **Using `.all()` when you wanted one row.** `.all()` issues no implicit limit. Use `.first()` or `.first({ pk })`.
3. **Coalescing `count()` with `?? 0` "just in case".** `count()` is `number`, not `number | null` — SQL answers an empty set with `0`. The `?? 0` belongs on `sum` / `avg` / `min` / `max`, and its zero should match the aggregate's own type (`0` for an integer sum, `0n` for `sumBigInt`, `'0'` where the result is a decimal string).
4. **Reaching for `.between(a, b)` on a field proxy.** It doesn't exist. Either chain `.where((m) => m.field.gte(a)).where((m) => m.field.lte(b))` or use `and(m.field.gte(a), m.field.lte(b))` inside one `.where()` clause.
5. **Importing `and` / `or` / `not` from a Postgres façade subpath.** The combinators currently live in `@internal/sql-orm-client` — an internal package. See *What Prisma Next doesn't do yet* in [`queries.md`](./queries.md).
6. **Trying to `db.sql.from(tables.user)`.** That surface does not exist. The builder is table-shaped: `db.sql.<tableName>.select(...)`. There is no `db.schema.tables` either.
7. **Trying to `db.execute(plan)` directly.** Plans execute through the runtime: `db.runtime().execute(plan)`. Inside a transaction, use `tx.execute(plan)`.
8. **Setting `capabilities: { lateral: true }` in `prisma.config.ts`.** `defineConfig` does not take `capabilities`. Capabilities are declared by the active adapter and become part of the emitted contract; the Postgres adapter advertises `lateral`, `jsonAgg`, and `returning` out of the box. Enable extension capabilities through `extensions: [...]` in the config (see `references/contract.md`).
9. **Confabulating a TypedSQL or `.stream()` surface.** Neither exists today. Raw SQL does: the client's raw lane, ``db.raw.sql`…` ``. See *What Prisma Next doesn't do yet* in [`queries.md`](./queries.md) for all three.
10. **Mixing the ORM mutation return with `runtime.execute(plan)`.** ORM terminals issue the query themselves and return rows. `runtime.execute` is for SQL-builder plans.
11. **Ordering grouped rows by an aggregate metric.** The grouped collection supports `.orderBy(...)` on group keys plus `.limit(...)` / `.offset(...)`, but it cannot order by an aggregate alias such as `SUM(amount)`. Sorting the materialized aggregate result in JS is fine at small cardinalities; for large grouped result sets, drop to `db.sql.<table>`.

## Reference Files

- Example queries under [`examples/prisma-8-demo/src/orm-client/`](examples/prisma-8-demo/src/orm-client/) and [`examples/prisma-8-demo/src/queries/`](examples/prisma-8-demo/src/queries/) — canonical ORM and SQL-builder shapes.
- ORM client source under `packages/3-extensions/sql-orm-client/src/`.
- SQL builder source under `packages/2-sql/4-lanes/sql-builder/src/`.

## Checklist

- [ ] Chose the right lane (ORM by default; `db.sql` for shapes the ORM doesn't express).
- [ ] Used `.first()` / `.first({ pk })` for single-row reads — not `.all()`.
- [ ] Coalesced `sum` / `avg` / `min` / `max` results at the consumption site when zero-fill is desired, with a zero of the aggregate's own type — did NOT coalesce `count()`, which is `number` and never null.
- [ ] Reached for `countBigInt` / `sumBigInt` / `avgDecimal` where the value can outgrow a JS number or the exact decimal matters — `count()` and `sum` over an integer column throw `RUNTIME.DECODE_FAILED` outside ±(2^53 − 1) rather than rounding, and `avg` rounds as any double does.
- [ ] Compared and serialised aggregate *results* as what they are — a `bigint` from a suffixed variant needs `0n` literals and `String(value)` rather than bare `JSON.stringify` — leaving the ORM's `having(...)` operands as numbers, and matching each SQL-builder comparison literal to the aggregate's own result codec (`fns.gt(fns.count(), 1)`).
- [ ] Expressed ranges as chained `.where(...)` clauses or a single `and(...)` clause — did NOT reach for a non-existent `.between(...)` operator.
- [ ] For cursor pagination, used `.orderBy(...).cursor({ field: lastValue }).limit(n).all()` — did NOT hand-write a `.where(p => p.field.lt(cursor))` workaround when the `.cursor()` API serves the same purpose.
- [ ] For ORM combinators, imported `and` / `or` / `not` from the (currently internal) `@internal/sql-orm-client` and noted the façade gap to the user.
- [ ] Executed SQL-builder plans via `db.runtime().execute(plan)` (or `tx.execute(plan)` inside a transaction).
- [ ] Wrapped multi-statement work in `db.transaction(async (tx) => { ... })` where atomicity matters.
- [ ] For top-N grouped aggregates at meaningful scale, dropped to `db.sql.<table>` rather than JS-side sort + slice over `groupBy(...).aggregate(...)`.
- [ ] Did NOT confabulate TypedSQL, `.stream()`, `db.batch`, `.between(...)`, a `capabilities` field on `defineConfig`, or a `db.sql.from(tables.user)` API — routed to *What Prisma Next doesn't do yet* / `references/feedback.md` instead. Raw SQL is spelled `db.raw.sql`, not `db.sql.raw`.
