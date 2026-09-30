# @internal/config

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Config authoring types and validation for `prisma.config.ts`.

## Overview

This package owns the shared config contract used by tooling and authoring packages:

- `PrismaNextConfig` and `ContractConfig` types
- contract source provider + diagnostics protocol
- provider-declared input metadata for tooling integrations
- `defineConfig()` normalization/defaulting
- `collectConfigIssues()` structural/runtime-shape validation

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
import { collectConfigIssues } from '@internal/config/config-validation';

const config = defineConfig({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  contract: {
    source: {
      format: 'psl',
      inputs: ['./prisma/schema.prisma'],
      load: async (_context) =>
        /* Result<Contract, ContractSourceDiagnostics> */ null as never,
    },
  },
});

const issues = collectConfigIssues(config);
```

Every source states the language of its inputs in `source.format`: `'psl'` or `'typescript'`. `collectConfigIssues` reports a missing `format` and any other value as an issue on `contract.source.format`. Tooling that reads the inputs itself, such as `contract format` and the language server, reads only a `'psl'` source's inputs.

Declare `source.inputs` only for source files that are not already covered by the config module
graph, such as PSL schema paths or TypeScript contract paths passed as strings. Do not include
emitted artifact paths derived from `contract.output` (for example `contract.json` or the
colocated `contract.d.ts`); `@internal/config-loader` resolves and validates those paths
before emit/watch commands run. Tooling should always treat the config module graph as watched by default.
