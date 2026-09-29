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
      (`@internal/mongo-orm`) takes the contract's value objects as a fifth argument, and each
      `MongoIncludeExpr` in the state carries the related model as `targetModel`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcompileMongoQuery\('
  - id: psl-unknown-field-preset-lists-presets
    summary: |
      `reportUnknownFieldPreset(...)` (`@internal/psl-parser/interpret`) takes the
      `authoringContributions` it looks the namespace's presets up in, and its message lists them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\breportUnknownFieldPreset\('
  - id: mongo-double-codec-encodes-double
    summary: |
      `mongo/double@1` encode returns the driver's `Double` wrapping the number, so a whole number
      is stored as a BSON double; it refuses a value that is not a number. `mongo/int32@1` encode
      refuses a value that is not an integer in the signed 32-bit range.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bmongo(?:Double|Int32)Codec\.encode\('
  - id: mongo-field-builder-preset-not-optional
    summary: |
      The Mongo `FieldBuilder`'s `optional` and `many` are properties whose type refuses a call when
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

Code that compares what `mongoDoubleCodec.encode` returns with a number unwraps it with `.valueOf()` or `Number(...)`. A test double or fixture that passed a fraction or an out-of-range number through `mongoInt32Codec.encode` now gets `RUNTIME.ENCODE_FAILED`; pass an integer.

## `mongo-field-builder-preset-not-optional`

This change has no detection pattern: few extensions implement `FieldBuilder` themselves. An object typed as a `FieldBuilder` that implements `optional()` and `many()` as methods assigns them through a cast to the conditional property types, as `createFieldBuilder` does, or builds the field with the contract builder's `field` helpers.
