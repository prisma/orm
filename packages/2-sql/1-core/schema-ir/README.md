# @internal/sql-schema-ir

SQL Schema Intermediate Representation (IR) types for Prisma Next.

## Overview

This package defines the core types for the SQL Schema IR, a target-agnostic representation of SQL database schemas. This IR is used for schema verification, migration planning, and other tooling operations within the SQL family.

## Purpose

- **Provide a canonical in-memory representation** of SQL schemas that is independent of specific database implementations
- **Decouple schema introspection from verification logic** - adapters produce `SqlSchemaIR`, verification logic consumes it
- **Enable extensible metadata** via annotations for targets and extension packs
- **Support future migration planning** by providing a structured representation of schema differences

## Responsibilities

- **Type Definitions**: Provides core types for SQL Schema IR (`SqlSchemaIR`, `SqlTableIR`, `SqlColumnIR`, etc.)
- **Shared Plane Package**: Located in the shared plane, making it accessible to both migration-plane and runtime-plane packages
- **Extensibility**: Supports annotations for targets and extension packs to attach metadata without modifying core IR structure
- **Type Safety**: Provides TypeScript types for schema representation with proper nullability and constraint modeling

## Types

### Core Types

- **`SqlSchemaIR`** - Complete database schema representation with tables, extensions, and annotations
- **`SqlTableIR`** - Table representation with columns, constraints, indexes, and annotations
- **`SqlColumnIR`** - Column representation with `nativeType` (DB-specific type), nullability, and annotations
- **`SqlForeignKeyIR`** - Foreign key constraint representation
- **`SqlUniqueIR`** - Unique constraint representation
- **`SqlIndexIR`** - Index representation
- **`SqlAnnotations`** - Namespaced extensibility metadata (e.g., `{ pg: { version: '15' } }`)

### Key Design Decisions

1. **Native type primary**: Columns capture the database-native type (`nativeType`, e.g., `'integer'`, `'vector'`). Codec IDs now live exclusively in the contract—schema IR focuses solely on what exists in the database. This keeps schema verification centered on actual storage, while contract metadata handles codec-level concerns.

2. **Annotations**: All IR types support optional `annotations` for extensibility. This allows targets and extensions to attach metadata without modifying the core IR structure.

3. **Shared Plane**: This package is in the **shared plane**, meaning it can be safely imported by both migration-plane (verification, migration planning) and runtime-plane code.

4. **Name-identified indexes**: `SqlIndexIR` is identified by its full physical name (its diff-tree `id` is the name, so same-column-tuple siblings and expression indexes are representable). Wire-named indexes carry a `prefix` plus a content-hash wire name; the shared naming helpers (`formatWireName`, `parseWireName`, `normalizeSqlBody`, `computeIndexContentHash`) live in `@internal/sql-schema-ir/naming`.

## Usage

### Basic Usage

```typescript
import type { SqlSchemaIR, SqlTableIR, SqlColumnIR } from '@internal/sql-schema-ir/types';

const schemaIR: SqlSchemaIR = {
  tables: {
    user: {
      name: 'user',
      columns: {
        id: {
          name: 'id',
          nativeType: 'integer',
          nullable: false,
        },
        email: {
          name: 'email',
          nativeType: 'text',
          nullable: false,
        },
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [{ columns: ['email'] }],
      indexes: [],
    },
  },
  extensions: ['vector'],
  annotations: {
    pg: {
      version: '15',
    },
  },
};
```

### Schema Introspection

Adapters produce `SqlSchemaIR` by querying database catalogs:

```typescript
// In Postgres adapter
import postgresAdapter from '@internal/adapter-postgres/control';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

const controlAdapter = postgresAdapter.createControlInstance();
const schemaIR: SqlSchemaIR = await controlAdapter.introspect(driver, contract);
```

### Schema Verification

Schema verification is performed via the `schemaVerify()` method on the SQL family instance:

```typescript
// In SQL family instance
import sql from '@internal/family-sql/control';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

// Create family instance
const familyInstance = sql.create({
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [],
});

// Schema verification is performed via family instance method
const result = await familyInstance.schemaVerify({
  driver,
  contractIR,
  strict: false,
  contractPath: './contract.json',
});
// schemaVerify internally calls adapter.introspect() to get schemaIR
```

## Architecture

### Package Location

- **Domain**: `sql`
- **Layer**: `core`
- **Plane**: `shared`

This package sits at the core layer in the shared plane, making it accessible to both migration-plane (authoring, tooling, targets) and runtime-plane (lanes, runtime, adapters) packages.

## Related Documentation

- `docs/briefs/11-schema-ir.md` - Schema IR project brief
- `docs/briefs/SQL Schema IR and Verification.md` - Detailed design document
- `packages/2-sql/3-tooling/family/src/core/instance.ts` - SQL family instance with `schemaVerify()` method
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts` - Postgres introspection entrypoint
