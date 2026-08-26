# @internal/contract-authoring

**Status:** Shared descriptor types for family-specific contract authoring

This package holds the small, target-neutral descriptor vocabulary shared by Prisma Next authoring surfaces, targets, extensions, and ID helpers.

## Overview

`@internal/contract-authoring` is not the active TypeScript contract DSL. It exists to give multiple packages a common way to describe authored storage details without depending on SQL-specific packages.

## Responsibilities

- **Index descriptors**: `IndexDef` captures index column lists plus optional `name`, `using`, and `config`
- **Foreign key defaults**: `ForeignKeyDefaultsState` captures default FK materialization choices shared by authoring surfaces
- **Shared authoring vocabulary**: Gives target-family packages such as `@internal/sql-contract-ts` a target-neutral descriptor layer

`ColumnTypeDescriptor` lives in `@internal/framework-components/codec` alongside the codec types.

## Package Status

This package is the extracted shared descriptor layer from the contract authoring split. The current SQL TypeScript authoring implementation lives in `@internal/sql-contract-ts`.

## Architecture

- **No builders or lowering**: This package does not own `defineContract`, `field`, `model`, `rel`, or any lowering pipeline
- **No target-specific logic**: It must remain target-family agnostic and cannot import from `@internal/sql-*` or other family-specific modules
- **Shared by multiple layers**: SQL authoring, target packs, extension packs, and ID helpers all consume these types

## Exports

- `IndexDef`
- `ForeignKeyDefaultsState`

## Usage

This package is intended for internal composition. End-user contract authoring code should import from the family-specific surface, such as `@internal/sql-contract-ts`, rather than from this package directly.

## See Also

- `@internal/sql-contract-ts` - SQL TypeScript contract authoring surface
