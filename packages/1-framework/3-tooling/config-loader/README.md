# @internal/config-loader

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Discovers, validates, and finalizes `prisma.config.ts`.

## Overview

This package owns config _loading_ — the file I/O (`c12`), validation, and finalization
that turns a `prisma.config.ts` on disk into a resolved `PrismaNextConfig`. It also
performs the emitter-derived artifact-collision check (`getEmittedArtifactPaths`).

Its main entry is `loadConfig(configPath?)`, which maps failures to the CLI's structured `@internal/errors/control` errors (`CliStructuredError`). Consumers that need to react to specific failures (e.g. the language server degrading on a missing/invalid config) branch on the structured error's stable `code` (`4001` = config file not found, `4009` = config validation). The package also exports the pieces `loadConfig` is built from: `evaluateConfigModule` returns a config file's raw default export, `buildLoadedConfig` validates and finalizes an `orm` section built in memory, and `finalizeConfig` resolves a config's paths.

## Usage

```ts
import { loadConfig } from '@internal/config-loader';
import { CliStructuredError } from '@internal/errors/control';

try {
  const config = await loadConfig('prisma.config.ts');
} catch (error) {
  if (error instanceof CliStructuredError && error.code === '4001') {
    // degrade gracefully on a missing config
  }
}
```
