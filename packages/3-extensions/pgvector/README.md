# @internal/extension-pgvector

PostgreSQL pgvector extension pack for Prisma Next.

## Overview

This extension pack adds support for the `vector` data type and vector similarity operations (e.g., cosine distance) for PostgreSQL databases with the pgvector extension installed.

## Responsibilities

- **Vector Codec**: Provides codec for `pg/vector@1` mapping to `number[]` at runtime, and a `Vector<N>` type for dimensioned typing in `contract.d.ts`
- **Vector Operations**: Registers vector similarity operations (e.g., `cosineDistance`) for use in queries
- **CLI Integration**: Provides extension descriptor for `prisma.config.ts` configuration
- **Runtime Extension**: Registers codecs and operations at runtime for vector column operations
- **Pack Ref Export**: Ships a pure `/pack` entrypoint for TypeScript contract authoring without runtime filesystem access
- **Baseline Migration**: Ships an on-disk baseline migration in its contract space that installs the `vector` Postgres extension (`CREATE EXTENSION IF NOT EXISTS vector`) when the extension is composed into an application

## Installation

```bash
pnpm add @internal/extension-pgvector
```

## Database Setup

The pgvector extension ships an on-disk baseline migration in its contract space; applying that migration installs pgvector with `CREATE EXTENSION IF NOT EXISTS vector`. When the extension is composed into an application via `extensions`, `prisma db init` and `prisma db update` apply the baseline (and any subsequent migrations) automatically.

For manual database setup, the equivalent DDL is:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Ensure the baseline migration (or equivalent DDL) has been applied before running workloads that use vector columns.

## Configuration

Add the extension to your `prisma.config.ts`:

```typescript
import { defineConfig } from '@internal/cli/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import pgvector from '@internal/extension-pgvector/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [pgvector],
});
```

## Usage

### Contract Definition

Add vector columns to your contract and enable the namespace via pack refs:

```typescript
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import postgres from '@internal/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensions: { pgvector },
  models: {
    Post: model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        title: field.column(textColumn),
        // Dimensioned vector — `field.embedding` resolves to `Vector<1536>`.
        embedding: field.column(vector(1536)).optional(),
      },
    }).sql({ table: 'post' }),
  },
});
```

The `vector(N)` factory is registered through the unified `CodecDescriptor<{ length: number }>` shape — `paramsSchema` validates the dimension at the contract boundary, `renderOutputType: ({ length }) => 'Vector<' + length + '>'` produces the column's TS type for `contract.d.ts`, and the curried `factory` materializes the runtime codec at context construction. See [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) for the descriptor model. Every pgvector column must declare an explicit dimension via `vector(N)`; the runtime codec is constructed against `{ length: N }`, so an undimensioned form has no honest descriptor signature.

### Runtime Setup

Register the extension when creating your execution stack:

```typescript
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import pgvector from '@internal/extension-pgvector/runtime';

const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  extensions: [pgvector],
});
const context = createExecutionContext({ contract, stack });
const stackInstance = instantiateExecutionStack(stack);
```

### Query Usage

Use vector similarity operations in your queries:

```typescript
import { sql, tables } from '../prisma/query';
import { param } from '@internal/sql-query/param';
import type { ResultType } from '@internal/sql-query/types';

const queryVector = [0.1, 0.2, 0.3, /* ... */];

const plan = sql
  .from(tables.post)
  .select({
    id: tables.post.columns.id,
    title: tables.post.columns.title,
    distance: tables.post.columns.embedding.cosineDistance(param('queryVector')),
  })
  .orderBy(tables.post.columns.embedding.cosineDistance(param('queryVector')).asc())
  .limit(10)
  .build({ params: { queryVector } });

type Row = ResultType<typeof plan>;
```

## Types

### Codec Types

The extension provides:

- `CodecTypes` mapping the `pg/vector@1` type ID to `number[]` (runtime representation)
- `Vector<N>` type for dimensioned vector typing in emitted `contract.d.ts` and schema result types when the contract includes dimension metadata

```typescript
import type { CodecTypes, Vector } from '@internal/extension-pgvector/codec-types';

// CodecTypes['pg/vector@1']['output'] = number[]
// Vector<1536> is a branded number[] type used for dimensioned typing
```

### Operation Types

The extension provides an `OperationTypes` export for vector operations:

```typescript
import type { OperationTypes } from '@internal/extension-pgvector/operation-types';

// OperationTypes['pg/vector@1']['cosineDistance'] = (rhs: number[] | vector) => number
// OperationTypes['pg/vector@1']['cosineSimilarity'] = (rhs: number[] | vector) => number
```

## Operations

### cosineDistance

Computes the cosine distance between two vectors.

**Signature**: `cosineDistance(rhs: number[] | vector): number`

**SQL**: Uses the pgvector `<=>` operator: `vector1 <=> vector2`

**Example**:
```typescript
const distance = tables.post.columns.embedding.cosineDistance(param('queryVector'));
```

### cosineSimilarity

Computes the cosine similarity between two vectors (1 minus cosine distance).

**Signature**: `cosineSimilarity(rhs: number[] | vector): number`

**SQL**: Uses the pgvector `<=>` operator: `1 - (vector1 <=> vector2)`

**Example**:
```typescript
const similarity = tables.post.columns.embedding.cosineSimilarity(param('queryVector'));
```

## Capabilities

The extension declares the following capabilities:

- `pgvector.cosine`: Indicates support for cosine distance and similarity operations

## Authoring (maintainers)

After changing the contract source, run `pnpm migrations:regen` from the repo root to keep migration metadata, `refs/head.json`, and the `migrations/snapshots/<hex>/contract.*` store entries consistent with the freshly-built `src/contract.json`; it is also wired into `pnpm fixtures:emit` automatically.

See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) ("Contract-space package layout") for the layout and rationale.

## References

- [pgvector documentation](https://github.com/pgvector/pgvector)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
- [Extension Packs Guide](../../../docs/reference/Extension-Packs-Naming-and-Layout.md)
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)

Pack refs (`@internal/extension-pgvector/pack`) are pure data objects generated from the hydrated manifest (`src/core/manifest.ts`), so TypeScript contract builders can enable the pgvector namespace in both emit and no-emit workflows without touching the filesystem.
