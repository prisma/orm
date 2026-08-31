# @internal/sql-operations

SQL-specific operation types and registry for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: core
- **Plane**: shared

## Overview

This package provides SQL-specific operation types that extend the generic `OperationRegistry` from `@internal/operations` with SQL lowering specs. It lives in the shared plane to allow both migration-plane (emitter/CLI) and runtime-plane (lanes/runtime) packages to import operation types without violating plane boundaries. The package contains only types and pure helpers (no pack I/O, no manifest assembly); manifest assembly is handled by the CLI/tooling layer.

## Responsibilities

- **SQL Operation Types**: SQL-specific operation entry and descriptor types
  - `SqlOperationEntry`: Extends `OperationEntry` with a `lowering` field (`SqlLoweringSpec`)
  - `SqlOperationDescriptor`: Alias for `SqlOperationEntry` used at registration sites
  - `SqlOperationDescriptors`: `Readonly<Record<string, SqlOperationDescriptor>>` — the keyed-record shape adapter/extension `queryOperations()` factories return
  - `SqlLoweringSpec`: SQL-specific lowering specification (`targetFamily`, `strategy`, `template`)
  - `SqlOperationRegistry`: Typed registry alias (`OperationRegistry<SqlOperationEntry>`)

- **Registry Factory**: Typed factory for creating SQL operation registries
  - `createSqlOperationRegistry()`: Creates a typed `SqlOperationRegistry`

## Architecture

```mermaid
flowchart TD
    subgraph "Core Ring (Shared Plane)"
        OPS[@internal/operations]
        SQL_OPS[@internal/sql-operations]
    end

    subgraph "Tooling Ring (Migration Plane)"
        CLI[@internal/cli]
    end

    subgraph "Lanes Ring (Runtime Plane)"
        REL_CORE[@internal/sql-relational-core]
    end

    subgraph "Runtime Ring (Runtime Plane)"
        SQL_RUNTIME[@internal/sql-runtime]
    end

    OPS --> SQL_OPS
    CLI --> SQL_OPS
    SQL_OPS --> REL_CORE
    SQL_OPS --> SQL_RUNTIME
```

## Usage

### Creating and Using SQL Operation Registries

```typescript
import {
  createSqlOperationRegistry,
  type SqlOperationDescriptor,
} from '@internal/sql-operations';

const registry = createSqlOperationRegistry();

const descriptor: SqlOperationDescriptor = {
  self: { codecId: 'pg/vector@1' },
  impl: () => ({ returnType: { codecId: 'pg/float8@1', nullable: false } }),
};

registry.register('cosineDistance', descriptor);

const entries = registry.entries(); // Record<string, SqlOperationEntry>
```

### Assembling Operations from Extension Packs (CLI/Tooling)

For tooling code that works with extension packs, manifest assembly happens in the CLI layer. See `@internal/cli` for pack assembly utilities.

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
