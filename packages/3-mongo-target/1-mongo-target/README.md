# @internal/target-mongo

MongoDB target pack for Prisma 8.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codec type surface**: Exposes the base Mongo codec type map used by authoring-time type composition
- **Migration operation factories**: Factory functions for MongoDB migration operations

## Entrypoints

- `./pack`: pure target pack ref used by `@internal/family-mongo` and `@internal/mongo-contract-ts`
- `./codec-types`: base Mongo codec type map
- `./migration`: factory functions (the `Migration` base class is in `@internal/family-mongo/migration`)
- `./control`: `MongoMigrationRunner` and `createMongoRunnerDeps` for runtime migration execution
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
