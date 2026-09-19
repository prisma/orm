# Mongo Demo

End-to-end example of Prisma 8 with MongoDB, demonstrating the full **authoring → emit → runtime** pipeline using the contract-first approach.

## What it shows

- PSL schema (`prisma/contract.prisma`) as the authoring surface for MongoDB
- Contract emission via `prisma.config.ts` and the CLI (`prisma contract emit`)
- Runtime query execution using `mongoOrm()` with the emitted contract
- Reference relation resolution via `$lookup` (Post → User)
- Integration tests against an in-memory MongoDB replica set

## Schema

The demo uses a blog schema with two models and a reference relation:

```text
User (id, name, email, bio?) ←1:N→ Post (id, title, content, authorId, createdAt)
```

See [`prisma/contract.prisma`](prisma/contract.prisma).

## Quick start

```bash
# 1. Build dependencies (from repo root)
pnpm build

# 2. Generate contract artifacts from the PSL schema
pnpm emit

# 3. Run integration tests (uses mongodb-memory-server, no external DB needed)
pnpm test
```

## Migrations

The demo includes a unique ascending index on `users.email`, demonstrating the MongoDB migration workflow.

> **Note:** Index definitions in `src/contract.json` are hand-added because PSL `@@index` support for MongoDB is not yet implemented (planned for M2). Do not run `pnpm emit` without re-adding the index definitions afterward.

### Preview migration plan

```bash
pnpm migration:plan --name add-email-index
```

### Apply migrations

```bash
# Set your MongoDB URL (or use the default in prisma.config.ts)
export MONGODB_URL=mongodb://localhost:27017/mongo-demo

pnpm migration:apply
```

This creates the unique index on `users.email` and records the migration in the `_prisma_migrations` collection.

## Scripts

| Script                | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `pnpm emit`           | Emit `src/contract.json` + `src/contract.d.ts` via `prisma contract emit` |
| `pnpm migration:plan` | Preview migration operations (offline, no DB needed)                        |
| `pnpm migration:apply`| Apply pending migrations to the database                                    |
| `pnpm test`           | Run integration tests against an in-memory MongoDB replica set              |
| `pnpm dev`            | Start the Vite dev server (React UI)                                        |
| `pnpm dev:api`        | Start the API server (`src/server.ts`)                                      |
| `pnpm cache-demo`     | Demonstrate cross-family caching against the in-memory MongoDB              |

## Cross-family caching

`src/db.ts` wires `@internal/middleware-cache` into the Mongo runtime — the same middleware used by `examples/prisma-8-demo` against Postgres. The package depends only on `@internal/framework-components/runtime`; cache keys come from `RuntimeMiddlewareContext.contentHash(exec)`, which `MongoRuntimeImpl` populates the same way `SqlRuntime` does, so the middleware works against Mongo out of the box.

The cache is **opt-in per query**: it acts only on plans whose `meta.annotations` carry a `cacheAnnotation` payload with a `ttl`. `scripts/cache-demo.ts` builds an aggregation plan with `mongoQuery`, attaches `cacheAnnotation({ ttl })` to `plan.meta.annotations.cache`, runs the same plan twice, and prints the per-call latency so the cache hit is visible:

```bash
pnpm cache-demo
```

A representative run looks like:

```text
Demonstrating opt-in caching with cacheAnnotation on a Mongo aggregation plan...
Running the same plan twice — second call should hit cache.

First call (cache miss):  18.42ms
Second call (cache hit):  0.21ms
Speedup: 87.7x faster
```

The Mongo query builder doesn't yet expose a chainable `.annotate(...)` surface (the SQL DSL does), so the demo threads the annotation through `plan.meta.annotations.cache` directly via a small `withCacheAnnotation` helper. `test/cache-middleware.test.ts` pins the same end-to-end short-circuit behaviour against `mongodb-memory-server` so the cross-family claim is exercised by CI.

## How emission works

`prisma.config.ts` wires the Mongo family, target, and adapter descriptors together with a `mongoContract()` provider. Running `pnpm emit` invokes the CLI's `contract emit` command, which:

1. Loads `prisma.config.ts` and creates a control stack
2. Reads and parses `prisma/contract.prisma` via the `mongoContract()` provider
3. Interprets the parsed document into a `Contract`
4. Emits `src/contract.json` and `src/contract.d.ts`

## How the runtime works

`src/db.ts` composes the Mongo runtime stack:

1. Validates the emitted contract with `validateMongoContract()`
2. Creates a `MongoAdapter` and `MongoDriver`
3. Creates a `MongoRuntime` for query execution
4. Creates an ORM surface via `mongoOrm()` with typed collection accessors (`orm.users`, `orm.posts`)

## Key files

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `prisma/contract.prisma`       | PSL schema (authoring surface)                     |
| `prisma.config.ts`        | CLI config (family + target + adapter + driver + contract provider) |
| `src/contract.json`            | Emitted contract with hand-added indexes (see note above) |
| `src/contract.d.ts`            | Emitted type definitions (generated, do not edit)   |
| `src/db.ts`                    | Runtime composition (adapter → driver → runtime → ORM) |
| `.env.example`                 | Environment variable template (`MONGODB_URL`)       |
| `test/blog.test.ts`            | Integration tests using `mongodb-memory-server`    |

## Comparison with prisma-8-demo

| Aspect        | `prisma-8-demo` (SQL)                    | `mongo-demo` (MongoDB)                      |
| ------------- | ------------------------------------------- | ------------------------------------------- |
| Target        | PostgreSQL                                  | MongoDB                                     |
| Schema        | `schema.prisma` (PSL)                       | `contract.prisma` (PSL)                     |
| Emission      | CLI (`prisma contract emit`)           | CLI (`prisma contract emit`)           |
| Runtime       | `postgres()` one-liner                      | `createMongoAdapter()` + `createMongoDriver()` + `createMongoRuntime()` + `mongoOrm()` |
| Relations     | SQL joins                                   | `$lookup` aggregation pipeline              |
| Tests         | Requires running PostgreSQL                 | Uses `mongodb-memory-server` (no external DB) |
