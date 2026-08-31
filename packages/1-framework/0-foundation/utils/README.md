# @internal/utils

> **Internal package.** This package is an implementation detail of Prisma Next and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Shared utility functions for Prisma Next.

## Overview

This package provides general-purpose utility functions used across the Prisma Next codebase. These utilities are target-agnostic and have no dependencies on other Prisma Next packages.

## Utilities

### `ifDefined(key, value)`

Returns an object with the key/value if value is defined, otherwise an empty object. Use with spread to conditionally include optional properties while satisfying `exactOptionalPropertyTypes`.

```typescript
import { ifDefined } from '@internal/utils/defined';

// Instead of:
const obj = {
  required: 'value',
  ...(optional ? { optional } : {}),
};

// Use:
const obj = {
  required: 'value',
  ...ifDefined('optional', optional),
};
```

**Why use this?**

1. **Explicit**: You name exactly which properties are optional
2. **Intentional**: Won't accidentally strip other properties
3. **Type-safe**: Returns `{}` or `{ key: V }` (without undefined)
4. **exactOptionalPropertyTypes compatible**: Properly handles TypeScript's strict optional property checking

### `Result<T, F>`, `ok()`, `notOk()`, `okVoid()`

Generic Result type for representing success or failure outcomes. This is the standard way to return "expected failures" as values rather than throwing exceptions.

```typescript
import { type Result, ok, notOk, okVoid } from '@internal/utils/result';

// Success result with value
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return notOk('Division by zero');
  }
  return ok(a / b);
}

// Using the result
const result = divide(10, 2);
if (result.ok) {
  console.log(result.value); // 5
} else {
  console.error(result.failure); // error message
}

// Void success for validation
function validate(value: unknown): Result<void, string> {
  if (!value) {
    return notOk('Value is required');
  }
  return okVoid();
}
```

**Types:**
- `Ok<T>` - Success with value: `{ ok: true, value: T }`
- `NotOk<F>` - Failure with details: `{ ok: false, failure: F }`
- `Result<T, F>` - Discriminated union of `Ok<T> | NotOk<F>`

See `docs/Error Handling.md` for the full error taxonomy.

## Package Location

This package is part of the **framework domain**, **foundation layer**:
- **Domain**: framework (target-agnostic)
- **Layer**: foundation
- **Path**: `packages/1-framework/0-foundation/utils`
