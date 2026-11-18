# @internal/target-package-config

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

What every target package's `defineConfig` shares, and that depends on no database and no family.

## Package Classification

- **Domain**: targets
- **Layer**: shared
- **Plane**: shared

## Exports

### `@internal/target-package-config/type-declarations`

`restateTypeDeclarations(descriptor, module)` returns a copy of a target or adapter descriptor whose type declarations (`codecTypes.import`, `codecTypes.typeImports`, `codecTypes.parameterizedOutputTypes` and `queryOperationTypes.import`) all name `module`, each keeping its name and alias. A target package's `defineConfig` passes its own `contract-types` module, so an application on that package imports the target's and adapter's types from the one package it installs. A descriptor that declares no types is returned as it is.
