# Mongo Blog Leaderboard

A focused MongoDB example for Prisma 8 that demonstrates the **typed aggregation pipeline DSL** end-to-end against a discriminated post collection.

The headline query ranks authors by post count, attaches the most recent post date, and embeds the author document via `$lookup` — all behind a single typed builder chain that terminates in `.build()` and runs through the canonical `mongo()` runtime facade.

## Schema

`src/contract.prisma` models a small blog with a discriminated `Post` collection:

- `User` (with an embedded `Address` value object) — root collection `users`
- `Post` — root collection `posts`, discriminated by `kind` into:
  - `Article` (`@@base(Post, "article")`) with a `summary`
  - `Tutorial` (`@@base(Post, "tutorial")`) with `difficulty` and `duration`

`Post` declares two MongoDB indexes through PSL:

- `@@index([authorId])` — supports the `authorId` lookup join key
- `@@index([createdAt(sort: Desc)])` — supports time-ordered reads

> Note on syntax: the per-field form `[createdAt(sort: Desc)]` is the supported PSL surface for sort direction; the alternate `[createdAt], { sort: -1 }` shorthand is not parsed.

`Article` does **not** carry `@@unique([summary])` — summaries are descriptive prose, not identity.

## Quick start

```bash
# 1. Build the workspace dependencies (from repo root)
pnpm build

# 2. Generate contract artifacts from the PSL schema
pnpm --filter mongo-blog-leaderboard emit

# 3. Run the integration test (uses mongodb-memory-server, no external DB needed)
pnpm --filter mongo-blog-leaderboard test
```

## The leaderboard query

```ts
import { acc } from '@prisma/orm-mongo/query-builder';
import { createClient } from './src/db';

const db = createClient({ url: process.env.MONGODB_URL!, dbName: 'blog' });
const runtime = await db.runtime();

const leaderboard = db.query
  .from('posts')
  .group((f) => ({
    _id: f.authorId,
    postCount: acc.count(),
    latestPost: acc.max(f.createdAt),
  }))
  // type: { _id: ObjectId, postCount: number, latestPost: Date | null }
  .sort({ postCount: -1 })
  .lookup((from) =>
    from('users')
      .on((local, foreign) => ({
        local: local._id,
        foreign: foreign._id,
      }))
      .as('author'),
  )
  // type: { _id: ObjectId, postCount: number, latestPost: Date | null, author: User[] }
  .build();

const results = await runtime.query(leaderboard);
```

Each link in the chain produces a precise downstream row type:

- `.from('posts')` enters the `posts` root with the `Post` document shape.
- `.group(...)` rewrites the document to the grouped shape — `_id` is whatever expression was returned (here `f.authorId`), and the named fields (`postCount`, `latestPost`) take the type of the accumulator that produced them.
- `.sort({ postCount: -1 })` is keyed by the grouped shape; the type system rejects sorts on fields that no longer exist after the group.
- `.lookup((from) => from('users').on((local, foreign) => ({...})).as('author'))` adds an `author: User[]` array to the row. `local.<field>` and `foreign.<field>` are property-access errors when the field does not exist on the local pipeline shape or the foreign model. The chained inner shape is what makes `foreign` resolve to the foreign model's `FieldAccessor` narrowly — see the package README's [Typed `lookup`](../../packages/2-mongo-family/5-query-builders/query-builder/README.md) section for the API reference.
- `.build()` materialises the chain as a `MongoQueryPlan`; `runtime.query(...)` returns an `AsyncIterableResult` that resolves to `Row[]` when awaited.

## How the runtime is composed

`src/db.ts` uses the canonical Mongo facade:

```ts
import mongo from '@prisma/orm-mongo/runtime';
import contractJson from './contract.json' with { type: 'json' };
import type { Contract } from './contract';

export function createClient({ url, dbName }: { url: string; dbName?: string }) {
  return mongo<Contract>({ contractJson, url, dbName });
}
```

> **The emitted `contract.d.ts` imports only from `@prisma/orm-mongo`**, including the codec generics it takes from `@prisma/orm-mongo/adapter/codec-types`. That matters under pnpm's strict hoisting: a generated file that named a package the application does not depend on directly would not resolve, and TypeScript would report `TS2307: Cannot find module`. The emitter picks its import root by reading this example's `package.json`, so the names it writes are always ones the example installed.

The returned `MongoClient` exposes:

- `db.orm` — typed collection accessors (`db.orm.users`, `db.orm.posts`).
- `db.query` — the pipeline DSL entry point (`db.query.from('posts')...`).
- `db.runtime()` — lazily materialises the underlying runtime (a `Promise<MongoRuntime>`) on first use.
- `db.close()` — releases the driver and any in-flight runtime.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/contract.prisma` | PSL authoring surface |
| `prisma.config.ts` | CLI config (uses `@prisma/orm-mongo/config`) |
| `src/contract.json` | Emitted contract (regenerate with `pnpm emit`) |
| `src/contract.d.ts` | Emitted typed contract (do not edit) |
| `src/db.ts` | Runtime composition via the `mongo()` facade |
| `src/queries.ts` | The leaderboard pipeline query |
| `src/seed.ts` | Sample data for users, articles, tutorials |
| `scripts/seed.ts` | CLI entry point that seeds and prints the leaderboard |
| `test/leaderboard.test.ts` | Integration test against `mongodb-memory-server` |

## Comparison with `examples/mongo-demo`

Both examples target MongoDB and share the same family/target/adapter packages. The differences:

| Aspect | `mongo-demo` | `mongo-blog-leaderboard` |
| --- | --- | --- |
| Surface | Composes runtime by hand (`createMongoExecutionStack`, `mongoOrm`, …) | Uses the `mongo()` facade end-to-end |
| Focus | Broad blog UI + ORM + pipeline endpoints | Single pipeline query with typed result row |
| Indexes | Hand-edited into `contract.json` | Declared in PSL via `@@index` |
| Article uniqueness | `@@unique([summary])` | None |
