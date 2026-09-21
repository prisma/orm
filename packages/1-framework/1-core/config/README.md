# @internal/config

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Config authoring types and validation for `prisma.config.ts`.

## Overview

This package owns the shared config contract used by tooling and authoring packages:

- `PrismaNextConfig` and `ContractConfig` types
- contract source provider + diagnostics protocol
- provider-declared input metadata for tooling integrations
- `defineConfig()` normalization/defaulting
- `validateConfig()` structural/runtime-shape validation

## Responsibilities

- Type-safe config composition for `family`, `target`, `adapter`, optional `driver`, and optional `extensions` (`extensions` is rejected at runtime)
- Contract source provider protocol (`contract.source`) and diagnostics shape
- Tool-agnostic provider input metadata for build integrations via `contract.source.inputs`
- Pure config validation and normalization with no file system access

## Non-responsibilities

- Config file discovery/loading (`c12`, file I/O) - handled by `@internal/config-loader`
- CLI error envelope formatting and rendering - handled by CLI/errors package error utilities
- Control-plane migration operations and runtime actions

## Usage

```ts
import { defineConfig } from '@internal/config/config-types';
import { validateConfig } from '@internal/config/config-validation';

const config = defineConfig({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  contract: {
    source: {
      inputs: ['./prisma/schema.prisma'],
      load: async (_context) =>
        /* Result<Contract, ContractSourceDiagnostics> */ null as never,
    },
  },
});

validateConfig(config);
```

Declare `source.inputs` only for source files that are not already covered by the config module
graph, such as PSL schema paths or TypeScript contract paths passed as strings. Do not include
emitted artifact paths derived from `contract.output` (for example `contract.json` or the
colocated `contract.d.ts`); `@internal/config-loader` resolves and validates those paths
before emit/watch commands run. Tooling should always treat the config module graph as watched by default.
