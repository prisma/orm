# @prisma/sqlcommenter

Type definitions for SQL commenter plugins in Prisma Client.

## Overview

This package provides TypeScript types for creating SQL commenter plugins that add metadata to SQL queries as comments. The comments follow the [sqlcommenter format](https://google.github.io/sqlcommenter/) developed by Google.

SQL comments are useful for:

- **Observability**: Correlate database queries with application traces using `traceparent`
- **Query Insights**: Tag queries with metadata for analysis in database monitoring tools
- **Debugging**: Add custom context to queries for easier troubleshooting

## Installation

```bash
npm install @prisma/sqlcommenter
```

## Usage

### Creating a Plugin

A SQL commenter plugin is a function that receives query context and returns key-value pairs to be added as comments:

```typescript
import type { SqlCommenterPlugin, SqlCommenterContext } from '@prisma/sqlcommenter'

const myPlugin: SqlCommenterPlugin = (context: SqlCommenterContext) => {
  return {
    application: 'my-app',
    version: '1.0.0',
  }
}
```

### Using Plugins with PrismaClient

Pass your plugins to the `comments` option when creating a PrismaClient instance:

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` })

const prisma = new PrismaClient({
  adapter,
  comments: [myPlugin],
})
```

### First-Party Plugins

- [`@prisma/sqlcommenter-query-tags`](https://www.npmjs.com/package/@prisma/sqlcommenter-query-tags): appends arbitrary tags to all queries within an async context.
- [`@prisma/sqlcommenter-trace-context`](https://www.npmjs.com/package/@prisma/sqlcommenter-trace-context): appends `traceparent` comments to SQL queries for distributed tracing.
- [`@prisma/sqlcommenter-query-insights`](https://www.npmjs.com/package/@prisma/sqlcommenter-query-insights): enables query insights for [Prisma Postgres](https://www.prisma.io/postgres).

### Query Context

Plugins receive a `SqlCommenterContext` object with information about the query being executed.

See [API Reference](#api-reference) for more details.

### Conditional Keys

Plugins return a `SqlCommenterTags` object where keys can have `undefined` values. Keys with `undefined` values are automatically filtered out from the final comment:

```typescript
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

const conditionalPlugin: SqlCommenterPlugin = (context) => ({
  model: context.query.modelName, // undefined for raw queries, automatically omitted
  action: context.query.action,
  // Include SQL length only when available (not available with Accelerate)
  sqlLength: context.sql ? String(context.sql.length) : undefined,
})
```

### Example: Custom Application Tags

```typescript
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

const applicationTags: SqlCommenterPlugin = (context) => ({
  application: 'my-service',
  environment: process.env.NODE_ENV ?? 'development',
  operation: context.query.action,
  model: context.query.modelName, // automatically omitted if undefined
})
```

### Example: Async Context Propagation

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

const routeStorage = new AsyncLocalStorage<{ route: string }>()

const routeContext: SqlCommenterPlugin = () => ({
  route: routeStorage.getStore()?.route,
})
```

## Output Format

The plugin outputs are merged, sorted by key, URL-encoded, and formatted according to the [sqlcommenter specification](https://google.github.io/sqlcommenter/spec/):

```sql
SELECT "id", "name" FROM "User" /*application='my-app',environment='production',model='User'*/
```

## API Reference

### `SqlCommenterTags`

```typescript
type SqlCommenterTags = { readonly [key: string]: string | undefined }
```

Key-value pairs to add as SQL comments. Keys with `undefined` values are automatically filtered out and will not appear in the final comment.

### `SqlCommenterPlugin`

```typescript
interface SqlCommenterPlugin {
  (context: SqlCommenterContext): SqlCommenterTags
}
```

A function that receives query context and returns key-value pairs. Return an empty object to add no comments for a particular query. Keys with `undefined` values are automatically omitted.

### `SqlCommenterContext`

```typescript
interface SqlCommenterContext {
  query: SqlCommenterQueryInfo
  sql?: string
}
```

Context provided to plugins containing information about the query.

- **`query`**: Information about the Prisma query being executed. See [`SqlCommenterQueryInfo`](#sqlcommenterqueryinfo).
- **`sql`**: The SQL query being executed. It is only available when using driver adapters but not when using Accelerate.

### `SqlCommenterQueryInfo`

```typescript
type SqlCommenterQueryInfo =
  | ({ type: 'single' } & SqlCommenterSingleQueryInfo)
  | ({ type: 'compacted' } & SqlCommenterCompactedQueryInfo)
```

Information about the query or queries being executed.

- **`type: 'single'`**: A single Prisma query is being executed
- **`type: 'compacted'`**: Multiple queries have been batched into a single SQL statement (e.g., automatic `findUnique` batching)

### `SqlCommenterSingleQueryInfo`

```typescript
interface SqlCommenterSingleQueryInfo {
  modelName?: string
  action: SqlCommenterQueryAction
  query: unknown
}
```

Information about a single Prisma query.

- `modelName`: The model being queried (e.g., `"User"`, `"Post"`). Undefined for raw queries.
- `action`: The Prisma operation (e.g., `"findMany"`, `"createOne"`, `"queryRaw"`)
- `query`: The full query object with selection and arguments. Specifics of the query representation are not part of the public API yet.

### `SqlCommenterCompactedQueryInfo`

```typescript
interface SqlCommenterCompactedQueryInfo {
  modelName?: string
  action: SqlCommenterQueryAction
  queries: unknown[]
}
```

Information about a compacted batch query.

- `modelName`: The model being queried (e.g., `"User"`, `"Post"`).
- `action`: The Prisma operation (e.g., `"findUnique"`)
- `queries`: The full query objects with selections and arguments. Specifics of the query representation are not part of the public API yet.

## Notes

- Plugins are called synchronously in array order
- Later plugins override earlier ones if they return the same key
- Keys with `undefined` values are filtered out (they do not remove keys set by earlier plugins)
- Keys and values are URL-encoded per the sqlcommenter spec
- Single quotes in values are escaped as `\'`
- Comments are appended to the end of SQL queries

## License

Apache-2.0
