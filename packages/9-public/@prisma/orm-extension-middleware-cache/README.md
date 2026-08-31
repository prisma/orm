# @prisma/orm-extension-middleware-cache

Opt-in query caching for Prisma Next runtimes, for both the SQL and Mongo families.

```bash
pnpm add @prisma/orm-extension-middleware-cache
```

The whole surface is the package root:

```ts
import { cache, cacheAnnotation, type CacheStore } from '@prisma/orm-extension-middleware-cache';
```

## Responsibilities

A runtime middleware that short-circuits repeated reads: on a hit it returns cached rows and never invokes the driver; on a miss it buffers the driver's rows and commits them to the store only when the execution completes successfully. Cache keys come from the family runtime's content hash of the execution, or from a per-query `cacheAnnotation({ key })` override; `ttl` and `skip` are per-query too. Connection- and transaction-scoped executions bypass the cache.

It ships an in-memory LRU-with-TTL store and exposes the `CacheStore` interface so Redis, Memcached, or any other backend can be dropped in.
