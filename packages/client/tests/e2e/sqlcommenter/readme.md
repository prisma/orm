# SQL Commenter E2E Test

This test verifies that the SQL commenter plugin feature works correctly end-to-end with a real database.

## What it tests

- Multiple plugins are combined and their comments are merged
- Later plugins override earlier ones for the same key (tests overlap behavior)
- Comments are correctly appended to SQL queries in sqlcommenter format

## Setup

- Uses SQLite with the `better-sqlite3` driver adapter
- Uses the `@prisma/sqlcommenter` package for plugin type definitions
- Captures query events via `$on('query', ...)` to verify comments in SQL

## Running the test

```bash
pnpm --filter @prisma/client test:e2e --verbose sqlcommenter
```
