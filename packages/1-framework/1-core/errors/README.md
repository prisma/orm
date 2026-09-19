# @internal/errors

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Structured error types and factories for CLI and runtime error reporting.

## Overview

This package provides `CliStructuredError` (the shared error class) and factory functions for creating structured errors with error codes, fix suggestions, and machine-readable metadata. Errors are split across two entry points by domain:

- **`./control`** — CLI errors (`PN-CLI-4xxx`): config validation, file resolution, migration planning
- **`./execution`** — Runtime errors (`PN-RUN-3xxx`): contract verification, hash mismatch, database signing

## Usage

```ts
import { CliStructuredError, errorConfigFileNotFound } from '@internal/errors/control';
import { errorHashMismatch } from '@internal/errors/execution';

// Create a CLI error
throw errorConfigFileNotFound('/path/to/config.ts');

// Create a runtime error
throw errorHashMismatch({ expected: 'abc123', actual: 'def456' });

// Type-guard check
if (CliStructuredError.is(caught)) {
  const envelope = caught.toEnvelope();
  // { ok: false, code: 'CONFIG.FILE_NOT_FOUND', severity: 'error', summary: '...', nextActions: [...], ... }
  // `nextActions` is always present on the envelope — `[]` when the error carries none.
}
```

## Entry points

| Entry point | Domain | Code range | Contents |
|---|---|---|---|
| `./control` | CLI | `PN-CLI-4xxx` | `CliStructuredError` class, `CliErrorEnvelope`/`CliErrorConflict` types, 14 CLI factory functions, `errorUnexpected` |
| `./execution` | RUN | `PN-RUN-3xxx` | 8 runtime factory functions, `ERROR_CODE_DESTRUCTIVE_CHANGES` constant |
