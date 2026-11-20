# @prisma/sqlcommenter-query-tags

An `AsyncLocalStorage`-based query tagging plugin for Prisma ORM's SQL commenter feature. This package allows you to add ad-hoc tags to your SQL queries that will be appended as comments, useful for tracing, debugging, and observability.

## Installation

```bash
npm install @prisma/sqlcommenter-query-tags
```

## Usage

```typescript
import { queryTags, withQueryTags } from '@prisma/sqlcommenter-query-tags'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  adapter: myAdapter, // Driver adapter required (alternatively, Accelerate URL)
  comments: [queryTags()],
})

// Wrap your queries to add tags
const posts = await withQueryTags({ route: '/api/posts', user: 'user-123' }, () => prisma.post.findMany())
```

The resulting SQL will include comments like:

```sql
SELECT ... FROM "Post" /*route='/api/posts',user='user-123'*/
```

## API

### `queryTags()`

Creates a SQL commenter plugin that retrieves query tags from `AsyncLocalStorage`.

```typescript
function queryTags(): SqlCommenterPlugin
```

### `withQueryTags(tags, scope)`

Executes a function with the given query tags added to all SQL queries within its scope.
Nested calls to `withQueryTags` completely replace the outer tags.

```typescript
function withQueryTags<T>(tags: SqlCommenterTags, scope: () => PromiseLike<T>): Promise<T>
```

**Parameters:**

- `tags` - Key-value pairs to add as SQL comments. Keys with `undefined` values are filtered out.
- `scope` - An async function to execute within the tagged scope

**Returns:** The result of the scope function

### `withMergedQueryTags(tags, scope)`

Executes a function with merged query tags added to all SQL queries within its scope.
Unlike `withQueryTags`, this function merges the provided tags with any existing tags
from an outer scope, with the new tags taking precedence for keys that exist in both.
Setting a key to `undefined` removes it from the merged result.

```typescript
function withMergedQueryTags<T>(tags: SqlCommenterTags, scope: () => PromiseLike<T>): Promise<T>
```

**Parameters:**

- `tags` - Key-value pairs to merge with existing tags. Keys with `undefined` values remove that key from the result.
- `scope` - An async function to execute within the tagged scope

**Returns:** The result of the scope function

## Examples

### Basic Usage

```typescript
const users = await withQueryTags({ requestId: 'abc-123', endpoint: '/api/users' }, () => prisma.user.findMany())
```

### Multiple Queries in One Scope

```typescript
const result = await withQueryTags({ traceId: 'trace-456' }, async () => {
  const users = await prisma.user.findMany()
  const posts = await prisma.post.findMany()
  return { users, posts }
})
```

### Merging Tags in Nested Scopes

Use `withMergedQueryTags` when you want to add tags without losing the outer context:

```typescript
// Set base tags at the request level
await withQueryTags({ requestId: 'req-123', source: 'api' }, async () => {
  // Add handler-specific tags while keeping requestId
  await withMergedQueryTags({ userId: 'user-456', source: 'handler' }, async () => {
    // Queries here will have: requestId='req-123', userId='user-456', source='handler'
    await prisma.user.findMany()
  })
})
```

### Removing Tags in Nested Scopes

Use `undefined` to explicitly remove a tag set by an outer scope:

```typescript
await withQueryTags({ requestId: 'req-123', debug: 'true' }, async () => {
  // Remove 'debug' tag for this inner scope
  await withMergedQueryTags({ userId: 'user-456', debug: undefined }, async () => {
    // Queries here will have: requestId='req-123', userId='user-456' (debug removed)
    await prisma.user.findMany()
  })
})
```

### Combining with Other Plugins

```typescript
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

const appPlugin: SqlCommenterPlugin = () => ({
  application: 'my-app',
  version: '1.0.0',
})

const prisma = new PrismaClient({
  adapter: myAdapter,
  comments: [appPlugin, queryTags()], // Tags from both plugins are merged
})
```

### Request Context in Web Frameworks

For `withQueryTags` to work correctly, all database queries must execute **inside** the callback scope. This requires proper async middleware that awaits downstream handlers (Hono, Koa), or wrapping handlers/services directly (Express, Fastify, NestJS).

#### Hono

Hono's middleware properly awaits downstream handlers, making it ideal for request-scoped tagging:

```typescript
import { createMiddleware } from 'hono/factory'

app.use(
  createMiddleware(async (c, next) => {
    await withQueryTags(
      {
        route: c.req.path,
        method: c.req.method,
        requestId: c.req.header('x-request-id') ?? crypto.randomUUID(),
      },
      () => next(),
    )
  }),
)
```

#### Koa

Koa's middleware properly awaits downstream handlers:

```typescript
app.use(async (ctx, next) => {
  await withQueryTags(
    {
      route: ctx.path,
      method: ctx.method,
      requestId: ctx.get('x-request-id') || crypto.randomUUID(),
    },
    () => next(),
  )
})
```

#### Fastify

Wrap individual route handlers since hooks complete before the handler runs:

```typescript
fastify.get('/users', (request, reply) => {
  return withQueryTags(
    {
      route: '/users',
      method: 'GET',
      requestId: request.id,
    },
    () => prisma.user.findMany(),
  )
})
```

#### Express

Express middleware uses callbacks, so `next()` returns immediately without waiting for downstream handlers. Wrap route handlers directly instead:

```typescript
app.get('/users', (req, res, next) => {
  withQueryTags(
    {
      route: req.path,
      method: req.method,
      requestId: req.header('x-request-id') ?? crypto.randomUUID(),
    },
    () => prisma.user.findMany(),
  )
    .then((users) => res.json(users))
    .catch(next)
})
```

#### NestJS

Use an interceptor, which properly wraps the handler execution:

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable, from } from 'rxjs'

@Injectable()
export class QueryTagsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    return from(
      withQueryTags(
        {
          route: request.path,
          method: request.method,
          requestId: request.header('x-request-id') ?? crypto.randomUUID(),
        },
        () => lastValueFrom(next.handle()),
      ),
    )
  }
}

// Apply globally in main.ts
app.useGlobalInterceptors(new QueryTagsInterceptor())
```

## How It Works

This package uses Node.js `AsyncLocalStorage` to maintain context across async operations. When you call `withQueryTags()` or `withMergedQueryTags()`, the tags are stored in the async local storage context. The `queryTags()` plugin retrieves these tags when Prisma executes queries within that scope.

**Key behaviors:**

- Tags are scoped to the callback and don't leak to queries outside
- `withQueryTags` replaces the outer tags entirely in nested calls
- `withMergedQueryTags` merges with outer tags, with new tags taking precedence for duplicate keys; `undefined` values remove keys
- Multiple `queryTags()` plugin instances share the same `AsyncLocalStorage` context
- Tags from multiple plugins are merged, with later plugins overriding earlier ones for the same key

## License

Apache-2.0
