---
changes:
  - id: mongo-index-name-required
    summary: |
      `MongoIndex` and `MongoIndexInput` (from `@prisma/orm-family-mongo/contract`) and `MongoSchemaIndex` and `MongoSchemaIndexOptions` (from `@prisma/orm-family-mongo/schema-ir`) have a required `name`, the name MongoDB stores the index under. `MongoSchemaIndex.id` is the name, where it was the keys. `MONGO_INDEX_OPTION_KEYS` and `indexLookupKey` leave the name out. `defaultMongoIndexName` moved from `@prisma/orm-family-mongo/query-ast/control` to `@prisma/orm-family-mongo/contract`, and `buildIndexOpId(verb, collection, name)` takes the index name in place of the keys.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bnew\s+(?:MongoIndex|MongoSchemaIndex)\s*\('
        - '\b(?:MongoIndexInput|MongoSchemaIndexOptions)\b'
        - '\b(?:defaultMongoIndexName|buildIndexOpId)\b'
  - id: mongo-index-calls-take-name
    summary: |
      `CreateIndexCall` and `DropIndexCall` (from `@prisma/orm-mongo/target/control`) take a third argument, `IndexCallOptions`: the index's `name` and its `createIndex` options. `schemaIndexToCreateIndexOptions` returns them with the name. `createIndex` and `dropIndex` (from `@prisma/orm-mongo/target/migration`) create and drop the index named `options.name`, or the name after the keys when it is missing. `createIndex` has two prechecks: no index with that name, and none with the same keys and options. `dropIndex` checks the name, keys and options before, and the name after. Labels name the index: `Create index email_1 on users (email:1)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bnew\s+(?:CreateIndexCall|DropIndexCall)\s*\('
        - '\bschemaIndexToCreateIndexOptions\b'
  - id: mongo-build-refusal-index-name-duplicate
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, from `@prisma/orm-family-mongo/contract-ts/contract-builder`, has the kind `indexNameDuplicate`, for two indexes of one collection with one name. The builder takes every index's name from its `options.name` and throws for an index without one. Call `nameIndexes(definition)`, from the same entry point, before `mergeRedundantIndexes` and the builder, to name each unnamed index after its stored keys, as Prisma 8 PSL and TypeScript do. `mergeRedundantIndexes` now merges only indexes with the same name.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bBuildRefusal\b'
        - '\bbuildMongoContractFromDefinition\b'
        - '\bmergeRedundantIndexes\b'
---

# MongoDB indexes carry their names

## `mongo-index-name-required`

Give every index you construct a name:

```ts
// before
new MongoIndex({ keys: [{ field: 'email', direction: 1 }], unique: true });
new MongoSchemaIndex({ keys: [{ field: 'email', direction: 1 }], unique: true });
// after
new MongoIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true });
new MongoSchemaIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true });
```

`defaultMongoIndexName(keys)` gives the name MongoDB gives an index created without one. Import it from `@prisma/orm-family-mongo/contract`:

```ts
// before
import { defaultMongoIndexName } from '@prisma/orm-family-mongo/query-ast/control';
// after
import { defaultMongoIndexName } from '@prisma/orm-family-mongo/contract';
```

Code that looked up an index of the schema IR by `id` with its keys, such as `'email:1'`, looks it up by name. Code that builds an operation id calls `buildIndexOpId('create', 'users', 'email_1')`.

## `mongo-index-calls-take-name`

```ts
// before
new CreateIndexCall('users', keys, { unique: true });
new DropIndexCall('users', keys);
// after
new CreateIndexCall('users', keys, { name: 'email_1', unique: true });
new DropIndexCall('users', keys, { name: 'email_1', unique: true });
```

Give `DropIndexCall` every option the index has, not only its name: its precheck requires an index with that name, those keys and exactly those options. Code that matches an operation's checks by position reads `createIndex`'s content check at `precheck[1]`; `precheck[0]` checks the name.

## `mongo-build-refusal-index-name-duplicate`

Code that switches over every `refusal.kind` handles `indexNameDuplicate`:

```typescript
switch (refusal.kind) {
  case 'indexNameDuplicate':
    return `${refusal.key.model}: another index of collection ${refusal.collection} is named ${refusal.name}`;
  // ...
}
```

Code that calls `buildMongoContractFromDefinition` names its indexes first:

```ts
const named = nameIndexes(definition);
const { definition: merged } = mergeRedundantIndexes(named, codecLookup, dataTypes);
const built = buildMongoContractFromDefinition(merged, codecLookup, dataTypes);
```

A source that reads a schema with its own naming rule, such as the Prisma 6 reader, sets `options.name` on each index itself.
