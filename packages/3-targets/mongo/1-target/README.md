# @internal/target-mongo

MongoDB target pack for Prisma 8.

## Responsibilities

- **Target pack assembly**: Exports the MongoDB target pack for authoring and family composition
- **Target metadata**: Defines the stable Mongo target identity (`kind`, `familyId`, `targetId`, `version`, `capabilities`)
- **Codecs**: Owns the Mongo codecs, their descriptors and ids, the data types they represent, and the `CodecTypes` map emitted `contract.d.ts` files import
- **Date and time types**: An instant and a calendar date are BSON dates, a calendar date at midnight UTC; `mongo/time` and `mongo/duration` are BSON strings, a time of day with three fraction digits, `09:30:00.000`, and a duration as written ([ADR 315](../../../../docs/architecture%20docs/adrs/ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md)). The explicit types `DateJsDate` (`mongo/date@1`), `DateInstant`, `DateInstantString`, `DateString`, `DateTemporal`, `TimeString`, `TimeTemporal` and `DurationString` name one codec each (`src/core/date-time-codecs.ts`); the convenience types `DateTime`, `Date`, `Time` and `Duration` choose one of them with `as:` (`src/core/authoring.ts`, ADR 279). The calendar date codecs refuse a BSON date that is not at midnight UTC on read. A write refuses digits below a millisecond rather than rounding them. The `date` tag reads a date alone as its midnight in UTC; the `time` and `duration` tags write the other two. The database-agnostic logic comes from `@internal/type-implementations`. Only the control entry sets the `Temporal` fallback; without a global `Temporal` and with no control entry loaded, the Temporal codecs, when they decode, and the `instantNow`, `plainDateNow` and `plainTimeNow` generators raise `RUNTIME.TEMPORAL_UNAVAILABLE`.
- **Migration operation factories**: Factory functions for MongoDB migration operations

## Entrypoints

- `./pack`: pure target pack ref used by `@internal/family-mongo` and `@internal/mongo-contract-ts`. It also re-exports `CodecTypes`, `ParameterizedOutputTypesForTypeParams` and `Vector`, the types the pack metadata names, so an application that exports a contract built with this pack can emit declarations
- `./codecs`: codec descriptors, `mongoDescriptorById`, `mongoStandardCodecs`, and `buildStandardCodecRegistry`
- `./codec-ids`: codec id constants (`MONGO_STRING_CODEC_ID`, …)
- `./data-types`: the data types the codecs represent
- `./codec-types`: the `CodecTypes` map, the `Vector<N>` brand, and `ParameterizedOutputTypesForTypeParams`, the type function that gives a vector field with a `length` type parameter the type `Vector<N>`; both `defineContract` and the emitted `contract.d.ts` apply it
- `./migration`: factory functions (the `Migration` base class is in `@internal/family-mongo/migration`)
- `./runtime`: the runtime target descriptor, and `mongoNowGenerators`, the `now()` generators of the date and time codecs, which the adapter registers
- `./control`: sets the fallback `Temporal` when it is loaded; `mongoTargetDescriptor` and `MongoMigrationRunner` for migration execution; the runner gets its database dependencies from the family instance (`MongoControlFamilyInstance.createRunnerDependencies`), which delegates to the control adapter on the stack
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
