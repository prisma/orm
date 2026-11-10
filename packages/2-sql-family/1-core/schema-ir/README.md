# @internal/sql-schema-ir

SQL Schema Intermediate Representation (IR) types for Prisma 8.

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
- **`SqlColumnIR`** - Column representation with the data type it is stored as and that type's parameters in normal form (`storedType`, `storedTypeParams`), `typeText`, nullability, and annotations
- **`SqlForeignKeyIR`** - Foreign key constraint representation
- **`SqlUniqueIR`** - Unique constraint representation
- **`SqlIndexIR`** - Index representation
- **`SqlAnnotations`** - Namespaced extensibility metadata (e.g., `{ pg: { version: '15' } }`)

### Key Design Decisions

1. **Types compared as data types**: a column carries the data type it is stored as and that type's parameters in normal form (`storedType`, `storedTypeParams`): on the contract side from its codec, on the introspected side from the data type that claims the type the database reports. Verification and the planners compare columns by these with `sqlColumnTypesEqual` ([ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)). A contract column whose data type's name is its catalog text, such as a raw column, carries that text as `catalogText` instead, and compares it exactly with the other column's catalog text or reported text ([ADR 273](../../../../docs/architecture%20docs/adrs/ADR%20273%20-%20A%20column%20of%20a%20type%20no%20data%20type%20claims%20is%20a%20raw%20column.md)). `typeText` is the type as introspection reads it or as a migration writes it. Nothing compares it: mismatch messages and the schema tree show it, and the targets' default parsing reads it. `storedTypeParams` is only for comparing: DDL writes the parameters as written, from `codecRef.typeParams`.

2. **Annotations**: All IR types support optional `annotations` for extensibility. This allows targets and extensions to attach metadata without modifying the core IR structure.

3. **Shared Plane**: This package is in the **shared plane**, meaning it can be safely imported by both migration-plane (verification, migration planning) and runtime-plane code.

4. **Name-identified indexes**: `SqlIndexIR` is identified by its full physical name (its diff-tree `id` is the name, so same-column-tuple siblings and expression indexes are representable). Wire-named indexes carry a `prefix` plus a content-hash wire name; the shared naming helpers (`formatWireName`, `parseWireName`, `normalizeSqlBody`, `computeIndexContentHash`) live in `@internal/sql-schema-ir/naming`.

5. **Defaults as values**: a literal default is held as a value of the column's data type, `SqlDefaultValue` ([ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)). The contract side reads it with the column's type, introspection reads it with the column's codec, and `SqlColumnDefaultIR` compares the two with `sqlDefaultValuesEqual`. A default the codec could not read carries the codec's message, which the mismatch reports.

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
          typeText: 'integer',
          nullable: false,
        },
        email: {
          name: 'email',
          typeText: 'text',
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
- `packages/2-sql-family/3-tooling/family/src/core/instance.ts` - SQL family instance with `schemaVerify()` method
- `packages/3-targets/postgres/2-adapter/src/exports/control.ts` - Postgres introspection entrypoint
