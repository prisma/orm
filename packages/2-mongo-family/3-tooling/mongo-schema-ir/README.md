# @internal/mongo-schema-ir

MongoDB Schema Intermediate Representation (IR) for migration diffing.

## Overview

This package defines the in-memory representation of MongoDB collection schemas used by the migration planner to diff desired vs. actual state. It provides an immutable AST of collections, indexes, validators, and collection options, plus comparison utilities for index equivalence.

## Responsibilities

- **Schema AST nodes**: `MongoSchemaIR` (root), `MongoSchemaCollection`, `MongoSchemaIndex`, `MongoSchemaValidator`, `MongoSchemaCollectionOptions` — frozen, visitable AST nodes representing MongoDB schema elements. `MongoSchemaIR` is the root node holding collections as sorted children with name-based lookup via `collection(name)`.
- **Index equivalence**: `indexesEquivalent()` compares two `MongoSchemaIndex` nodes field-by-field (keys, direction, unique, sparse, TTL, partial filter, wildcardProjection, collation, weights, default_language, language_override). Used by the planner to decide create/drop operations.
- **Deep equality**: `deepEqual()` provides key-order-sensitive structural comparison for MongoDB values. For key-order-independent comparison, use `canonicalize()`.
- **Canonical serialization**: `canonicalize()` produces a key-order-independent string representation of values. Used by the planner for index lookup keys.
- **Visitor pattern**: `MongoSchemaVisitor<R>` enables extensible traversal without modifying AST nodes.

## Usage

```typescript
import {
  MongoSchemaIR,
  MongoSchemaCollection,
  MongoSchemaIndex,
  indexesEquivalent,
} from '@internal/mongo-schema-ir';

const index = new MongoSchemaIndex({
  keys: [{ field: 'email', direction: 1 }],
  unique: true,
});

const collection = new MongoSchemaCollection({
  name: 'users',
  indexes: [index],
});

const ir = new MongoSchemaIR([collection]);

ir.collection('users');     // MongoSchemaCollection
ir.collectionNames;         // ['users']
ir.collections;             // sorted ReadonlyArray<MongoSchemaCollection>

indexesEquivalent(index, index); // true
```

## Architecture

- **Domain**: `mongo`
- **Layer**: `tooling`
- **Plane**: `shared` (migration-plane)
