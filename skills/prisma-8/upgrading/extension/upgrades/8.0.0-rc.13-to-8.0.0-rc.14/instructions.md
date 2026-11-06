---
from: "8.0.0-rc.13"
to: "8.0.0-rc.14"
changes:
  - id: engine-pin-moves-to-0-6-2
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.2` (up from 0.6.1). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.2`. With this engine the CLI prints its own name in hints and messages where it used to print a literal `{bin}`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.1"'
  - id: temporal-polyfill-is-a-peer-dependency
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-postgres` and `@prisma/orm-postgres`, not a dependency. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-postgres@"
        - "@prisma/orm-target-postgres@"
      anyMatch: true
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
      a value that is not an integer in the signed 32-bit range. The `mongo/string@1`,
      `mongo/bool@1`, `mongo/date@1`, `mongo/objectId@1` and `mongo/vector@1` codecs' `encode`
      refuse a value of the wrong type, and `mongo/binary@1` decodes a `Buffer` or `Uint8Array` as
      well as a `Binary`.
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
  - id: mongo-codec-types-carry-traits
    summary: |
      Each entry of the Mongo `CodecTypes` map (`@prisma/orm-mongo/target/codec-types`,
      `@internal/target-mongo/codec-types`) carries `traits`, the union of its codec descriptor's
      traits. The ORM's field accessor gives `inc` and `mul` to a field whose codec has the
      `numeric` trait, taking the codec's input type, and `FieldExpression` takes that operand
      type as an optional second type parameter.
  - id: mongo-field-builder-preset-not-optional
    summary: |
      The Mongo `FieldBuilder` (`@prisma/orm-mongo/contract-builder`,
      `@internal/mongo-contract-ts/contract-builder`)'s `optional` and `many` are properties whose type refuses a call when
      the builder carries execution defaults: a function whose `this` type is a string that says
      why. The widest constraint,
      `FieldBuilder<ContractFieldType, boolean, boolean, EnumTypeHandle | undefined, ExecutionMutationDefaultPhases | undefined>`,
      still accepts every builder.
---

# 8.0.0-rc.13 → 8.0.0-rc.14 — Extension author upgrade instructions

## `engine-pin-moves-to-0-6-2`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.1` to `0.6.2` and reinstall.

Engine 0.6.2 replaces the placeholder `{bin}` with the name of the CLI that was run. A hint that used to print as `{bin} db migrate` now prints as `prisma db migrate`. The replacement applies to next actions, warnings, errors, and summary and list text, in human, `--json`, and `--format markdown` output. Keep writing `{bin}` in the commands and messages your extension produces; the engine replaces it. If a test of yours runs the CLI and matches the literal text `{bin}` in its output, change it to match the CLI name.

## `temporal-polyfill-is-a-peer-dependency`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-postgres` or `@prisma/orm-postgres`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.

## `mongo-result-shape-includes-and-value-objects`

Replace `includeRelationNames: ['author']` with `includes: { author: shape }`, where `shape` describes the included document, for example `{ kind: 'document', nullable: true, fields }` for a to-one include with `fields` from `contractModelToMongoResultShape(targetModel, { valueObjects }).fields`, or an `array` of such documents for a to-many include. A shape of `{ kind: 'unknown' }` keeps the old behaviour of passing the included value through undecoded. Pass `valueObjects` (for example `domainValueObjectsAtDefaultNamespace(contract.domain)`) to decode value-object fields.

## `mongo-compile-query-value-objects`

Pass the contract's value objects, `domainValueObjectsAtDefaultNamespace(contract.domain) ?? {}`, as the fifth argument, and add `targetModel` (the related model's definition) to each include expression you build.

## `psl-unknown-field-preset-lists-presets`

Add the `authoringContributions` your interpreter already holds to each call.

## `mongo-double-codec-encodes-double`

Code that compares what the `mongo/double@1` codec's `encode` returns with a number unwraps it with `.valueOf()` or `Number(...)`. A test double or fixture that passed a fraction or an out-of-range number through the `mongo/int32@1` codec's `encode` now gets `RUNTIME.ENCODE_FAILED`; pass an integer. The same holds for a test double that passes a value of the wrong type through the string, boolean, date, ObjectId or vector codec, such as a number for an ObjectId; pass a 24-digit hex string or an `ObjectId`.

## `mongo-insert-results-carry-documents`

A driver of your own yields `{ insertedId, document }` for `insertOne`, where `document` is the command's document with the `_id` the database assigned, as the database stores it: serialise it with the database's BSON options and deserialise it again, as `BSON.deserialize(BSON.serialize(document, options), options)` does. It yields `{ insertedIds, insertedCount, documents }` for `insertMany`. Code that builds these results in a test double adds the same fields.

## `mongo-adapter-passes-bson-values-through`

This change has no detection pattern: it changes what reaches the driver, not how the adapter is called.

A codec or middleware that received a copied plain object in place of a `bson` class instance, and rebuilt the instance from it, now receives the instance. Remove the rebuilding.

## `mongo-codec-types-carry-traits`

This change has no detection pattern: few extensions build a Mongo codec types map themselves.

A type you declare to satisfy the Mongo `CodecTypes` shape, or a codec types map of your own that should get `inc` and `mul`, adds `traits` to each entry, such as `readonly traits: 'equality' | 'order' | 'numeric'` for a numeric codec.

## `mongo-field-builder-preset-not-optional`

This change has no detection pattern: few extensions implement `FieldBuilder` themselves. An object typed as a `FieldBuilder` that implements `optional()` and `many()` as methods assigns them through a cast to the conditional property types, as `createFieldBuilder` does, or builds the field with the contract builder's `field` helpers.
