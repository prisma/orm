# @internal/mongo-schema-ir

MongoDB Schema Intermediate Representation (IR) for migration diffing.

## Overview

This package defines the in-memory representation of MongoDB collection schemas used by the migration planner to diff desired vs. actual state. It provides an immutable AST of collections, indexes, validators, and collection options, plus a structural comparison helper.

## Responsibilities

- **Schema AST nodes**: `MongoSchemaIR` (root), `MongoSchemaCollection`, `MongoSchemaIndex`, `MongoSchemaValidator`, `MongoSchemaCollectionOptions` — frozen, visitable AST nodes representing MongoDB schema elements. `MongoSchemaIR` is the root node holding collections as sorted children with name-based lookup via `collection(name)`.
- **Index identity**: `MongoSchemaIndex` carries every option in `MONGO_INDEX_OPTION_KEYS`, so `indexLookupKey()` from `@internal/mongo-contract` identifies it as it identifies a contract index. The planner and the verifier match indexes this way.
- **Deep equality**: `deepEqual()` provides key-order-sensitive structural comparison for MongoDB values. For key-order-independent comparison, use `canonicalize()` from `@internal/mongo-contract`.
- **Visitor pattern**: `MongoSchemaVisitor<R>` enables extensible traversal without modifying AST nodes.

## Usage

```typescript
import {
  MongoSchemaIR,
  MongoSchemaCollection,
  MongoSchemaIndex,
} from '@internal/mongo-schema-ir';
import { indexLookupKey } from '@internal/mongo-contract';

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

indexLookupKey(index); // '{"keys":[["email",1]],"options":{"unique":true}}'
```

## Architecture

- **Domain**: `mongo`
- **Layer**: `tooling`
- **Plane**: `shared` (migration-plane)
