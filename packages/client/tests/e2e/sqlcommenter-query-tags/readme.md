# SQL Commenter Query Tags E2E Test

This test verifies that the `@prisma/sqlcommenter-query-tags` package works correctly end-to-end with a real database.

## What it tests

- The `queryTags()` plugin correctly retrieves tags from `AsyncLocalStorage`
- The `withQueryTags()` function properly sets tags for the scope of its callback
- The `withMergedQueryTags()` function properly merges tags with existing context
- Tags are isolated to their scope and don't leak to queries outside
- Nested `withQueryTags` calls work correctly (inner scope replaces outer scope)
- Nested `withMergedQueryTags` calls work correctly (inner scope merges with outer scope)

## Setup

- Uses SQLite with the `better-sqlite3` driver adapter
- Uses the `@prisma/sqlcommenter-query-tags` package for the query tags functionality
- Captures query events via `$on('query', ...)` to verify comments in SQL

## Running the test

```bash
pnpm --filter @prisma/client test:e2e --verbose sqlcommenter-query-tags
```
