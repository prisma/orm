# @internal/extension-paradedb

ParadeDB full-text search extension pack for Prisma Next.

## Overview

This extension pack registers a `'bm25'` index type with the SQL family's index-type registry, so contracts can author BM25 full-text search indexes via the standard `constraints.index(...)` surface and the Postgres adapter emits `CREATE INDEX ... USING bm25 WITH (...)` DDL.

The v1 surface covers the `key_field` storage parameter only. Per-field tokenizer and column configuration is deferred to expression-index support.

## Responsibilities

- **bm25 index registration**: declares a `'bm25'` entry via `defineIndexTypes()` carrying an arktype validator for the bm25 options shape
- **Extension descriptor**: declares the `paradedb/bm25` capability for contract-level feature detection
- **Pack ref export**: ships a pure `/pack` entrypoint for TypeScript contract authoring

## Installation

```bash
pnpm add @internal/extension-paradedb
```

## Usage

### Contract definition

Author bm25 indexes via the standard `constraints.index(...)` surface; the registered `'bm25'` entry narrows `options` per-`type`:

```typescript
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import paradedb from '@internal/extension-paradedb/pack';
import postgres from '@internal/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensions: { paradedb },
  models: {
    Item: model('Item', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'items',
      indexes: [
        constraints.index([cols.body], {
          name: 'item_body_bm25_idx',
          type: 'bm25',
          options: { key_field: 'id' },
        }),
      ],
    })),
  },
});
```

### key_field

ParadeDB BM25 indexes require a `key_field` — a unique column that identifies each document. It is required, must be a string, and is typically (but not always) the table's primary key.

## Capabilities

- `paradedb/bm25` — indicates support for BM25 full-text search indexes

## Authoring (maintainers)

After changing the contract source, run `pnpm migrations:regen` from the repo root to keep migration metadata, `refs/head.json`, and the `migrations/snapshots/<hex>/contract.*` store entries consistent with the freshly-built `src/contract.json`; it is also wired into `pnpm fixtures:emit` automatically.

See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) ("Contract-space package layout") for the layout and rationale.

## Not yet implemented

- Per-column / per-expression tokenizer configuration (deferred to expression-index support)
- `@@@` operator and `pdb.*` query builder functions
- Scoring, aggregation, and highlight functions

## References

- [ParadeDB documentation](https://docs.paradedb.com/)
- [ParadeDB CREATE INDEX](https://docs.paradedb.com/documentation/indexing/create-index)
- [ADR 210 — Index-type registry](../../../docs/architecture%20docs/adrs/ADR%20210%20-%20Index-type%20registry.md)
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
