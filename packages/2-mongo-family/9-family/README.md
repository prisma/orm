# @internal/family-mongo

Mongo family descriptor and family pack for Prisma Next.

## Purpose

This package is the Mongo family integration point for both control-plane assembly and authoring-time pack composition. It provides:

- the Mongo `ControlFamilyDescriptor` used by configs and CLI flows
- the `MongoControlAdapter` SPI that lets adapters supply wire-level marker-ledger and introspection implementations
- family-shared verification and operation-preview helpers (`verifyMongoSchema`, `formatMongoOperations`)
- the pure-data Mongo family pack ref used by `contract.ts` authoring
- a cohesive dependency surface for the Mongo family, including `@internal/mongo-contract-ts`

## Responsibilities

- **Control-plane assembly**: Exposes `mongoFamilyDescriptor` and `createMongoFamilyInstance()` for validation and emission flows.
- **Family hook integration**: Wires `mongoEmission` from `@internal/mongo-emitter` into the family descriptor.
- **Adapter SPI**: Defines `MongoControlAdapter` — the contract `@internal/adapter-mongo` implements for marker-ledger CAS, ledger appends, and schema introspection. `MongoControlFamilyInstance` resolves the adapter from the control stack and dispatches wire-level work through it.
- **Family-shared verification**: Owns `verifyMongoSchema` (the structural diff against introspected `MongoSchemaIR`) and the `MongoSchemaVerifierBase` walk used by per-target verifiers.
- **Authoring-time family pack**: Exposes `@internal/family-mongo/pack` so `defineContract(...)` can bind a Mongo contract to the Mongo family without importing control-plane code.
- **Validation and emission**: Delegates Mongo contract validation to `@internal/mongo-contract` and contract emission to the shared emitter pipeline.

## Entrypoints

- `./control`: control-plane entrypoint exporting `mongoFamilyDescriptor`, `createMongoFamilyInstance`, `MongoControlFamilyInstance`, and family-shared helpers (`contractToMongoSchemaIR`, `formatMongoOperations`, `diffMongoSchemas`)
- `./control-adapter`: SPI surface — `MongoControlAdapter` and `MongoControlAdapterDescriptor`, implemented by `@internal/adapter-mongo`
- `./ir`: Mongo family IR abstract bases (`MongoContractSerializerBase`, `MongoSchemaVerifierBase`) extended by target packages. The concrete `MongoStorage` storage class lives in the foundation package `@internal/mongo-contract`.
- `./migration`: migration authoring — `Migration` class, factory functions, and strategies (re-exported from `@internal/target-mongo/migration`)
- `./pack`: pure pack ref for TypeScript authoring flows such as `@internal/mongo-contract-ts/contract-builder`
- `./schema-verify`: family-shared `verifyMongoSchema(...)`. The CLI `db verify --schema-only` path and the `MongoMigrationRunner` post-apply verify step both call into this shared verifier, so both surfaces agree on "matches the contract" by construction

## Usage

### Control plane

```typescript
import { createControlStack } from '@internal/framework-components/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
});

const familyInstance = mongoFamilyDescriptor.create(stack);

const contract = familyInstance.deserializeContract(contractJson);
const result = await familyInstance.emitContract({ contract });
```

### TypeScript authoring

```typescript
import mongoFamily from '@internal/family-mongo/pack';
import { defineContract, field, model, rel, valueObject } from '@internal/mongo-contract-ts/contract-builder';
import mongoTarget from '@internal/target-mongo/pack';

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  storageRelations: {
    comments: { field: 'comments' },
  },
  fields: {
    _id: field.objectId(),
    type: field.string(),
    metadata: field.valueObject(Address).optional(),
  },
  relations: {
    comments: rel.hasMany('Comment'),
  },
  discriminator: {
    field: 'type',
    variants: {
      Bug: { value: 'bug' },
    },
  },
});

const Comment = model('Comment', {
  owner: Task,
  fields: {
    _id: field.objectId(),
    text: field.string(),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  valueObjects: { Address },
  models: { Task, Comment },
});
```

The current `contract.ts` slice supports roots and collections, typed reference relations, owned models with `storage.relations`, value objects, and discriminator-based polymorphism.

### Migration authoring

```typescript
import { MigrationCLI } from "@internal/cli/migration-cli"
import { Migration, createIndex, createCollection }
  from "@internal/family-mongo/migration"

class AddUsersCollection extends Migration {
  override describe() {
    return { from: "abc123", to: "def456", labels: ["add-users"] }
  }

  override get operations() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
        validationLevel: "strict",
      }),
      createIndex("users", [{ field: "email", direction: 1 }], { unique: true }),
    ]
  }
}

export default AddUsersCollection;
MigrationCLI.run(import.meta.url, AddUsersCollection);
```

Run `node migration.ts` to produce `ops.json` and `migration.json`. Use `--dry-run` to preview without writing.

## Package Structure

- `src/core/control-descriptor.ts`: `MongoFamilyDescriptor` implementation
- `src/core/control-instance.ts`: `createMongoFamilyInstance()` and `MongoControlFamilyInstance` — resolves the `MongoControlAdapter` from the control stack and dispatches wire-level work through it
- `src/core/control-adapter.ts`: `MongoControlAdapter` SPI definition
- `src/core/control-target-descriptor.ts`: `MongoControlTargetDescriptor` interface (concrete `mongoTargetDescriptor` lives in `@internal/target-mongo`)
- `src/core/ir/`: Mongo family IR abstract bases (`MongoContractSerializerBase`, `MongoSchemaVerifierBase`); the concrete `MongoStorage` class lives at `@internal/mongo-contract/ir/mongo-storage.ts`
- `src/core/operation-preview.ts`: family-shared `formatMongoOperations` / `mongoOperationsToPreview`
- `src/core/schema-verify/verify-mongo-schema.ts`: family-shared `verifyMongoSchema(...)`
- `src/core/mongo-migration.ts`: `MongoMigration` class (fixes the `Migration<TOperation>` type parameter to `MongoMigrationPlanOperation`)
- `src/exports/control.ts`: control-plane entrypoint
- `src/exports/control-adapter.ts`: adapter SPI entrypoint
- `src/exports/ir.ts`: IR abstract base entrypoint
- `src/exports/migration.ts`: migration authoring entrypoint
- `src/exports/pack.ts`: authoring-time family pack ref
- `src/exports/schema-verify.ts`: schema-verify entrypoint exposing the family-shared `verifyMongoSchema`
