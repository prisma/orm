# Query Patterns

This document covers standard patterns for working with Prisma 8 queries, including table access, type inference, and common usage patterns.

## Keep a single `db.ts` entrypoint

**Standard Practice**: Keep one `db.ts` entrypoint that creates `db` once via `postgres(...)`, then import `db` in query modules.

**✅ CORRECT: Build `db` in one file**

```typescript
// src/prisma/db.ts
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env['DATABASE_URL']!,
});
```

**Why?**
- One obvious runtime entrypoint for app code
- The query surfaces (`db.sql`, `db.orm`, `db.raw`) and the runtime boundary (`db.runtime()`) come from one value
- Reduces drift from re-exported aliases as surfaces evolve

## Import and use `db`

**Pattern**: Import `db` and address tables through their namespace: `db.sql.<namespace>.<table>` for the SQL builder, `db.orm.<namespace>.<Model>` for the ORM. A table outside any `namespace { }` block is in `public`. There is no `db.sql.from(...)` and no `db.schema.tables`.

```typescript
import { db } from '../prisma/db';

const plan = db.sql.public.user
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.email, email))
  .build();
const rows = await db.query(plan);
```

Run a plan that returns rows with `db.query(plan)`, and a write without `RETURNING` with `db.execute(plan)`, which resolves `{ affectedRows }`. Values go into the query as they are: there is no `param(...)` placeholder for ad-hoc queries. For a statement built once and run many times, use `db.prepare(...)`.

## Type Inference with `ResultType`

**Pattern**: Use `ResultType<typeof plan>` to name the row type of a plan.

`ResultType` also names the row of any ORM query (`db.orm.public.User.include('posts')`). The same rows can be named without a query in scope: `contract.d.ts` emits a `Models` namespace, and the family package exports the `Scalars` and `Shape` utilities that are applied to those model types; see [Naming model and result types](./model-and-result-types.md).

```typescript
import { db } from '../prisma/db';
import type { ResultType } from '@prisma/orm-postgres/components/runtime';

const plan = db.sql.public.user.select('id', 'email').build();

type UserRow = ResultType<typeof plan>;  // { id: number; email: string }
```

**Why?**
- Type-safe: TypeScript infers the exact row type from the plan
- No manual type definitions needed
- Works with every plan that returns rows: a select, and a write with `.returning(...)`
- Preserves nullability and nested types

## Common Patterns

### DML Operations with Returning

From `examples/prisma-8-demo/src/queries/dml-operations.ts`:

```typescript
import { db } from '../prisma/db';

const insertPlan = db.sql.public.user
  .insert([{ email, displayName, kind: 'user' }])
  .returning('id', 'email')
  .build();
const [inserted] = await db.query(insertPlan);

const updatePlan = db.sql.public.user
  .update({ email: newEmail })
  .where((f, fns) => fns.eq(f.id, userId))
  .returning('id', 'email')
  .build();
const updated = await db.query(updatePlan);
```

`insert` takes an array of rows.

### Queries with Joins

The join callback receives the columns of every table in scope, keyed by table name or alias. Alias a table with `.as(...)`; in a self-join alias both sides. `where`, `orderBy` and `limit` come after `select`.

```typescript
import { db } from '../prisma/db';

const plan = db.sql.public.user
  .innerJoin(db.sql.public.post, (f, fns) => fns.eq(f.user.id, f.post.userId))
  .select((f) => ({ userId: f.user.id, postId: f.post.id, title: f.post.title }))
  .where((f, fns) => fns.eq(f.user.kind, 'admin'))
  .build();
```

## Locking the rows a select reads

A read followed by a write races with other transactions doing the same. At Postgres's default isolation level, two transactions can both read `stock = 1`, both decide there is stock, and both write `stock = 0`. Lock the row when you read it, so the second transaction waits until the first commits and then reads what the first left behind.

**✅ CORRECT: Read then write inside one transaction, with the row locked**

```typescript
import { db } from '../prisma/db';

await db.transaction(async (tx) => {
  const [product] = await tx.query(
    tx.sql.public.product
      .select('id', 'stock')
      .where((f, fns) => fns.eq(f.id, productId))
      .forUpdate()
      .build(),
  );
  if (product !== undefined && product.stock > 0) {
    await tx.execute(
      tx.sql.public.product
        .update({ stock: product.stock - 1 })
        .where((f, fns) => fns.eq(f.id, productId))
        .build(),
    );
  }
});
// SELECT "id" AS "id", "stock" AS "stock" FROM "public"."product" WHERE "id" = $1 FOR UPDATE
```

