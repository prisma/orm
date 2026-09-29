---
changes:
  - id: mongo-result-shape-includes-and-value-objects
    summary: |
      `contractModelToMongoResultShape(model, options)` (`@prisma/orm-mongo/query-builder`,
      `@internal/mongo-query-builder`) takes `includes`, a map from relation name to the shape of
      the included document, instead of `includeRelationNames`, and an optional `valueObjects`
      map that makes value-object fields decode as documents. `contractFieldToMongoFieldShape`
      takes the same `valueObjects` as an optional second argument.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bincludeRelationNames\b'
  - id: mongo-compile-query-value-objects
    summary: |
      `compileMongoQuery(collection, state, storageHash, model, valueObjects)`
      (`@prisma/orm-mongo/orm`, `@internal/mongo-orm`) takes the contract's value objects as a
      fifth argument, and each `MongoIncludeExpr` in the state carries the related model as
      `targetModel`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcompileMongoQuery\('
  - id: psl-unknown-field-preset-lists-presets
    summary: |
      `reportUnknownFieldPreset(...)` (`@prisma/orm-framework/psl-parser/interpret`,
      `@internal/psl-parser/interpret`) takes the `authoringContributions` it looks the namespace's
      presets up in, and its message lists them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\breportUnknownFieldPreset\('
  - id: mongo-double-codec-encodes-double
    summary: |
      The `mongo/double@1` codec's `encode` (from `buildStandardCodecRegistry()` or
      `mongoStandardCodecs` in `@prisma/orm-mongo/target/codecs`, `@internal/target-mongo/codecs`)
      returns the driver's `Double` wrapping the number, so a whole number is stored as a BSON
      double; it refuses a value that is not a number. The `mongo/int32@1` codec's `encode` refuses
      a value that is not an integer in the signed 32-bit range.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "['\"]mongo/(?:double|int32)@1['\"]"
  - id: mongo-insert-results-carry-documents
    summary: |
      `InsertOneResult` and `InsertManyResult` (`@prisma/orm-mongo/query-ast/execution`,
      `@internal/mongo-query-ast/execution`) carry the inserted documents as stored: `document` on
      one, `documents` on the other, in insert order. A Mongo driver's `insertOne` and `insertMany`
      commands must yield them; the ORM returns them, decoded, from `create()` and `createAll()`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import[^;]*\bInsert(?:One|Many)Result\b[^;]*from\s*[''"]@(?:prisma/orm-mongo|internal/mongo-query-ast)/'
  - id: mongo-adapter-passes-bson-values-through
    summary: |
      The Mongo adapter's `resolveValue` passes an instance of a `bson` class (an object with a
      `_bsontype` tag and a class prototype), a `RegExp` and a `Uint8Array` through unchanged
      instead of copying their fields into a plain object, at any depth of a command.
  - id: mongo-field-builder-preset-not-optional
    summary: |
      The Mongo `FieldBuilder` (`@prisma/orm-mongo/contract-builder`,
      `@internal/mongo-contract-ts/contract-builder`)'s `optional` and `many` are properties whose type refuses a call when
      the builder carries execution defaults: a function whose `this` type is a string that says
      why. The widest constraint,
      `FieldBuilder<ContractFieldType, boolean, boolean, EnumTypeHandle | undefined, ExecutionMutationDefaultPhases | undefined>`,
      still accepts every builder.
---

## `mongo-result-shape-includes-and-value-objects`

Replace `includeRelationNames: ['author']` with `includes: { author: shape }`, where `shape` describes the included document, for example `{ kind: 'document', nullable: true, fields }` for a to-one include with `fields` from `contractModelToMongoResultShape(targetModel, { valueObjects }).fields`, or an `array` of such documents for a to-many include. A shape of `{ kind: 'unknown' }` keeps the old behaviour of passing the included value through undecoded. Pass `valueObjects` (for example `domainValueObjectsAtDefaultNamespace(contract.domain)`) to decode value-object fields.

## `mongo-compile-query-value-objects`

Pass the contract's value objects, `domainValueObjectsAtDefaultNamespace(contract.domain) ?? {}`, as the fifth argument, and add `targetModel` (the related model's definition) to each include expression you build.

## `psl-unknown-field-preset-lists-presets`

Add the `authoringContributions` your interpreter already holds to each call.

## `mongo-double-codec-encodes-double`

Code that compares what the `mongo/double@1` codec's `encode` returns with a number unwraps it with `.valueOf()` or `Number(...)`. A test double or fixture that passed a fraction or an out-of-range number through the `mongo/int32@1` codec's `encode` now gets `RUNTIME.ENCODE_FAILED`; pass an integer.

## `mongo-insert-results-carry-documents`

A driver of your own yields `{ insertedId, document }` for `insertOne`, where `document` is the command's document with the `_id` the database assigned, as the database stores it: serialise it with the database's BSON options and deserialise it again, as `BSON.deserialize(BSON.serialize(document, options), options)` does. It yields `{ insertedIds, insertedCount, documents }` for `insertMany`. Code that builds these results in a test double adds the same fields.

## `mongo-adapter-passes-bson-values-through`

This change has no detection pattern: it changes what reaches the driver, not how the adapter is called.

A codec or middleware that received a copied plain object in place of a `bson` class instance, and rebuilt the instance from it, now receives the instance. Remove the rebuilding.

## `mongo-field-builder-preset-not-optional`

This change has no detection pattern: few extensions implement `FieldBuilder` themselves. An object typed as a `FieldBuilder` that implements `optional()` and `many()` as methods assigns them through a cast to the conditional property types, as `createFieldBuilder` does, or builds the field with the contract builder's `field` helpers.
