# @internal/sql-builder

Type-safe SQL query builder for Prisma 8 with runtime execution.

## Usage

```typescript
import { sql } from '@internal/sql-builder/runtime';

const db = sql({ context, runtime });

// SELECT with WHERE
const user = await db.users
  .select('id', 'email')
  .where((f, fns) => fns.eq(f.id, 1))
  .first();

// Aliased expression select
const rows = await db.users
  .select('id')
  .select('userName', (f) => f.name)
  .all();

// JOIN
const rows = await db.users
  .innerJoin(db.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .select('name', 'title')
  .all();

// Self-join via .as()
const rows = await db.users
  .as('invitee')
  .innerJoin(db.users.as('inviter'), (f, fns) =>
    fns.eq(f.invitee.invited_by_id, f.inviter.id),
  )
  .select('name')
  .all();

// Subquery as join source
const sub = db.posts.select('user_id', 'title').as('sub');
const rows = await db.users
  .innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id))
  .select('name', 'title')
  .all();

// GROUP BY with aggregate
const counts = await db.posts
  .select('user_id')
  .select('cnt', (_f, fns) => fns.count())
  .groupBy('user_id')
  .having((_f, fns) => fns.gt(fns.count(), 1))
  .all();
```

### Row locking

`forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()` render the matching locking clause after `LIMIT`/`OFFSET`. Each exists only when the adapter reports its capability, and so does each option. The lock lasts until the enclosing transaction ends, so use it inside a transaction.

```typescript
// FOR NO KEY UPDATE: does not block foreign-key checks on the row
await tx.sql.public.contact.select('id').where((f, fns) => fns.eq(f.id, id)).forNoKeyUpdate().first();

// FOR UPDATE SKIP LOCKED: the work-queue pattern
await tx.sql.public.job
  .select('id')
  .where((f, fns) => fns.eq(f.state, 'queued'))
  .orderBy('id')
  .limit(1)
  .forUpdate({ skipLocked: true })
  .first();

// FOR SHARE OF "c" NOWAIT: lock one table of a join, fail at once if a row is locked
await tx.sql.public.contact
  .as('c')
  .innerJoin(tx.sql.public.identity.as('i'), (f, fns) => fns.eq(f.c.id, f.i.contact_id))
  .select('name')
  .forShare({ of: ['c'], nowait: true })
  .all();

// FOR KEY SHARE: blocks only deletes and key changes
await tx.sql.public.contact.select('id').forKeyShare().all();
```

`nowait` and `skipLocked` exclude each other. `build()` refuses a lock together with `distinct`, `distinctOn`, `groupBy`, `having`, or an aggregate or window function in the projection. A locked select cannot be used as a subquery. `groupBy()` returns a query without the locking methods.

### A table's indexes

A table proxy's `indexes` holds each of its indexes under the name the contract source gave it: the `name:` prefix, or the `map:` name. Each is an `IndexReference`: its columns as expressions over the table's alias, its `type` and its `options`, typed from the contract. A query operation that searches what an index covers takes it in place of the columns, such as Postgres's `fullTextMatches`:

```typescript
const post = db.public.post.as('p');
await post
  .select('id')
  .where((_f, fns) => fns.fullTextMatches(post.indexes.post_search, websearchToTsquery(query)))
  .all();
```

An unnamed index, including a foreign key's derived backing index, appears under its default prefix, such as `post_authorId_idx`. A name that more than one index of the table shares is not a key of the type, and reading it throws `ORM.ARGUMENT_INVALID`.

An index's columns are bound to the alias of the proxy it was read from, so read it from a table the query selects from or joins: `build()` throws `ORM.ARGUMENT_INVALID` for a column of any other alias.

## Architecture

- **Domain:** SQL
- **Layer:** Lanes
- **Plane:** Runtime

## Status

See [STATUS.md](./STATUS.md) for covered clauses and known gaps.
