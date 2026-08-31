# @internal/sql-contract-emitter

SQL emitter hook for Prisma Next.

## Overview

This package provides the SQL-specific emitter hook implementation for the Prisma Next emitter. It validates SQL contracts and generates TypeScript type definitions for SQL contracts. It's part of the SQL tooling layer (migration plane) and implements the `TargetFamilyHook` interface.

## Responsibilities

- **Contract Validation**: Validates SQL contract structure and types
  - `validateTypes()`: Validates type IDs against referenced extensions (receives `ValidationContext` with `extensionIds`)
  - `validateStructure()`: Validates SQL-specific logical consistency (foreign key references, model-to-table mappings, constraint consistency). **Note**: Structural properties (required fields, types) are validated by Arktype schema validation - this function focuses on logical validation that schema validators can't perform.

- **Type Generation**: Generates TypeScript type definitions for SQL contracts
  - `generateContractTypes()`: Generates `contract.d.ts` file content (receives a `codecTypeImports` array)

## Architecture

```mermaid
flowchart TD
    subgraph "Framework Tooling Layer"
        EMITTER[@internal/emitter]
        CLI[@internal/cli]
    end

    subgraph "SQL Tooling Layer"
        SQL_EMITTER[@internal/sql-contract-emitter]
    end

    subgraph "SQL Core Layer (Shared Plane)"
        CT[@internal/sql-contract]
    end

    EMITTER --> SQL_EMITTER
    CT --> SQL_EMITTER
    SQL_EMITTER --> CLI
```

## Usage

### Using the SQL Emitter Hook

```typescript
import { emit } from '@internal/emitter';
import { sqlEmission } from '@internal/sql-contract-emitter';

const result = await emit(contractIR, options, sqlEmission);

// result.contractDts contains generated TypeScript types
// result.contractJson contains validated contract JSON
```

## Related Documentation

- [Package Layering](../../../../docs/architecture docs/Package-Layering.md)
- [ADR 140 - Package Layering & Target-Family Namespacing](../../../../docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md)
