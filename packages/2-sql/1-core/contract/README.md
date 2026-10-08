# @internal/sql-contract

SQL contract types, validators, and IR factories for Prisma 8.

## Overview

This package provides TypeScript type definitions, Arktype validators, and factory functions for constructing SQL contract structures. It is located in the **shared plane**, making it available to both migration-plane (authoring, emitter) and runtime-plane (lanes, runtime) packages.

## Responsibilities

- **SQL Contract Types**: Defines SQL-specific contract types (`SqlContract`, `SqlStorage`, `StorageTable`, `SqlModelStorage`, `SqlModelFieldStorage`, `ForeignKeysConfig`) that extend framework-level contract types
- **Contract Validation**: Provides Arktype-based structural validators that the per-target `contractSerializer` SPI consumes for runtime-safe contract validation
- **IR Factories**: Provides pure factory functions for constructing contract IR structures in tests and authoring
- **Shared Plane Access**: Enables both migration-plane and runtime-plane packages to import SQL contract types without violating plane boundaries

## StorageColumn Structure

Each `StorageColumn` in SQL contracts includes:
- **`codecId`** (required): Codec identifier (e.g., `'pg/int4@1'`, `'pg/text@1'`, `'pg/vector@1'`) - used for query builders and runtime codecs
- **`dataType`** (required): the id of the data type the codec represents (e.g., `'pg/int4'`, `'pg/text'`, `'pgvector/vector'`). The contract build writes it from the codec. Migration planning and verification write the column's type name from this data type and `typeParams`; the contract stores no type name
- **`typeParams`** (optional): the type's parameters, for example `{ length: 1536 }` for `vector(1536)`
- **`nullable`** (required): Whether the column is nullable
- **`default`** (optional): Uses the shared `ColumnDefault` type from `@internal/contract` for db-agnostic defaults (literal or function). Client-generated defaults live in `execution.mutations.defaults`.

The database type a column holds comes from the data type its codec represents; see [ADR 254 — Data types and casts](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md). The SQL data type declarations and the functions that write their names are exported from `@internal/sql-contract/data-type`.

## Package Contents

- **TypeScript Types**: Type definitions for `SqlContract`, `SqlStorage`, `StorageTable`, `SqlModelStorage`, `SqlModelFieldStorage`, `ForeignKeysConfig`, and related types
- **Validators**: Arktype-based validators for structural validation of contracts, storage, and models
- **Factories**: Pure factory functions for constructing contract IR structures in tests and authoring

## Usage

### TypeScript Types

Import SQL contract types:

```typescript
import type {
  SqlContract,
  SqlStorage,
  StorageTable,
  SqlModelStorage,
  ForeignKeyIndex,
} from '@internal/sql-contract/types';
```

### What backs a foreign key

A stored `ForeignKey` says what serves its lookups on its own table in an optional `index` field, a `ForeignKeyIndex`:

```typescript
type ForeignKeyIndex =
  | { readonly name: string }          // an index of the table, by its stored name
  | { readonly primaryKey: true }      // the primary key, whose first columns are the foreign key's
  | { readonly unique: true };         // a unique constraint, whose first columns are the foreign key's
```

