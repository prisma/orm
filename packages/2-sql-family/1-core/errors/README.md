# @internal/sql-errors

SQL-normalized driver error types for Prisma 8.

## Package Classification

- **Domain**: sql
- **Layer**: core
- **Plane**: shared

## Overview

This package provides normalized error classes for SQL driver errors. These errors are shared across both migration-plane and runtime-plane code, allowing consistent error handling regardless of which driver is being used.

## Purpose

Normalize driver-specific errors (e.g., Postgres `pg` errors) into well-typed, SQL-family error classes that can be handled deterministically by migration runners, CLI commands, and other downstream systems.

## Responsibilities

- **Error Types**: Define `SqlQueryError` and `SqlConnectionError` classes
- **Type Predicates**: Provide `.is()` methods for safe error checking without `instanceof`
- **Stack Trace Preservation**: Preserve original error stack traces via ES2022 `Error.cause`

## Error Classes

### SqlQueryError

Represents query-related failures:
- Syntax errors
- Constraint violations
- Permission errors
- Other SQL execution errors

**Fields**:
- `kind`: `'sql_query'` (discriminator)
- `sqlState`: Postgres SQLSTATE code (e.g., `'23505'`)
- `constraint`: Constraint name if applicable
- `table`: Table name if applicable
- `column`: Column name if applicable
- `detail`: Additional detail from database

### SqlConnectionError

Represents connection-related failures:
- Connection timeouts
- Connection resets
- Connection refused
- Other connectivity issues

**Fields**:
- `kind`: `'sql_connection'` (discriminator)
- `transient`: Whether retry might succeed

## Usage

```typescript
import { SqlQueryError, SqlConnectionError } from '@internal/sql-errors';

// Check error type using type predicate (recommended)
if (SqlQueryError.is(error)) {
  console.log('SQLSTATE:', error.sqlState);
  console.log('Constraint:', error.constraint);
  console.log('Original stack:', error.cause?.stack);
}

// Create normalized error with original error preserved
const normalized = new SqlQueryError('Query failed', {
  cause: originalError,
  sqlState: '23505',
  constraint: 'user_email_unique',
});
```

## Architecture

This package is in the **shared plane**, meaning it can be imported by both migration-plane and runtime-plane packages. This allows drivers (runtime plane) and migration runners (migration plane) to use the same error types.

## Related Documentation

- `docs/architecture docs/subsystems/5. Adapters & Targets.md`: Driver architecture
- `docs/Error Handling.md`: Error handling patterns

