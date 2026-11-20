# SQL Commenter Trace Context E2E Test

Tests that the `@prisma/sqlcommenter-trace-context` plugin correctly adds W3C Trace Context `traceparent` headers to SQL queries.

## What this test verifies

- The `traceContext()` plugin adds `traceparent` comments to SQL queries when tracing is enabled and sampled
- The `traceparent` comment is NOT added when tracing is enabled but NOT sampled (0% sampling rate)
- The `traceparent` comment is NOT added when tracing is disabled

## Setup

Uses `@prisma/adapter-better-sqlite3` with SQLite to test the SQL commenter functionality with OpenTelemetry tracing configured via `@prisma/instrumentation`.
