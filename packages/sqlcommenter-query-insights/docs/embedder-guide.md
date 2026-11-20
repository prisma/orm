# Prisma Query Insights - Embedder Guide

This document is for developers building observability tools, database monitoring solutions, or query analyzers that want to parse and utilize the `prismaQuery` SQL comment tags.

## Overview

The `@prisma/sqlcommenter-query-insights` plugin adds a `prismaQuery` comment tag to SQL queries. This tag contains structured information about the Prisma operation that generated the query, encoded in a compact format suitable for SQL comments.

## Comment Format

The comment follows the [sqlcommenter specification](https://google.github.io/sqlcommenter/spec/):

```sql
SELECT ... FROM "User" /*prismaQuery='User.findMany:eyJ3aGVyZSI6eyJhY3RpdmUiOnsiJHR5cGUiOiJQYXJhbSJ9fSwiaW5jbHVkZSI6eyJwb3N0cyI6dHJ1ZX19'*/
```

## Tag Structure

The `prismaQuery` value has the following format:

```text
[ModelName.]Action[:Base64UrlEncodedPayload]
```

### Components

| Component                 | Required        | Description                                                      |
| ------------------------- | --------------- | ---------------------------------------------------------------- |
| `ModelName`               | No<sup>\*</sup> | The Prisma model name (e.g., `User`, `Post`).                    |
| `Action`                  | Yes             | The Prisma operation type (see [Actions](#actions) below).       |
| `Base64UrlEncodedPayload` | No<sup>\*</sup> | Base64url-encoded JSON containing the parameterized query shape. |

<sup>\*</sup> Raw queries (`queryRaw`, `executeRaw`) have no model name or payload.

### Examples

| Prisma Operation                                               | prismaQuery Value                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `prisma.$queryRaw()`                                           | `queryRaw`                                                         |
| `prisma.$executeRaw()`                                         | `executeRaw`                                                       |
| `prisma.user.findMany()`                                       | `User.findMany:e30`                                                |
| `prisma.user.findUnique({ where: { id: 1 } })`                 | `User.findUnique:eyJ3aGVyZSI6eyJpZCI6eyIkdHlwZSI6IlBhcmFtIn19fQ`   |
| `prisma.user.findMany({ include: { posts: true } })`           | `User.findMany:eyJpbmNsdWRlIjp7InBvc3RzIjp0cnVlfX0`                |
| `prisma.user.findMany({ select: { name: true, email: true }})` | `User.findMany:eyJzZWxlY3QiOnsibmFtZSI6dHJ1ZSwiZW1haWwiOnRydWV9fQ` |
| Batched `findUnique` calls                                     | `User.findUnique:W3sid2hlcmUiOnsiaWQiOnsiJHR5cGUiOiJQYXJhbSJ9fX1d` |

## Actions

The following Prisma actions may appear:

| Action                | Description                                 |
| --------------------- | ------------------------------------------- |
| `findUnique`          | Find a single record by unique identifier   |
| `findUniqueOrThrow`   | Find a single record or throw if not found  |
| `findFirst`           | Find the first matching record              |
| `findFirstOrThrow`    | Find the first matching record or throw     |
| `findMany`            | Find multiple records                       |
| `createOne`           | Create a single record                      |
| `createMany`          | Create multiple records                     |
| `createManyAndReturn` | Create multiple records and return them     |
| `updateOne`           | Update a single record                      |
| `updateMany`          | Update multiple records                     |
| `updateManyAndReturn` | Update multiple records and return them     |
| `deleteOne`           | Delete a single record                      |
| `deleteMany`          | Delete multiple records                     |
| `upsertOne`           | Update or create a single record            |
| `aggregate`           | Perform aggregation (count, sum, avg, etc.) |
| `groupBy`             | Group records by fields                     |
| `queryRaw`            | Execute raw SQL query                       |
| `executeRaw`          | Execute raw SQL statement                   |

## Decoding the Payload

### Step 1: Parse the Tag Value

```javascript
// Helper to decode base64url
function fromBase64Url(data) {
  // Node.js
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data, 'base64url').toString('utf-8')
  }
  // Browser: convert base64url to base64
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  const padding = (4 - (base64.length % 4)) % 4
  base64 += '='.repeat(padding)
  return atob(base64)
}

function parsePrismaQueryTag(value) {
  // URL-decode the value (sqlcommenter spec)
  const decoded = decodeURIComponent(value)

  const colonIndex = decoded.indexOf(':')

  if (colonIndex === -1) {
    // Raw query - no payload
    return {
      modelName: undefined,
      action: decoded,
      payload: undefined,
      isRaw: true,
    }
  }

  const prefix = decoded.slice(0, colonIndex)
  const base64UrlPayload = decoded.slice(colonIndex + 1)

  const dotIndex = prefix.indexOf('.')
  const modelName = prefix.slice(0, dotIndex)
  const action = prefix.slice(dotIndex + 1)

  // Decode base64url
  const jsonString = fromBase64Url(base64UrlPayload)
  const payload = JSON.parse(jsonString)

  return {
    modelName,
    action,
    payload,
    isRaw: false,
  }
}
```

### Step 2: Understand the Payload Structure

The payload is a JSON object representing the Prisma query in a format similar to the Prisma Client API. For single queries:

```typescript
interface QueryPayload {
  where?: FilterObject
  data?: DataObject
  orderBy?: OrderByObject
  take?: number
  skip?: number
  cursor?: CursorObject
  distinct?: string[]
  select?: SelectObject
  include?: IncludeObject
  // ... other arguments
}
```

For compacted (batched) queries, the payload is an array:

```typescript
type CompactedPayload = QueryPayload[]
```

## Query Shape Transformation

The plugin transforms the internal JSON protocol format into a Prisma-like query format for better readability.

## Parameterized Values

**Important:** All user data values are replaced with placeholder objects to ensure no sensitive data appears in SQL comments.

### Placeholder Format

```json
{ "$type": "Param" }
```

### Future Extension

In future versions, the placeholder may include additional metadata (field names are for illustration purposes only):

```json
{
  "$type": "Param",
  "name": "p1",
  "valueType": "String"
}
```

Your parser should handle both the current simple format and potential future extensions by checking for the `$type` field.

### Example: Parameterized Query

Original Prisma query:

```typescript
prisma.user.findMany({
  where: {
    email: { contains: 'secret@company.com' },
    age: { gte: 18 },
  },
  take: 10,
})
```

Decoded payload:

```json
{
  "where": {
    "email": { "contains": { "$type": "Param" } },
    "age": { "gte": { "$type": "Param" } }
  },
  "take": 10
}
```

Note: Structural values like `take` and `skip` are preserved, while user data values are parameterized.

## Preserved vs. Parameterized Values

### Preserved (Structural)

These values are part of the query shape and are NOT parameterized:

| Category           | Examples                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| Pagination         | `take`, `skip`                                                                      |
| Sort directions    | `"asc"`, `"desc"`                                                                   |
| Null handling      | `"first"`, `"last"`                                                                 |
| Query mode         | `"insensitive"`, `"default"`                                                        |
| Field references   | `{ "$type": "FieldRef", "value": { "_ref": "otherField", "_container": "Model" } }` |
| Selection booleans | `true` in field selections                                                          |

### Parameterized (User Data)

These values are replaced with `{ "$type": "Param" }`:

| Category       | Examples                                   |
| -------------- | ------------------------------------------ |
| Filter values  | String, number, boolean in `where` clauses |
| Data values    | All values in `create`/`update` data       |
| Tagged values  | DateTime, Decimal, BigInt, Bytes, Json     |
| Array elements | Values in `in`, `notIn` arrays             |

## Best Practices

### 1. Handle Unknown Actions Gracefully

New Prisma versions may introduce new actions. Parse unknown actions without failing:

```javascript
const KNOWN_ACTIONS = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'createOne',
  'updateOne',
  'deleteOne',
  // ... etc
])

function parseAction(action) {
  return {
    action,
    isKnown: KNOWN_ACTIONS.has(action),
  }
}
```

### 2. Handle Compacted Batches

When Prisma batches multiple queries into one SQL statement, the payload is an array. Check for this:

```javascript
function isCompactedBatch(payload) {
  return Array.isArray(payload)
}

function getQueryCount(parsed) {
  if (!parsed.payload) return 1
  if (Array.isArray(parsed.payload)) return parsed.payload.length
  return 1
}
```

## Version Compatibility

| ORM Version | Payload Format                 |
| ----------- | ------------------------------ |
| 7.x         | Current format documented here |

Additive changes (new action types, new fields in special objects like params, etc) are not considered breaking changes.

## Troubleshooting

### Invalid Base64url

If payload decoding fails:

1. Make sure you are decoding it as base64url and not standard base64
2. Convert base64url to standard base64 if your decoder doesn't support base64url natively (replace `-` with `+`, `_` with `/`, add padding)

### Unrecognized Payload Structure

If the payload structure doesn't match expectations:

1. Check the Prisma version — newer versions may have additional fields
2. Parse defensively with optional chaining
3. Report unrecognized fields rather than failing

## Support

For issues or questions:

- [GitHub](https://github.com/prisma/prisma/issues)
- [Documentation](https://www.prisma.io/docs)
