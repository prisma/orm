# @internal/mongo-contract-ts

Mongo-specific TypeScript contract authoring surface for Prisma 8.

## Purpose

This package provides the Mongo `contract.ts` DSL:

- `defineContract(...)`
- `field`, `index`, `model`, `rel`, and `valueObject` helpers
- callback and object-literal authoring forms

It also holds the builder every MongoDB contract source calls ([ADR 306](../../../../docs/architecture%20docs/adrs/ADR%20306%20-%20One%20plain-data%20definition%20and%20one%20builder%20per%20family.md)):

- `ContractDefinition` (`src/contract-definition.ts`) is a contract as plain data, with every name resolved. `defineContract` lowers its builder objects to it (`src/contract-lowering.ts`); Mongo PSL and the Prisma 6 reader produce it from their schemas.
- `buildMongoContractFromDefinition(definition, codecLookup, dataTypes)` (`src/build-contract.ts`, with stages in the `build-*.ts` files) checks every MongoDB family rule and returns the contract with its warnings, or every refusal with its warnings. Each refusal names its subject by a key the definition carries (`src/build-refusals.ts`). `defineContract` throws the first refusal as a `CONTRACT.*` error (`src/refusal-errors.ts`) and reports the warnings the source collected.

## Current Slice

The current implementation supports:

- aggregate roots and collection-backed models
- typed reference relations via `rel.belongsTo`, `rel.hasOne`, and `rel.hasMany`
- owned models via `owner` plus parent `storageRelations`
- discriminator-based polymorphism via `base`, `discriminator`, and `variants`
- top-level value objects referenced from fields
- Mongo collection index authoring via model-local `indexes`
- Mongo collection option authoring via model-local `collectionOptions`
- base Mongo codec helpers (`field.string()`, `field.int32()`, `field.json()`, `field.bson()` and the rest), listed with their codecs and application types in [Scalar types](../../../../docs/reference/scalar-types.md#mongodb); a read of a removed preset, such as `field.temporal.createdAt`, throws `CONTRACT.FIELD_HELPER_UNKNOWN`, with the preset's rewrite
- `.onCreate(call)` and `.onUpdate(call)` on a field builder, with a call from `gen` such as `field.date().onCreate(gen.now()).onUpdate(gen.now())`, which resolves by the field's codec through the generator functions of the packs when the contract is built; `gen` comes from the `defineContract` callback (or the facade's `gen` export) and holds only the functions the stack's packs declare, which for Mongo is `now`; a field with generated values cannot be a list, on a variant, on a model without a collection, or on a value object; it may be optional

This first slice does not yet cover union or dict authoring, or Mongo validator authoring.

## Exports

- `./contract-builder`: Mongo DSL entrypoint, and `ContractDefinition`, its nodes and `buildMongoContractFromDefinition`
- `./config-types`: config helper types

## Usage

```typescript
import mongoFamily from '@internal/family-mongo/pack';
import { defineContract, field, index, model, rel, valueObject } from '@internal/mongo-contract-ts/contract-builder';
import mongoTarget from '@internal/target-mongo/pack';

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    email: field.string(),
    homeAddress: field.valueObject(Address).optional(),
  },
  indexes: [
    index({ email: 1 }, { unique: true }),
  ],
  collectionOptions: {
    collation: { locale: 'en', strength: 2 },
  },
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    authorId: field.objectId().mongo({ field: 'author_id' }),
    title: field.string(),
  },
  relations: {
    author: rel.belongsTo(User, {
      from: 'authorId',
      to: User.ref('id'),
    }),
  },
});

export const contract = defineContract({
  family: mongoFamily,
  target: mongoTarget,
  valueObjects: { Address },
  models: { User, Post },
});
```

Each field is stored under its own name unless `.mongo({ field })` names another stored name, as `id` is stored as `_id` above. Relations, the discriminator and indexes name fields; the builder writes stored names into indexes, validators and execution defaults. A field of a value object is stored under its own name, so `.mongo({ field })` on one is refused.

## Config helper

`typescriptContract` and `typescriptContractFromPath` accept an optional third options bag with `defaultControlPolicy`. The specifier applies it only when the loaded contract omits `defaultControlPolicy`.

## Notes

- Use `@internal/family-mongo/pack` and `@internal/target-mongo/pack` in authoring flows. They are pure pack refs and do not pull in control-plane runtime code.
- Runtime validation and row inference live in `@internal/mongo-contract`.
- When you hoist reusable index or collection option objects, prefer `satisfies MongoIndexOptions` or `satisfies MongoCollectionOptions` from `@internal/mongo-contract` so TypeScript validates the supported Mongo option surface.
