# @internal/config-loader

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Discovers and evaluates `prisma.config.ts`, and declares the `orm` section's schema.

## Overview

This package owns config _loading_ — the file I/O (`c12`) — and the declaration of the `orm`
section's shape (`ormConfigSchema`), from which the CLI engine derives validation, diagnostics and
the resolution of every path against the config file that wrote it. `loadConfig` runs that same
validation for readers outside a command run and turns a `prisma.config.ts` on disk into a
resolved `PrismaNextConfig`. It also
performs the emitter-derived artifact-collision check (`getEmittedArtifactPaths`).

`loadConfig(configPath?)` returns a `Result`. It fails with a `CliStructuredError` only when the file cannot serve at all: `CONFIG.FILE_NOT_FOUND`, `CONFIG.EVALUATION_FAILED` when evaluating it throws, or `CONFIG.VERSION_MARKER_MISSING` when it does not export a `definePrismaConfig` value. A file that loads but breaks the `orm` schema succeeds with `diagnostics`, one `CONFIG.VALIDATION_FAILED` per bad field, each naming the subsection it concerns. `requireConfigSections` then fails only when a subsection the caller reads has a diagnostic, so a tool that needs `contract` keeps working, with its paths resolved, when `migrations` is malformed.

The package also exports the pieces `loadConfig` is built from: `loadConfigFiles` evaluates the config chain and returns each file's sections as written, `evaluateConfigModule` returns one config file's raw default export, and `buildLoadedConfig` validates an `orm` section built in memory, resolving its paths against a given directory as if a `prisma.config.ts` there had written it.

## Usage

```ts
import { loadConfig, requireConfigSections } from '@internal/config-loader';

async function loadContractConfig() {
  const loaded = await loadConfig('prisma.config.ts');
  if (!loaded.ok) {
    // the file is missing, throws when evaluated, or is not a Prisma config: loaded.failure.code says which
    return undefined;
  }
  const sections = requireConfigSections(loaded.value, ['contract', 'formatter']);
  if (!sections.ok) {
    // a subsection this caller reads failed validation
    return undefined;
  }
  return sections.value;
}
```