The field is absent when the relation says `index: false`. `materializeForeignKeysAndIndexes` sets it while building a contract, after a pass that removes indexes identical to another (`index-deduplication.ts`, using the planner's equality from `index-equivalence.ts`). Contract validation refuses an `index` its table does not have. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md).

### Referential Actions

`ForeignKey` supports optional `onDelete` and `onUpdate` fields of type `ReferentialAction`:

```typescript
type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};
```

When omitted, the database applies its default behavior (Postgres: `NO ACTION`). See [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md) for design rationale.

The `fk()` factory accepts referential actions via an options object:

```typescript
import { fk } from '@internal/sql-contract/factories';

// Simple FK (no referential actions)
const simple = fk(['userId'], 'user', ['id']);

// FK with onDelete cascade
const cascading = fk(['userId'], 'user', ['id'], { onDelete: 'cascade' });

// FK with name and both actions
const named = fk(['userId'], 'user', ['id'], {
  name: 'post_userId_fkey',
  onDelete: 'cascade',
  onUpdate: 'noAction',
});
```

**Semantic validation:** `validateStorageSemantics()` rejects `setNull` when the FK column is `NOT NULL` (the database would fail at runtime).

### Validators

Validate contract structures using Arktype validators:

```typescript
import { validateSqlContractFully, validateStorage, validateModel } from '@internal/sql-contract/validators';

// Validate a complete contract
const contract = validateSqlContractFully<Contract>(contractJson);

// Validate storage structure
const storage = validateStorage(storageJson);

// Validate model structure
const model = validateModel(modelJson);
```

Validate JSON-emitted contracts with mapping + logic checks via the
target descriptor's `contractSerializer` SPI:

```typescript
import postgresTarget from '@internal/target-postgres/control';

const contract = postgresTarget.contractSerializer.deserializeContract(contractJson);
```

`deserializeContract` parses the on-disk envelope, hydrates the SQL
Contract IR class hierarchy (`SqlStorage` → `StorageTable` → `StorageColumn`
/ `PrimaryKey` / …), and validates model-to-storage cross-references in
one pass. End-user app code typically calls the canonical façade instead
(e.g. `postgres<Contract>({ contractJson, … })`), which threads the same
SPI internally.

### Factories

Use factory functions to construct contract IR structures in tests:

```typescript
import { col, table, storage, model, contract, pk, unique, index, fk } from '@internal/sql-contract/factories';

// Create a column (dataType, codecId, nullable)
const idColumn = col('pg/int4', 'pg/int4@1', false);

// Create a table
const userTable = table(
  {
    id: col('pg/int4', 'pg/int4@1'),
    email: col('pg/text', 'pg/text@1'),
  },
  {
    pk: pk('id'),
    uniques: [unique('email')],
    indexes: [index('email')],
  }
);

// Create storage
const s = storage({ user: userTable });

// Create a model
const userModel = model('user', {
  id: { column: 'id' },
  email: { column: 'email' },
});

// Create a complete contract
const c = contract({
  target: 'postgres',
  storageHash: 'abc123',
  storage: s,
  models: { User: userModel },
});
```

## Exports

- `./types`: TypeScript type definitions
- `./validators`: Arktype validators for structural validation
- `./factories`: Factory functions for constructing contract IR
- `./pack-types`: Shared extension/pack typing helpers
- `./data-type`: SQL data type declarations (`sqlDataType`) and the functions that write a type name, print its catalog text, and recognise a reported type from those declarations (`renderSqlTypeName`, `renderSqlCatalogText`, `sqlBaseName`, `dataTypeParams`, `resolveReportedSqlType`)
- `./data-type-support`: the helpers SQL targets share to implement their data types and PSL entries (ADR 254): the number classifier, the JSON body reader and printer, `escapePslString`, the 64-bit integer canonical form, and `canonicalDateTime`, the reader the date and time types build their canonical form with

## Architecture

```mermaid
flowchart TD
    subgraph "SQL Contract Package (Shared Plane)"
        TYPES[Type Definitions]
        VALIDATORS[Validators]
        FACTORIES[IR Factories]
    end

    subgraph "Migration Plane"
        AUTHORING[Authoring]
        EMITTER[Emitter]
    end

    subgraph "Runtime Plane"
        LANES[Lanes]
        RUNTIME[Runtime]
    end

    TYPES --> AUTHORING
    TYPES --> EMITTER
    TYPES --> LANES
    TYPES --> RUNTIME
    VALIDATORS --> AUTHORING
    VALIDATORS --> EMITTER
    VALIDATORS --> RUNTIME
    FACTORIES --> AUTHORING
    FACTORIES --> EMITTER
```

## Related Packages

- `@internal/contract`: Framework-level contract types (`ContractBase`)
- `@internal/sql-contract-ts`: SQL contract authoring surface (uses this package)
- `@internal/emitter`: Contract emission engine (uses validators)

## Related Subsystems

- **[Data Contract](../../../docs/architecture%20docs/subsystems/1.%20Data%20Contract.md)**: Detailed subsystem specification
- **[Contract Emitter & Types](../../../docs/architecture%20docs/subsystems/2.%20Contract%20Emitter%20&%20Types.md)**: Contract emission

