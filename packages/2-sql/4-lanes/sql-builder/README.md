# @internal/sql-builder

Type-safe SQL query builder for Prisma Next with runtime execution.

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

## Architecture

- **Domain:** SQL
- **Layer:** Lanes
- **Plane:** Runtime

## Status

See [STATUS.md](./STATUS.md) for covered clauses and known gaps.
