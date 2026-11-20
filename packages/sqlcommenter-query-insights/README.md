# @prisma/sqlcommenter-query-insights

A SQL commenter plugin for Prisma ORM that adds query shape information to SQL comments. This enables observability tools to analyze and group queries by their structural patterns rather than specific values.

## Installation

```bash
npm install @prisma/sqlcommenter-query-insights
```

## Usage

```typescript
import { prismaQueryInsights } from '@prisma/sqlcommenter-query-insights'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  adapter: myAdapter, // Driver adapter required (alternatively, Accelerate URL)
  comments: [prismaQueryInsights()],
})
```

The resulting SQL will include comments like:

```sql
SELECT ... FROM "User" /*prismaQuery='User.findMany:eyJ3aGVyZSI6eyJhY3RpdmUiOnsiJHR5cGUiOiJQYXJhbSJ9fSwiaW5jbHVkZSI6eyJwb3N0cyI6dHJ1ZX19'*/
```

## What It Does

This plugin adds a `prismaQuery` comment tag to every SQL query. The tag contains:

- **Model name**: The Prisma model being queried (e.g., `User`, `Post`)
- **Action**: The Prisma operation (e.g., `findMany`, `createOne`, `updateOne`)
- **Query shape**: A parameterized representation of the query structure (base64url encoded)

### Example Outputs

| Query Type               | Output Format                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| Raw query                | `queryRaw`                                                         |
| Simple find (all fields) | `User.findMany:e30`                                                |
| Find with where          | `User.findUnique:eyJ3aGVyZSI6eyJpZCI6eyIkdHlwZSI6IlBhcmFtIn19fQ`   |
| Find with include        | `User.findMany:eyJpbmNsdWRlIjp7InBvc3RzIjp0cnVlfX0`                |
| Find with select         | `User.findMany:eyJzZWxlY3QiOnsibmFtZSI6dHJ1ZX19`                   |
| Batched queries          | `User.findUnique:W3sid2hlcmUiOnsiaWQiOnsiJHR5cGUiOiJQYXJhbSJ9fX1d` |

## Security

**User data is never included in the comments.** All values that could contain user data are replaced with placeholder markers before encoding. This includes:

- Filter values (in `where` clauses)
- Data values (in `create`/`update` operations)
- Values in all filter operators (`equals`, `contains`, `in`, etc.)
- Tagged values (DateTime, Decimal, BigInt, Bytes, Json)

Only structural information is preserved:

- Field names and relationships
- Query structure (selection, filters, ordering)
- Pagination parameters (`take`, `skip`)
- Sort directions and null handling options

## Use Cases

### Query Analysis

Group queries by their shape to identify:

- Most frequently executed query patterns
- Slow query patterns that need optimization
- Unusual query patterns that might indicate bugs

### Observability Integration

The `prismaQuery` tag can be parsed by observability tools to:

- Create dashboards showing query pattern distribution
- Set up alerts for specific query patterns
- Correlate application behavior with database load

### Debugging

Quickly identify which Prisma operation generated a specific SQL query in your database logs.

## Combining with Other Plugins

```typescript
import { prismaQueryInsights } from '@prisma/sqlcommenter-query-insights'
import { traceContext } from '@prisma/sqlcommenter-trace-context'
import { queryTags, withQueryTags } from '@prisma/sqlcommenter-query-tags'

const prisma = new PrismaClient({
  adapter: myAdapter,
  comments: [prismaQueryInsights(), traceContext(), queryTags()],
})

// All tags are merged into the SQL comment
await withQueryTags({ route: '/api/users' }, () => prisma.user.findMany())
```

## API

### `prismaQueryInsights()`

Creates a SQL commenter plugin that adds query shape information.

```typescript
function prismaQueryInsights(): SqlCommenterPlugin
```

**Returns:** A `SqlCommenterPlugin` that adds the `prismaQuery` tag.

## Technical Details

For integrators building observability tools that parse these comments, see the [Embedder Documentation](./docs/embedder-guide.md).

## License

Apache-2.0
