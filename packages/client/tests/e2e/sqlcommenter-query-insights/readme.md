# SQL Commenter Query Insights E2E Test

This test verifies that the `@prisma/sqlcommenter-query-insights` plugin correctly adds parameterized query shape information to SQL comments.

## What it tests

1. Query shapes are correctly formatted as `Model.action:base64Payload`
2. Raw queries are formatted as just the action (e.g., `queryRaw`)
3. User data values are parameterized (replaced with `{"$type":"Param"}`)
4. Structural values (pagination, sort directions) are preserved
5. Compacted batch queries include all queries in the payload array

## Running locally

```bash
pnpm install
pnpm prisma generate
pnpm exec prisma db push --force-reset
tsx src/index.ts
```
