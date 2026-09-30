# @internal/target-mongo

MongoDB target pack for Prisma 8.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codecs**: Owns the Mongo codecs, their descriptors and ids, the data types they represent, and the `CodecTypes` map emitted `contract.d.ts` files import
- **Migration operation factories**: Factory functions for MongoDB migration operations

## Entrypoints

- `./pack`: pure target pack ref used by `@internal/family-mongo` and `@internal/mongo-contract-ts`
- `./codecs`: codec descriptors, `mongoDescriptorById`, `mongoStandardCodecs`, and `buildStandardCodecRegistry`
- `./codec-ids`: codec id constants (`MONGO_STRING_CODEC_ID`, …)
- `./data-types`: the data types the codecs represent
- `./codec-types`: the `CodecTypes` map and the `Vector<N>` brand
- `./migration`: factory functions (the `Migration` base class is in `@internal/family-mongo/migration`)
- `./control`: `mongoTargetDescriptor` and `MongoMigrationRunner` for migration execution; the runner gets its database dependencies from the family instance (`MongoControlFamilyInstance.createRunnerDependencies`), which delegates to the control adapter on the stack
- `./schema-verify`: pure `verifyMongoSchema(...)` (no DB I/O); composes `contractToMongoSchemaIR` and `diffMongoSchemas` so the runner's post-apply verify step and `MongoFamilyInstance.schemaVerify` agree on "matches the contract" by construction

## Usage

### Contract definition

```typescript
import mongoFamily from '@internal/family-mongo/pack';
import { defineContract } from '@internal/mongo-contract-ts/contract-builder';
import mongoTarget from '@internal/target-mongo/pack';

const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
});
```

### Migration authoring

```typescript
import { MigrationCLI } from '@internal/cli/migration-cli';
import { Migration } from '@internal/family-mongo/migration';
import { createIndex, createCollection } from '@internal/target-mongo/migration';

class UsersMigration extends Migration {
  plan() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

export default UsersMigration;
MigrationCLI.run(import.meta.url, UsersMigration);
```

Run `tsx migration.ts` to produce `ops.json` and `migration.json` (when `describe()` is implemented). Use `--dry-run` to preview without writing.

### Available factories

- `createIndex(collection, keys, options?)` — create an index
- `dropIndex(collection, keys)` — drop an index
- `createCollection(collection, options?)` — create a collection
- `dropCollection(collection)` — drop a collection
- `setValidation(collection, schema, options?)` — set document validation on a collection
- `validatedCollection(name, schema, indexes)` — create a collection with a JSON Schema validator and indexes