**✅ CORRECT: Work queue, each worker claims the next unclaimed job**

```typescript
await db.transaction(async (tx) => {
  const [job] = await tx.query(
    tx.sql.public.job
      .select('id')
      .where((f, fns) => fns.eq(f.state, 'queued'))
      .orderBy('createdAt')
      .limit(1)
      .forUpdate({ skipLocked: true })
      .build(),
  );
  // ... process the job and mark it done through tx
});
// ... ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
```

**✅ CORRECT: The same two patterns on the ORM client**

```typescript
await db.transaction(async (tx) => {
  const product = await tx.orm.public.Product.where({ id: productId }).forUpdate().first();
  if (product !== null && product.stock > 0) {
    await tx.orm.public.Product.where({ id: productId }).update({ stock: product.stock - 1 });
  }
});
// ... WHERE "product"."id" = $1 LIMIT 1 FOR UPDATE OF "product"

await db.transaction(async (tx) => {
  const job = await tx.orm.public.Job.where({ state: 'queued' })
    .orderBy((j) => j.createdAt.asc())
    .forUpdate({ skipLocked: true })
    .first();
  // ... process the job and mark it done through tx
});
// ... ORDER BY "job"."createdAt" ASC LIMIT 1 FOR UPDATE OF "job" SKIP LOCKED
```

The four methods are named after the SQL they render:

| Method | SQL | What it blocks |
|---|---|---|
| `forUpdate()` | `FOR UPDATE` | every write and every other lock on the row |
| `forNoKeyUpdate()` | `FOR NO KEY UPDATE` | writes, but not the `FOR KEY SHARE` lock a foreign-key check takes |
| `forShare()` | `FOR SHARE` | writes only; other readers may share-lock at the same time |
| `forKeyShare()` | `FOR KEY SHARE` | only deletes and changes to key columns |

Each method takes an optional object:

- `nowait: true` renders `NOWAIT`: the statement fails at once if a row is already locked, with SQLSTATE `55P03` (`lock_not_available`).
- `skipLocked: true` renders `SKIP LOCKED`: locked rows are left out of the result. `nowait` and `skipLocked` exclude each other.
- `of: ['c']` renders `OF "c"`: only the rows of the named tables or aliases are locked, when the select joins several. The names are the tables or aliases in scope, never schema-qualified.

Each method and each option exists only when the adapter reports its capability (see [Capabilities](capabilities.md)). Postgres reports all of them; SQLite reports none, because SQLite has no row locks.

The ORM client has the same four methods with `nowait` and `skipLocked`, but no `of`: it always renders `OF` the model's own table, so only the model's rows are locked, even when a polymorphic model joins its variant tables. Its methods therefore also need the `sql.lockOf` capability.

**What to know:**
- A lock lasts until the transaction ends, so use it inside `db.transaction(...)`. Outside a transaction the lock is released as soon as the statement ends.
- Prefer `forNoKeyUpdate()` when other transactions insert or update rows that reference the locked row. Every such write takes `FOR KEY SHARE` on the referenced row to check the foreign key. `forUpdate()` conflicts with that lock and can deadlock two transactions that lock a parent and write a child in opposite orders; `forNoKeyUpdate()` does not.
- `skipLocked` with `limit` is the work-queue pattern. On a sharded target it can lock up to `limit` rows per shard.
- Under `nowait` a locked row fails the statement with SQLSTATE `55P03`.
- A lock is refused together with `distinct`, `distinctOn`, `groupBy`, `having`, or an aggregate or window function in the projection, because Postgres refuses those statements. A locked select cannot be used as a subquery.
- On the ORM client, a lock is refused together with `include`, `groupBy`, `aggregate`, `distinct` or `distinctOn`, and a mutation terminal (`create`, `update`, `delete`, `upsert` and their variants) on a locked collection is refused, because a mutation already locks the rows it changes.

## Summary

1. **Use one `db.ts` entrypoint** for config and runtime boundary
2. **Address tables by namespace**: `db.sql.<namespace>.<table>` and `db.orm.<namespace>.<Model>`
3. **Use `ResultType<typeof plan>`** to name row types of plans
4. **Lock rows you read then write** with `forUpdate()` or `forNoKeyUpdate()` inside a transaction
