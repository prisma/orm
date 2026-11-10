---
from: "8.0.0-rc.14"
to: "8.0.0-rc.15"
changes:
  - id: contract-stores-data-type
    summary: |
      A SQL contract names each column's data type in `dataType` (for example `pg/int4`) instead of
      its database type name in `nativeType`. Run the colocated script on the extension's contract
      space (it also writes lists in this release's new form), release the extension against the
      framework version that contains this change, and raise its peer dependency floor to that
      version: the old framework refuses a rewritten contract space and the new framework refuses
      an old one, so your users upgrade the framework and the extension in one step. Publish a
      `--data-type` line for each codec the extension owns.
    detection:
      glob: "**/*.json"
      matches:
        - '"nativeType"\s*:\s*"'
    script: ./scripts/data-type-in-contract/data-type-in-contract.ts
  - id: reemit-extension-list-contracts
    summary: Re-emit bundled extension contracts and reconcile changed snapshot hashes and references; for SQL contract spaces, `contract-stores-data-type` rewrites the historical snapshots.
  - id: consume-nested-list-cardinality
    summary: Update contract producers and consumers for explicit cardinality and nested element nullability.
  - id: sql-data-type-declares-names
    summary: |
      A SQL data type now declares how the database writes and reports it. Declare an extension's
      SQL data types with `sqlDataType(id, { params, texts, ... })` from
      `@internal/sql-contract/data-type` instead of `dataType(id, ...)`. Migrations, schema
      verification and PostgreSQL parameter casts read the column type's name from this
      declaration only.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$.])dataType\(\s*[''"][a-z0-9-]+/'
  - id: codec-target-types-removed
    summary: |
      `targetTypes` is removed from codec descriptors and templates, with `CodecLookup.targetTypesFor`
      and `CodecDescriptorRegistry.byTargetType`. A SQL codec's type names move to its data type's
      `texts`; a Mongo codec's BSON types move to its data type, declared with
      `mongoDataType(id, { bsonTypes })` from `@internal/mongo-contract/data-type`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\btargetTypes\b'
        - '\btargetTypesFor\b'
        - '\bbyTargetType\b'
  - id: native-type-rendering-hooks-removed
    summary: |
      The rendering hooks are removed: `CodecControlHooks.expandNativeType`, the protected
      `nativeType(params)` method of `PostgresCodecDescriptor` and its public `nativeTypeFor(ref)`,
      `NativeTypeExpander`, and the control adapter's `normalizeNativeType`. The data type's
      `texts` write the column type instead.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bexpandNativeType\b'
        - '\bprotected\s+override\s+nativeType\s*\('
        - '\bnativeTypeFor\b'
        - '\bNativeTypeExpander\b'
        - '\bnormalizeNativeType\b'
  - id: comments-name-removed-apis
    summary: |
      Comments that describe `expandNativeType`, `targetTypes` or the `nativeType()` hook describe
      code that no longer exists. Delete each such sentence, and say that a codec descriptor
      carries its data type where a comment lists target types or a native type among its parts.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?://|\*).*\b(?:expandNativeType|targetTypes)\b'
        - '(?://|\*).*\b(?:target types|native type|bare `nativeType)'
  - id: postgres-codec-takes-data-type
    summary: |
      `postgresCodec(template, options)` and `sqliteCodec(template, options)` take the data type
      object in `options.dataType`, not its id, and `postgresCodec` no longer takes a `nativeType`
      option. The adapted codec's `paramsSchema` is the data type's `params`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:postgresCodec|sqliteCodec)\s*\([^;]*?\bdataType\s*:\s*[\w$]+\.id\b'
        - '\bpostgresCodec\s*\([^;]*?\bnativeType\s*:'
  - id: codec-params-schema-is-data-type-params
    summary: |
      A codec's `paramsSchema` is its data type's `params`, referenced and not restated. Move the
      parameter schema and its bounds onto the data type, and point the codec at it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bparamsSchema\b[^;=]*=\s*(?:arktype|type)\s*\('
        - '\bconst\s+[\w$]*[pP]aramsSchema\s*=\s*(?:arktype|type)\s*\('
  - id: column-helper-checks-data-type-params
    summary: |
      A column helper no longer checks its arguments against bounds of its own. Delete the check:
      building the contract checks every column's parameters against its data type and raises
      `CONTRACT.TYPE_PARAMS_INVALID`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '[''"]CONTRACT\.ARGUMENT_INVALID[''"][^;]*\b(?:must be|non-negative|in the range|in \[)'
  - id: type-constructor-templates-lose-native-type
    summary: |
      A type constructor's or field preset's `output` no longer takes `nativeType`; it is
      `{ codecId, typeParams? }`. An argument mapped onto a data type parameter drops its `minimum`
      and `maximum`, because the data type's `params` checks it. A constructor may set
      `inferred: true`; at most one per data type.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\boutput\s*:\s*\{[^{}]*\bnativeType\s*:'
  - id: runtime-descriptor-registers-data-types
    summary: |
      A SQL runtime extension descriptor lists its `dataTypes`, the same list as its control
      descriptor, and `createPostgresAdapter({ codecDescriptors })` takes the matching `dataTypes`.
      The runtime writes PostgreSQL parameter casts from the data type a codec represents.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bSqlRuntimeExtensionDescriptor\s*<[^>]*>\s*=\s*\{(?=[^;]*\bcodecDescriptors\b)(?![^;]*\bdataTypes\b)'
        - '\bcreatePostgresAdapter\s*\(\s*\{(?=[^}]*\bcodecDescriptors\b)(?![^}]*\bdataTypes\b)'
  - id: column-descriptors-drop-native-type
    summary: |
      `ColumnTypeDescriptor` and authored `storage.types` entries lose `nativeType`, the pack
      metadata loses its `types.storage` list and `StorageTypeMetadata` is deleted, `column()`
      loses its fourth argument, and a codec descriptor's
      `columnFromEntity` returns `{ typeParams }` only. The contract takes a column's data type from
      its codec. A `types` constraint over what `type.*` helpers return is
      `Record<string, AuthoredStorageTypeInstance>` instead of `Record<string, StorageTypeInstance>`.
      `StorageTypeInstanceInput` takes `dataType`, the id of the data type the codec represents,
      in place of `nativeType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?<!readonly\s+)nativeType\s*:'
        - '(?<![\w$.])column\s*\((?:[^()]|\([^()]*\))*,(?:[^()]|\([^()]*\))*,(?:[^()]|\([^()]*\))*,\s*[\w''"](?:[^()]|\([^()]*\))*\)'
        - '\bRecord\s*<\s*string\s*,\s*StorageTypeInstance\s*>'
        - '\bStorageTypeInstanceInput\b'
        - '\bStorageTypeMetadata\b'
        - '\bstorage\s*:\s*\[\s*\{\s*typeId\b'
  - id: sqlite-data-types-are-stored-types
    summary: |
      The SQLite target declares only the types SQLite stores, plus the two character types:
      `sqlite/text`, `sqlite/integer`, `sqlite/real`, `sqlite/blob`, `sqlite/character` and
      `sqlite/character-varying`. `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are deleted:
      a codec, cast or authoring entry that names one fails assembly. The JSON and date-time codecs
      represent `sqlite/text`, the big integer codecs `sqlite/integer`. The date-time canonical form
      moves from `sqlite/datetime` to the codec `sqlite/datetime@1`, whose descriptor declares
      `toCanonicalForm`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '[''"`]sqlite/(?:json|datetime|bigint)[''"`]'
        - '\bsqlite(?:Json|Datetime|Bigint)\.id\b'
  - id: canonical-form-of-a-column
    summary: |
      A column's canonical form comes from one function, `canonicalFormOf(codec, dataTypes)` in
      `@internal/framework-components/codec`: the codec's `toCanonicalForm` when it declares one,
      else its data type's. `CanonicalDateTimeOptions.dataTypeId` is renamed `ownerId`.
      `SqlColumnDefaultIRInput` carries `toCanonicalForm` instead of `dataType`, and
      `SqlColumnIRInput` gains `toCanonicalForm`. `DefaultMappingOptions.columnDataType` is
      replaced by `columnCodec`, the column's codec descriptor.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bCanonicalDateTimeOptions\b'
        - '\bcanonicalDateTime\s*\('
        - '\bcolumnDataType\b'
        - '\bSqlColumnDefaultIR\b'
  - id: authoring-entry-key-checked
    summary: |
      Assembly refuses an authoring entry filed under the wrong key with
      `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`: an entry whose tag names the type it yields (`type`)
      sits under `tagEntryKey(tag)`, and an entry under a data type's id names no `type`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bkind\s*:\s*[''"]tag[''"]'
  - id: the-sql-tag-writes-the-sql-expression-data-type
    summary: |
      Lowering entries are removed. Every entry in `authoring.dataTypes` is a `DataTypeAuthoringEntry`
      keyed by a registered data type id, and `sql` is the tag of the data type `sql/expression`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(loweringEntryKey|isLoweringEntryKey|isDataTypeLoweringEntry)\b'
        - '\b(AuthoringDataTypeEntry|DataTypeLoweringAuthoringEntry|TaggedLiteralValue)\b'
        - '\bsqlDefaultLiteralTagEntry\b'
        - '\bcreate(Postgres|Sqlite)DataTypeEntries\b'
        - '\bPSL_INVALID_DEFAULT_SQL\b'
  - id: prefixed-sql-tags-are-removed
    summary: |
      The tags `pg.sql` and `sqlite.sql` are removed. Write `sql`.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '(?<![\w./-])(pg|sqlite)\s*\.\s*sql\s*\\?[\x60"'']'
  - id: default-diagnostic-codes-changed
    summary: |
      Four PSL diagnostic codes for written values changed: `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` is now `PSL_UNKNOWN_LITERAL_TAG`, `PSL_INVALID_JSON_LITERAL` is now `PSL_INVALID_LITERAL`, `PSL_DEFAULT_TYPE_INCOMPATIBLE` is now `PSL_VALUE_TYPE_INCOMPATIBLE`, or `PSL_DEFAULT_LIST_EXPECTED` for a single value on a list column, and most cases of `PSL_INVALID_DEFAULT_LITERAL` moved to `PSL_INVALID_LITERAL`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_INVALID_JSON_LITERAL\b'
        - '\bPSL_UNKNOWN_DEFAULT_LITERAL_TAG\b'
        - '\bPSL_DEFAULT_TYPE_INCOMPATIBLE\b'
        - '\bPSL_INVALID_DEFAULT_LITERAL\b'
  - id: resolve-identity-value-receives-data-type
    summary: |
      `CodecControlHooks.resolveIdentityValue` receives `dataType`, the id of the data type the
      column's codec represents, instead of `nativeType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bresolveIdentityValue\s*:\s*\(\s*\{[^}]*\bnativeType\b'
        - '\bResolveIdentityValueInput\b[^;]*\bnativeType\b'
  - id: validate-scalar-type-codec-ids-removed
    summary: |
      `validateScalarTypeCodecIds` is removed. Stack assembly now refuses, with an `InternalError`,
      a type constructor or field preset that names an unregistered codec, a constructor argument
      mapped onto a parameter neither the data type nor the codec declares, and two constructors of
      one data type marked `inferred`. The SQL family refuses two SQL data types that claim the same
      reported type when it creates its control instance, so CLI commands report it and the
      language server does not.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bvalidateScalarTypeCodecIds\b'
  - id: assemble-data-types-moved-to-codec
    summary: |
      `assembleDataTypes` moves from `@internal/framework-components/control` to
      `@internal/framework-components/codec`, because the runtime plane assembles data types too.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import\s*\{[^}]*\bassembleDataTypes\b[^}]*\}\s*from\s*[''"]@internal/framework-components/control[''"]'
  - id: number-text-helpers-moved
    summary: |
      `numeralText` moves from `@internal/sql-relational-core/ast` to
      `@internal/sql-contract/data-type`, beside the SQL data type declarations that use it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bnumeralText\b'
  - id: data-type-support-moved
    summary: |
      The helpers SQL targets use to implement their data types and PSL entries move from
      `@internal/sql-relational-core/ast` to `@internal/sql-contract/data-type-support`:
      `escapePslString`, `isNumeralText`, `canonicalNumeralText`, `integerTextCanonicalForm`,
      `signedRange`, `createNumberClassifier`, `parseJsonBody`, `printJsonBody`,
      `canonicalDateTime`, and the types `NumberClassification`, `IntegerStep`,
      `NumberClassifierSpec`, `DateTimeShape` and `CanonicalDateTimeOptions`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*\b(?:escapePslString|isNumeralText|canonicalNumeralText|integerTextCanonicalForm|signedRange|createNumberClassifier|parseJsonBody|printJsonBody|canonicalDateTime|NumberClassification|IntegerStep|NumberClassifierSpec|DateTimeShape|CanonicalDateTimeOptions)\b[^}]*\}\s*from\s*[''"]@internal/sql-relational-core/ast[''"]'
  - id: numeric-limits-removed
    summary: |
      `NUMERIC_PRECISION_RANGE` and `NUMERIC_SCALE_RANGE` are no longer exported from
      `@internal/target-postgres/codecs`. The bounds of `numeric` are written in the `pg/numeric`
      data type's parameter schema, `pgNumericParams` from `@internal/target-postgres/data-types`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bNUMERIC_(?:PRECISION|SCALE)_RANGE\b'
  - id: postgres-codecs-decode-server-text
    summary: The Postgres runtime driver now returns every column as the server's text output. A Postgres codec's `decode` receives that text for its type instead of the value `pg` used to parse, and direct `driver.query` callers receive strings.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:PostgresCodecDescriptor|definePostgresCodecs)(?![\w$])'
        - '@internal/driver-postgres/runtime[\s\S]*\.query\('
  - id: codecs-decode-json-reads-stored-forms
    summary: |
      A built-in codec's `decodeJson` now throws `RUNTIME.DECODE_FAILED` for JSON that is not a stored form of its type. Pass it the stored form. A codec an extension contributes should read the same way: every form the database writes for its type, and nothing else.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bdecodeJson\b'
  - id: mongo-codec-requires-decode-json
    summary: |
      `mongoCodec` now requires `decodeJson` unless the codec's application type is exactly `JsonValue`. Add a `decodeJson` that refuses JSON of another kind with `RUNTIME.DECODE_FAILED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmongoCodec\s*\('
  - id: sql-float-json-helpers-removed
    summary: |
      `sqlFloatEncodeJson`, `sqlFloatDecodeJson` and `isNonFiniteText` are no longer exported from `@internal/sql-relational-core/ast`. Use `encodeJsonFloat`, `decodeJsonFloat(codecId, json)` and `isNonFiniteText` from `@internal/framework-components/codec`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bsqlFloat(?:En|De)codeJson\b'
        - '\bisNonFiniteText\b'
  - id: codec-lookup-has-no-descriptor-for
    summary: |
      `CodecLookup` no longer has `descriptorFor`. A lookup that builds a column's codec is a `CodecLookupWithDescriptors`, whose `descriptorFor` is required: the `codecLookup` option of `defineContract`, `ContractSourceContext.codecLookup` and `CodecRegistry`. `emptyCodecLookup` is a plain `CodecLookup`. Type such a lookup `CodecLookupWithDescriptors` and give it a `descriptorFor` that answers from the same codecs as `get`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCodecLookup\b'
        - '\bemptyCodecLookup\b'
        - '\bcodecLookup\s*:'
        - '\bdescriptorFor\?\.'
  - id: mongo-codecs-check-json
    summary: |
      The built-in Mongo codecs now refuse a JSON value that is not the JSON form of their type, where most passed it through: a PSL enum member whose value its `@@type` codec does not take is now refused at `contract emit`, and a TypeScript `enumType` member that `mongo/objectId@1` or `mongo/int32@1` does not hold is refused when the contract is built. Correct the member.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '@@type\(\s*"mongo/'
        - '[''"]mongo/(?:objectId|int32)@1[''"]'
        - '\bMONGO_(?:OBJECTID|INT32)_CODEC_ID\b'
  - id: text-array-elements-nullable
    summary: |
      A `textArray()` column's elements are now typed `string | null`, because a `text[]` holds NULL elements, which it reads as `null`. Handle the `null`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\btextArray\s*\('
        - '[''"]pg/text-array@1[''"]'
  - id: char-reads-drop-only-padding
    summary: |
      A `char(n)` column now reads the same through `.include()` as through a flat read: without the trailing spaces that pad it, where an include used to return them, and keeping a trailing tab or newline, which a flat read used to drop. Compare `char` values without their padding.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"(?:sql|pg)/char@1"'
  - id: sqlite-nan-parameters-refused
    summary: |
      On SQLite, NaN written to a float column or used as a filter value now throws `RUNTIME.ENCODE_FAILED` naming the codec, where SQLite stored NULL or matched nothing. Write `null` for no value.
    detection:
      glob: "**/contract.json"
      matches:
        - '"target"\s*:\s*"sqlite"'
  - id: sqlite-int-include-refuses-inexact-values
    summary: |
      On SQLite, an `.include()` of a row whose `sql/int@1` column holds an INTEGER past 2^53, or a REAL, now throws `RUNTIME.DECODE_FAILED`, where it read the value rounded or with a fraction. Store such values in a `BigInt` or `Float` column.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"sql/int@1"'
  - id: contract-build-takes-lookups
    summary: |
      `buildSqlContractFromDefinition` and the `defineContract` of `@internal/sql-contract-ts`
      require `codecLookup` and `dataTypeLookup`. The Postgres and SQLite `defineContract` facades
      build both from the target and `extensions`, so a TypeScript contract that uses an extension's
      codec must list that extension, or pass lookups that hold its codecs and data types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bbuildSqlContractFromDefinition\s*\('
        - '\bdefineContract\s*\(\s*\{\s*\}'
  - id: define-contract-wrapper-builds-data-type-lookup
    summary: |
      A package that wraps `buildBoundContract` in its own `defineContract` must pass a
      `dataTypeLookup` built from its target pack and the listed extensions, next to the
      `codecLookup` it already passes, and accept both as optional overrides.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bbuildBoundContract\b[^;]*from\s*[''"]@internal/sql-contract-ts/'
  - id: postgres-codec-registry-takes-data-type-lookup
    summary: |
      The Postgres codec registry no longer carries the data types. `assemblePostgresCodecRegistry`,
      `assemblePostgresCodecRegistryWithBuiltins`, `createPostgresCodecRegistryWithBuiltins`,
      `createPostgresAdapterWithCodecRegistry` and the `PostgresControlAdapter` constructor take a
      data type lookup beside the codecs, and refuse a codec whose data type it lacks.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:assemblePostgresCodecRegistry(?:WithBuiltins)?|createPostgresCodecRegistryWithBuiltins|createPostgresAdapterWithCodecRegistry)\s*\('
        - '\bnew\s+PostgresControlAdapter\s*\('
  - id: contract-to-schema-takes-components
    summary: |
      The migrations capability's `contractToSchema(contract, frameworkComponents)` requires
      `frameworkComponents`; the codecs and data types in them name each column's type.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcontractToSchema\s*\(\s*[^,()]+\)'
  - id: contract-to-schema-ir-takes-lookups
    summary: |
      `contractToSchemaIR` options replace `expandNativeType` with the required `dataTypeLookup`
      and `codecLookup`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcontractToSchemaIR\s*\('
  - id: authoring-entity-context-takes-data-type-lookup
    summary: |
      `AuthoringEntityContext` gains a required `dataTypeLookup`, the stack's data types, and its
      `codecLookup` becomes a required `CodecLookupWithDescriptors`. Code that builds a context
      passes both. The `codecLookup` input of `interpretPslDocumentToMongoContract` becomes a required
      `CodecLookupWithDescriptors` too.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - ':\s*AuthoringEntityContext\s*=\s*\{'
  - id: mongo-derive-json-schema-takes-lookups
    summary: |
      `deriveJsonSchema` and `derivePolymorphicJsonSchema` (from `@internal/mongo-contract-psl`)
      take a required `lookups: MongoTypeLookups` (from `@internal/mongo-contract/data-type`)
      directly after their fields: `{ codecLookup, dataTypeLookup }`. The optional `codecLookup`
      argument is removed; the codec lookup moves into `lookups`, and the validator reads each
      field's BSON types from the data type its codec represents. Extensions that author Mongo
      contracts through `defineContract(...)` or PSL need no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bderiveJsonSchema\s*\('
        - '\bderivePolymorphicJsonSchema\s*\('
  - id: field-type-params-come-from-the-domain-type
    summary: |
      A field's type parameters now come from its domain type only. `EmissionSpi.resolveFieldTypeParams` is removed, `generateFieldOutputTypesMap` from `@internal/emitter` takes `(models, codecLookup)`, and `buildSqlContractFromDefinition` reads a field's type parameters from its descriptor. Drop the hook and the resolver argument, and give a value-object field its column's descriptor.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bresolveFieldTypeParams\b'
        - '\bgenerateFieldOutputTypesMap\s*\('
        - '\bbuildSqlContractFromDefinition\s*\('
  - id: sql-infer-psl-contract-takes-build-context
    summary: |
      A SQL target's `inferPslContract` hook now takes the stack's PSL build context as its second parameter, `(schema, context, describedContracts?)`, as `buildPslContract` does. A target that implements it accepts the context and reads type constructors and codecs from it. Code that called the hook on a target descriptor calls it on the SQL family instance instead, which supplies the context.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\binferPslContract\b'
  - id: imported-postgres-field-checks-defaults
    summary: |
      The `field` exported by the Postgres facade's `contract-builder` entry now has the Postgres presets and checks a `.default(...)` value against the Postgres target's column types, as the `defineContract` callback's `field` does; it does not know the column types an extension adds, such as pgvector's, so it does not check those. A default of the wrong type, which compiled before and failed when the contract was built, is now a compile error; give the value the column's type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s*\{[^}]*\bfield\b[^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)postgres/contract-builder[''"]'
  - id: codecs-check-stored-json
    summary: |
      A TypeScript `.default()` value or `enumType` member that its column's codec does not take is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` or `CONTRACT.ENUM_INVALID`. A `contract.json` that holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, and a `migration.ts` that holds one fails when it runs. Correct the value the error names.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.default\(\s*(?!now\(|sql`|autoincrement\()'
        - '\benumType\s*\('
  - id: psl-values-checked-by-codecs
    summary: |
      A PSL schema whose SQL enum member its codec does not take, or whose literal default its column's type does not hold, is now refused at `contract emit`, where it used to load. Correct the member or the default.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"(?:pg|sql|sqlite)/'
        - '^\s*\w+\s*=\s*-?\d{10,}\s*$'
        - '@default\(\s*(?:"|-?\d|\[)'
  - id: value-object-default-matches-composite-type
    summary: |
      A literal default on a field typed by a composite type must now match the composite type, with each member value read by the member's codec and each enum member value one of the enum's values, or the schema is refused. Fix the default the diagnostic names.
    detection:
      glob: "**/*.prisma"
      matches:
        - '^\s*type\s+\w+\s*\{'
  - id: composite-type-attributes-refused
    summary: |
      An attribute on a composite type or on one of its members is now refused, where it used to be ignored. Remove it.
    detection:
      glob: "**/*.prisma"
      matches:
        - '^\s*type\s+\w+\s*\{'
  - id: uuid-defaults-stored-as-postgresql-writes
    summary: |
      A uuid default written in upper case, in braces or without hyphens, in PSL or in a TypeScript `.default()`, is now stored as PostgreSQL writes it, so emitting the contract again changes its storage hash. Earlier versions could not apply such a contract: the command that applied it failed and changed nothing. Emit the contract again, then run that command again. With migrations, first delete the migration package that never applied.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bUuid\b[^\n]*@default\(\s*"(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")\{?[0-9A-Fa-f]{4}'
        - '\b(?:uuidNative|pgUuidColumn)\s*\([^\n]*\.default\(\s*[''"`](?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[''"`])\{?[0-9A-Fa-f]{4}'
        - '^\s*\.default\(\s*[''"`](?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[''"`])(?=[^''"`\n]*[A-F{-])\{?[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12}\}?[''"`]'
  - id: domain-types-match-their-columns
    summary: |
      The domain half of an emitted SQL contract now carries the type parameters and enum value sets the schema declares: on fields typed by a named type, on enum list fields, and on composite type members. In `contract.d.ts`, a composite type member with type parameters now has the parameterized output type. Re-emit the contract. This change leaves the storage half, every hash and migration snapshots unchanged.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
        - '"valueObjects"\s*:'
        - '"valueSet"\s*:'
  - id: default-renderer-receives-data-type
    summary: |
      `DefaultRenderer` receives a third argument, `{ dataType, baseTypeName }`: the id of the data
      type the column's codec represents, and its base name (the written name without
      parameters). The Postgres `renderDefaultLiteral` takes `{ many, baseTypeName, dataType }`
      instead of `{ many?, nativeType, dataTypeId? }`, and `dataType` is required.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDefaultRenderer\b'
        - '\brenderDefaultLiteral\b'
        - '\bDefaultColumn\b'
  - id: ddl-column-default-visitor-removed
    summary: |
      `DdlColumnDefaultVisitor`, `DdlColumnRenderContext` and the `accept` method of
      `LiteralColumnDefault` and `FunctionColumnDefault` are removed. Nothing in Prisma Next called
      them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDdlColumnDefaultVisitor\b'
        - '\bDdlColumnRenderContext\b'
  - id: ddl-nodes-hold-opaque-sql
    summary: |
      `FunctionColumnDefault`, `CheckExpressionConstraint`, `PostgresCreatePolicy` and `PostgresCreateIndex` hold their SQL as an `OpaqueSql` value instead of a string, and `DdlIndexElements` changed with them. Wrap the string with `opaqueSql(...)` when you construct one, read `.text` where you read the SQL, and render it with `renderOpaqueSql(...)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bnew\s+(?:[\w$]+\.)?(FunctionColumnDefault|CheckExpressionConstraint|PostgresCreatePolicy|PostgresCreateIndex)\s*\('
  - id: adapter-writes-column-defaults
    summary: |
      The control adapter writes every column's `DEFAULT …` clause, through a new required method, `renderColumnDefault(column, table)`, on `ExecuteRequestLowerer` and `SqlControlAdapter` (`family/control-adapter`). An adapter, and any fake lowerer in tests, must implement it. `buildColumnDefaultSql` is removed from `target/planner-ddl-builders`: build the column and call `renderColumnDefault`. `SetDefaultCall` (`target/op-factory-call`) takes the column, `new SetDefaultCall(schema, table, column, operationClass)`, instead of its name and `defaultSql`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbuildColumnDefaultSql\b'
        - '\bnew\s+SetDefaultCall\s*\('
        - '(?<![.\w])lowerToExecuteRequest\s*[(:]'
        - '\bimplements\b[^{]*\b(?:ExecuteRequestLowerer|SqlControlAdapter)\b'
  - id: migration-ts-column-defaults
    summary: |
      In `migration.ts`, the adapter writes every column default, reading it with the column's codec. Postgres `setDefault` takes the column as `col(name, type, { default, codecRef })` instead of `column` (the name) and `defaultSql`. A SQLite `addColumn` or `recreateTable` column carries `default` and `codecRef` instead of `defaultSql`, and a `recreateTable` postcheck for a default is `{ description, columnDefault }`. An earlier `migration.ts` that uses `defaultSql` no longer compiles, and running it with `node migration.ts` stops with `MIGRATION.OPERATION_OPTION_REMOVED`; its `ops.json` still applies.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bdefaultSql\s*:'
  - id: rename-check-constraint-call-is-rename-constraint-call
    summary: Replace `RenameCheckConstraintCall` with `RenameConstraintCall`, which takes the constraint kind as a new third constructor argument; pass `'checkConstraint'` for a check constraint.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])RenameCheckConstraintCall(?![\w$])'
        - 'factoryName\s*[!=]==?\s*["'']renameCheckConstraint["'']'
        - '["'']renameCheckConstraint["'']\s*[!=]==?\s*[\w$.?]*factoryName'
        - 'case\s+["'']renameCheckConstraint["'']\s*:'
  - id: control-family-instance-sign-spaces
    summary: |
      `ControlFamilyInstance` has a new required method, `signSpaces({ driver, spaces })`, which
      writes the marker of every contract space it is given. `db sign` calls it once for all
      spaces, each with the marker `db sign` read before verifying it (`expected`), and
      writes a marker only while it still holds those hashes. `SqlControlAdapter` gains
      `lockMarker`. `ControlFamilyInstance.sign`, `ControlClient.sign`, `SignOptions` and
      `SignDatabaseResult` are removed.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bControlFamilyInstance\s*<'
        - '\bSignDatabaseResult\b'
        - '\bSignOptions\b'
  - id: db-sign-signs-extension-spaces
    summary: |
      `db sign` now signs every contract space, the extension's included, and only a space whose
      schema verifies. Documentation that describes `db sign` for an extension's space says so.
    detection:
      glob: "**/*.md"
      matches:
        - '\bdb sign\b'
        - '\bfails verify and cannot repair it\b'
  - id: cli-error-from-caught
    summary: |
      `mapCaughtMigrationError` is removed from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`). Use `errorFromCaught(error, why)`, which always returns an error: a CLI error as it is, any error with a structured code as itself, and anything else as `CLI.UNEXPECTED` with `why(message)`. It throws an `InternalError` again.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmapCaughtMigrationError\b'
  - id: adapter-control-loads-temporal-polyfill
    summary: |
      The adapter's control entry, `adapter/control` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`, now loads `temporal-polyfill` too, as the target's control entry does since `temporal-polyfill-is-a-peer-dependency`. A Yarn project that added the polyfill for that change needs nothing more. An extension package that installs with Yarn and loads only the adapter's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '[''"]@prisma/orm-(?:target-)?postgres/adapter/control[''"]'
  - id: parameter-casts-use-base-names
    summary: |
      PostgreSQL parameter casts are written with the data type's base name: `$1::int4` instead of
      `$1::integer`, and likewise `int2`, `int8`, `float4`, `float8` and `bool` instead of
      `smallint`, `bigint`, `real`, `double precision` and `boolean`. Tests that assert query text
      change to match.
    detection:
      glob: "**/*.{ts,mts,cts,sql,json,snap}"
      matches:
        - '::(?:integer|smallint|bigint|real|double precision|boolean)\b'
  - id: sql-builder-reads-codec-descriptors
    summary: The sql-builder lane now reads `codecDescriptors` from the `ExecutionContext` passed to `sql()`. A hand-built test context must provide it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'as unknown as ExecutionContext'
  - id: select-ast-options-carry-locking
    summary: "SelectAstOptions has a new required key, locking; when rebuilding a select from an existing SelectAst, carry ast.locking so a row lock is not dropped."
    detection:
      glob: "**/*.ts"
      contains:
        - "new SelectAst("
  - id: render-lowered-sql-takes-capabilities
    summary: "renderLoweredSql from @internal/adapter-postgres/sql-renderer takes two new required arguments after the codec descriptor registry: the data type lookup, and the capability matrix to check locking clauses against; pass postgresAdapterCapabilities from @internal/adapter-postgres/adapter."
    detection:
      glob: "**/*.ts"
      contains:
        - "renderLoweredSql("
  - id: sql-runtime-close-refusal-option
    summary: "The options of SqlRuntimeBase and its subclasses (RuntimeOptions, for example new PostgresRuntimeImpl({ ... })) have a new optional key closeRefusal: 'when-idle' | 'at-once'. Pass 'at-once' for a runtime that many callers share; leaving it out means 'when-idle', which suits a runtime that one request owns."
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'new \w*RuntimeImpl\('
        - 'RuntimeOptions'
  - id: writes-on-a-conditional-collection-are-refused
    summary: |
      A write (`update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) on a collection that is filtered on some code paths and not on others no longer compiles. A pattern cannot tell which collections those are: act only where the compiler reports "The 'this' context of type '...' is not assignable to method's 'this' of type 'HasWhere'". Filter on every path, or make the write only where the filter was applied.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:updateAll|updateAndCount|deleteAll|deleteAndCount)\s*\('
        - '\.update\s*\('
        - '\.delete\s*\(\s*(?:\)|\()'
  - id: writes-refuse-what-they-would-ignore
    summary: |
      `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` now throw `ORM.ARGUMENT_INVALID` on a collection that has a `limit`, an `offset`, a `cursor`, `distinct` or `distinctOn`. These writes change every row that matches the filter; their statement cannot apply any of these, so they were ignored and more rows changed than the chain asked for. Remove them before the write, or read the rows first and change them by their ids. `update` with a relation callback now throws on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`, which it ignored; filter it to the one row instead. `update` and `delete` without a relation callback change the row `first()` returns, as before, except after `limit(0)`: they changed one row and now change none and return `null`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:limit|offset|cursor|distinct|distinctOn)\s*\([^)]*\)[\s\S]{0,300}?\.(?:update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*\('
        - '\.orderBy\s*\([\s\S]{0,300}?\.update\s*\('
  - id: cursor-and-distinct-on-check-the-receiver
    summary: |
      `cursor` and `distinctOn` now require an order on the collection they are called on, checked on the receiver. A cast on the argument, such as `cursor({ id } as never)`, no longer bypasses the check; add the `orderBy`, or cast the collection to `Ordered<C>` where the query is meant to have no order.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:cursor|distinctOn)\s*\([^)]*\bas\s+never\b'
  - id: apply-is-a-collection-member
    summary: |
      Every collection now has an `apply` method. A custom collection class that declares its own `apply` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*apply\s*[(<:=?]'
  - id: scope-is-a-collection-member
    summary: |
      Every collection now has a `scope` method. A custom collection class that declares its own `scope` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*scope\s*[!(<:=?]'
  - id: overriding-a-chaining-method
    summary: |
      In a class that extends `Collection`, an override of a chaining method (`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor`, `include`) or of a method that returns rows (`all`, `first`, `create`, `createAll`, `upsert`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) must use the new signature, which takes a `this` parameter.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|override|async)\s+)*(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include|all|first|create|createAll|upsert|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*[(<]'
  - id: collection-state-flags-are-boolean
    summary: |
      In `DefaultCollectionTypeState`, `hasWhere`, `hasOrderBy` and `hasUniqueFilter` are `boolean` (not known) instead of `false`. Code that expects `false` on a collection with no filter or order must expect `boolean`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bhas(?:Where|OrderBy|UniqueFilter)\b[''"]?\]?\s*,\s*false\b'
        - '\bhas(?:Where|OrderBy|UniqueFilter)\s*:\s*false\b'
  - id: read-collection-state-and-row-with-helpers
    summary: |
      A collection's type state and row are read with `CollectionTypeStateOf<C>` and `CollectionRowOf<C>`, not by inferring the type arguments of `Collection`. The type arguments keep what the collection started with.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCollection<[^;]*?\binfer\b'
  - id: return-type-of-a-chaining-method
    summary: |
      `ReturnType` of `where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` or `include` no longer gives a collection. Write `Filtered<C>` after `where`, `Ordered<C>` after `orderBy`, and `C` after the others, or take `typeof` of a value.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bReturnType<[^>]*\[[''"](?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)[''"]\]'
        - '\bReturnType<\s*typeof\s+[\w$.]+\.(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)\b'
  - id: chaining-methods-take-no-explicit-type-arguments
    summary: |
      `include`, `distinct` and `distinctOn` with explicit type arguments no longer compile: `posts.include<'user'>('user')` and `posts.distinct<['title']>('title')` fail, and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments; they are inferred from the arguments, so `posts.distinct('title')` needs none.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:include|distinct|distinctOn)<'
  - id: custom-collection-methods-chain
    summary: |
      Optional. Custom collection methods now stay available after the built-in chaining methods. Where code repeats a class method's body inline after a chaining call, it can call the method instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bextends\s+Collection<'
  - id: variant-takes-discriminator-value
    summary: |
      `.variant()` on a polymorphic SQL or Mongo ORM collection takes the discriminator value a variant declares instead of the variant's model name: `db.orm.public.Task.variant('bug')` for `@@base(Task, "bug")`, where it used to be `.variant('Bug')`. A value the model does not declare, or a call on a model with no discriminator, now throws `ORM.ARGUMENT_INVALID` instead of returning the collection unchanged. `.variant()` on a collection that already has a variant selected is now rejected: select the variant from the base collection.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.variant\('
---

# 8.0.0-rc.14 → 8.0.0-rc.15 — Extension author upgrade instructions

Apply the sections in this order:

1. Run the script of `contract-stores-data-type` first, before any step of this release that re-emits a contract. It rewrites only contracts in the old format.
2. Make the code changes in the sections that follow.
3. Before you re-emit, sign each database the extension's tests or tooling keep with `prisma db sign`, as `contract-stores-data-type` describes: `db sign` must see the contract the database was created from before a re-emit changes it again.
4. Re-emit the extension's contracts and test fixtures with `prisma contract emit` (`build:contract-space`) once, after the code changes. Several sections ask for it: `reemit-extension-list-contracts`, `consume-nested-list-cardinality`, `domain-types-match-their-columns` and `uuid-defaults-stored-as-postgresql-writes`. Where the re-emit changes the schema, plan and apply a migration as those sections say.

After the code changes, delete imports and constants that are no longer used, and run the package's formatter so imports are sorted.

## `contract-stores-data-type`

Do this before any other step of this release that re-emits a contract: the script changes only files in the old format, and `prisma db sign` must see the contract the database was created from before a re-emit changes it again. Commit your work first, so the script's changes can be reviewed and undone with git. The script follows links to files and directories, also outside the root, and rewrites the files there; commit or back up those too. Then run the script that sits next to this guide from the extension package's root. `<skill>` is the directory of the synced `prisma-8` skill:

```sh
node <skill>/upgrading/extension/upgrades/8.0.0-rc.14-to-8.0.0-rc.15/scripts/data-type-in-contract/data-type-in-contract.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL contract in the old format (a column or `storage.types` entry that stores `nativeType`), skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old-format contract: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root. In each contract it rewrites, it also writes lists in this release's new form (`consume-nested-list-cardinality`): a list column or field stored as `many: true` becomes `many: { elementNullable: false }`, and `contract.d.ts` declares `many` on every column. This is the SQL part of `reemit-extension-list-contracts`.

On PostgreSQL, a list column of an enum keeps the membership check its database has, because the database still holds that check. Run `prisma db sign` before you emit the contract again. The next `prisma contract emit` writes the check as `array_remove(…) <@ ARRAY[…]` under a new name; `prisma migration plan` then writes a migration that drops the old check and adds the new one, and `prisma db migrate` applies it. The plan warns that dropping the old check may lose data; it does not, because only the check changes, not the column. If you already emitted before signing, `db sign` reports the new check as missing: sign each database with the storage hash the script printed instead (`prisma db sign <new hash>`), then plan and migrate as above.

If the script stops on an error, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. After an error, Ctrl-C or a crash, run it again: it finishes the upgrade. A file the script was writing at that moment is either unchanged or complete, and it removes its own temporary files (ending in `.data-type-in-contract-tmp`) on the next run.

Run your formatter afterwards. The script replaces text in `migration.ts` and `contract.d.ts`, so the import order in `migration.ts` and the line wrapping in `contract.d.ts` can differ from what a fresh emit and your formatter produce.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A contract already in the new format is never changed, even when its stored hash does not match its content, so a project already in the new format is left unchanged, and the script says that nothing changed. If it finds no SQL contract under the root, it says so; run it again from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for an old-format contract whose stored storage hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a column uses a codec it does not know (`<file>: unknown codec <id>; name its data type with --data-type <id>=<data type id>`) or when a renamed snapshot directory already exists with different content.

The script knows every codec that Prisma and its own extensions ship. For each codec your extension owns, run the script with `--data-type <codec id>=<data type id>`, naming the data type that codec represents, for example `--data-type acme/shape@1=acme/shape`. Publish those lines in your release notes: your users pass the same options when they run the script on their projects. The option cannot change the data type of a codec the script already knows for a contract's target, but it can name the data type of a shared `sql/*` codec on a target the script does not know.

Release the extension with the rewritten contract space against the framework version that contains this change, and raise the extension's peer dependency floor on the framework to that version. The two versions cannot be mixed: the old framework refuses a contract space that stores `dataType`, and the new framework refuses one that still stores `nativeType`. So a release published early cannot be installed before the framework upgrade. Tell your users to upgrade the framework and your extension in the same step.

## `reemit-extension-list-contracts`

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's original authoring source and configuration, including each owned contract space. Use the existing contract-space emission command rather than hand-editing generated fields or hashes. For the Supabase extension in this repository, `pnpm --filter @internal/extension-supabase build:contract-space` regenerates `src/contract/contract.json` and `src/contract/contract.d.ts`; its separate `emit` script targets test fixtures, not this bundled contract.

Preserve existing strict-element declarations and explicit `elementNotNull` waivers. In particular, a Supabase native-array column with `noCheck: ['elementNotNull']` remains `many: { elementNullable: false }`, not a nullable-element list. Scalar domain JSON continues to omit `many: false`; list descriptors change, and generated contract hashes may change. Retaining old hash literals is not a valid regeneration. Scalar domain JSON and declarations omit `many: false`; SQL storage-column declarations retain required cardinality.

For SQL contract spaces, the script of `contract-stores-data-type` already writes the list form and refreshes hashes and snapshot names, so historical SQL snapshots need no re-emission; MongoDB contract spaces still do.

For extension-owned MongoDB migration snapshots, regenerate each historical state from its own source, not the latest extension schema. Write the JSON/declaration pair through the snapshot store and regenerate dependent migration metadata in dependency order. If a snapshot hash changes, preserve the old entry while it is referenced, create the new content-addressed entry, and update both JSON/type imports, start/end contract hashes, and derived migration identifiers and parent references consistently. Preserve recorded operations unless intentionally changing the schema. Do not blanket-rename hash paths, drop migration references, or rewrite applied history. Coordinate already-applied migration identities and database contract markers through the consumer project's supported migration procedure and verify the transition on a disposable database. Stop if historical sources or the reference mapping cannot be recovered.

## `consume-nested-list-cardinality`

`ContractField.many` and `StorageColumn.many` are now `false | { elementNullable: boolean }`. `ContractField.many` is optional: omission and `false` both mean scalar. `StorageColumn.many` remains required, with `false` for non-array storage columns. Serialized model and value-object fields may omit `many` for scalar cardinality; deserialization normalizes omission to `many: false`, and canonical emission omits that scalar default again. Replace legacy `many: true` with `many: { elementNullable: false }` for existing strict-element lists, preserving nested `elementNullable: false` during emission. Move any intermediate sibling `elementNullable` property into the list descriptor and remove the sibling. Explicit malformed `many` values, including the old `true` form and descriptors without a boolean `elementNullable`, remain rejected, as does the sibling property.

For domain fields, use `if (field.many)` to detect and narrow a list descriptor before reading `elementNullable`; omitted `many` is scalar. For normalized storage columns, replace `column.many === true` with `column.many !== false`. Update conditional types that matched `{ many: true }` to match the descriptor. Do not broaden this replacement to unrelated booleans or relation cardinality. For example, the included-column decoder in an ORM extension must replace `ref.storageColumn.many === true` with `ref.storageColumn.many !== false` so native arrays still take the element-decoding path.

Preserve the independent meaning of `nullable` (the whole field value) and `many.elementNullable` (each element). Type generators must produce `ReadonlyArray<T | null>` for nullable elements and add an outer `| null` only for a nullable container. Array encoders and decoders must preserve a whole-list `null` without traversal and bypass the element codec for null elements, while processing non-null elements normally. Do not pass null elements into scalar codecs or collapse null lists into empty arrays.

For native SQL arrays, propagate element semantics to both the domain field and storage column. For JSON-backed value-object lists, retain the domain descriptor but do not add a native-array descriptor to storage. Do not add `elementNullable` to schema IR: PostgreSQL migration comparison observes the derived check constraints. Generate `elementNotNull` only for strict-element arrays, then apply explicit `noCheck` waivers. Never infer element nullability from `noCheck`, and reject an `elementNotNull` waiver on a nullable-element list as inapplicable. MongoDB array-item validators must admit null only when the domain descriptor permits it, including enum membership and value-object items.

If exposing list authoring, use `.many({ elementsNullable: true })` to request nullable elements; the option uses plural `elementsNullable`, whereas the emitted descriptor uses singular `elementNullable`. Omitted or literal `false` retains strict elements. Keep whole-list `.nullable()` independent. PSL equivalents are `T[]`, `T?[]`, `T[]?`, and `T?[]?`; this change does not enable nullable relation-list elements or scalar lists on SQLite.

## `sql-data-type-declares-names`

Declare each SQL data type the extension owns with `sqlDataType`, and list the texts the database writes and reports for it. `@internal/sql-contract/data-type` is a new dependency of the package.

```ts
// before
import { type DataType, dataType } from '@internal/framework-components/codec';

export const pgvectorVector: DataType = dataType('pgvector/vector', {
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});

// after
import type { DataType } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { type as arktype } from 'arktype';
import { VECTOR_MAX_DIM } from './constants';

export const pgvectorVectorParams = arktype({
  length: `number.integer >= 1 & number.integer <= ${VECTOR_MAX_DIM}` as const,
});

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});
```

Declare `params` as a named export directly above the data type, so the codec can reference it. Each text is lower case with single spaces, and `{name}` stands for the parameter `name`. Mark the text a migration writes `written: true`, and the text the database catalog prints (`format_type` on PostgreSQL) `catalog: true`. Among texts with the same placeholders, at most one is written and one is catalog. Add `normalize` when two parameter sets name the same database type. Keep `casts` and `listCast` as they are. Drop the explicit `: DataType` annotation on the declaration so the parameter type is kept; the `dataTypes` list stays `readonly DataType[]`.

A type written with and without parameters lists a text for each, and `display` gives the letter case the database writes. The PostGIS geometry type:

```ts
export const postgisGeometryParams = arktype({ 'srid?': 'number.integer >= 1' });

export const postgisGeometry = sqlDataType('postgis/geometry', {
  params: postgisGeometryParams,
  texts: [
    { text: 'geometry', written: true, catalog: true },
    {
      text: 'geometry(geometry,{srid})',
      written: true,
      catalog: true,
      display: 'geometry(Geometry,{srid})',
    },
  ],
  casts: { [pgText.id]: (value) => value },
});
```

The texts must reproduce what the removed hooks wrote: the written text for the column's parameters must equal the old `expandNativeType` result, or migration SQL changes. The bounds are the type's real ones: PostgreSQL refuses an SRID below 1 in a type modifier.

The section "Declaring a data type" of the Prisma 8 codec authoring guide (`docs/reference/codec-authoring-guide.md` in the Prisma repository) describes every field.

## `codec-target-types-removed`

Delete `targetTypes` from every codec descriptor and template:

```ts
// before
override readonly targetTypes = ['vector'] as const;

// after: the line is gone; the names are the data type's texts
```

Code that read `codecLookup.targetTypesFor(codecId)` or `registry.byTargetType(name)` reads the data type instead: `dataTypeLookup.get(codecLookup.descriptorFor(codecId).dataType)`. For a SQL type, call `sqlBaseName(type, dataTypeParams(type, typeParams))` or `renderSqlTypeName(...)` from `@internal/sql-contract/data-type`. For a Mongo codec, move the list to the data type the codec names and read it with `bsonTypesOfCodec(codecId, { codecLookup, dataTypeLookup })` from `@internal/mongo-contract/data-type`; the declared type keeps the list at `type.mongo.bsonTypes`:

```ts
export const myDecimal = mongoDataType('my/decimal', { bsonTypes: ['decimal'] });
```

## `native-type-rendering-hooks-removed`

Delete the `nativeType` override from each `PostgresCodecDescriptor` subclass, with the constant it returned when nothing else uses it. Delete `expandNativeType` from each entry of `controlPlaneHooks`, and keep the other hooks, such as `resolveIdentityValue`.

```ts
// before
const PG_VECTOR_NATIVE_TYPE = 'vector';

export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  protected override nativeType(): string {
    return PG_VECTOR_NATIVE_TYPE;
  }
  // …
}

const vectorControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    // …
  },
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};

// after
export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  // …
}

const vectorControlPlaneHooks: CodecControlHooks = {
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};
```

When a hooks object held only `expandNativeType`, delete the object and the `types` override that registered it:

```ts
// before
const arktypeJsonControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType }) => nativeType,
};

export const arktypeJsonExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...arktypeJsonPackMeta,
  types: {
    ...arktypeJsonPackMeta.types,
    codecTypes: {
      ...arktypeJsonPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [ARKTYPE_JSON_CODEC_ID]: arktypeJsonControlPlaneHooks,
      },
    },
  },
  create: () => ({ /* … */ }),
};

// after
export const arktypeJsonExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...arktypeJsonPackMeta,
  create: () => ({ /* … */ }),
};
```

A caller of `descriptor.nativeTypeFor(ref)` uses `sqlBaseName` of the codec's data type. A custom control adapter drops `normalizeNativeType`.

## `comments-name-removed-apis`

In comments, delete each sentence that names `expandNativeType`, `targetTypes` or the `nativeType()` hook, and nothing else. When the deletion empties a paragraph, a list item or a whole comment, delete it with the blank comment line before it. Leave the rest of the comment as it is.

```ts
// before
/**
 * Per-codec column helper for `pg/vector@1`. Generic over `N extends number` so the column site preserves the dimension literal in `typeParams` (e.g. `pgVectorColumn(1536)` packs `typeParams: { length: 1536 }`).
 *
 * Passes the bare `nativeType: 'vector'`; the family-layer `expandNativeType` hook renders the parameterized form (`vector(1536)`) at emit/verify time from `nativeType` + `typeParams`.
 */

// after
/**
 * Per-codec column helper for `pg/vector@1`. Generic over `N extends number` so the column site preserves the dimension literal in `typeParams` (e.g. `pgVectorColumn(1536)` packs `typeParams: { length: 1536 }`).
 */
```

A codec module's summary comment that lists what the descriptor carries names the data type and its params schema in place of target types and a native type, and says the data type declares the type's name and the bounds of its parameters. A column helper no longer passes a bare `nativeType`, so that clause goes too. Write each rewritten list item on one line. The pgvector and PostGIS summaries:

```ts
// before
 * 2. `PgVectorDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, target types, params schema (`{ length: number }`, validated against {@link VECTOR_MAX_DIM}), the postgres native type `vector`, explicit target behavior, and the emit-path `renderOutputType` producing `Vector<${length}>`.
 * 3. `pgVectorColumn(length)` per-codec column helper invoking `descriptor.factory({ length })` directly + passing the bare `nativeType: 'vector'`. The family-layer {@link expandNativeType} hook renders the parameterized form (`vector(1536)`) at emit/verify time from `nativeType` + `typeParams`.

// after
 * 2. `PgVectorDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, the `pgvector/vector` data type and its params schema, explicit target behavior, and the emit-path `renderOutputType` producing `Vector<${length}>`. The data type declares the type's name and the bounds of `length`.
 * 3. `pgVectorColumn(length)` per-codec column helper invoking `descriptor.factory({ length })` directly.
```

```ts
// before
 * 2. `PostgisGeometryDescriptor` extends {@link PostgresCodecDescriptor}
 *    with the codec id, traits, target types, params schema
 *    (`{ srid?: number }`, preserving unparameterized geometry while validating supplied SRIDs), explicit target behavior, and
 *    the emit-path `renderOutputType` producing `Geometry<${srid}>` /
 *    `Geometry` when no SRID is supplied.
 * 3. `pgGeometryColumn({ srid })` per-codec column helper invoking
 *    `descriptor.factory({ srid })` and passing the bare
 *    `nativeType: 'geometry'`. The family-layer `expandNativeType`
 *    hook renders the parameterised form
 *    (`geometry(Geometry,${srid})`) at emit/verify time from
 *    `nativeType` + `typeParams`.

// after
 * 2. `PostgisGeometryDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, the `postgis/geometry` data type and its params schema (`{ srid?: number }`), explicit target behavior, and the emit-path `renderOutputType` producing `Geometry<${srid}>` / `Geometry` when no SRID is supplied. The data type declares the type's name and the bound of `srid`.
 * 3. `pgGeometryColumn({ srid })` per-codec column helper invoking `descriptor.factory({ srid })`.
```

## `postgres-codec-takes-data-type`

```ts
// before
const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText.id,
  nativeType: () => 'text',
  jsonProjection: (expression) => expression,
});

// after
const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
});
```

Import the data type object if only its id was imported. `sqliteCodec` changes the same way, without a `nativeType` option to remove.

## `codec-params-schema-is-data-type-params`

Delete the codec's own parameter schema, which the data type's `params` now holds (see `sql-data-type-declares-names`), and point `paramsSchema` at the data type's:

```ts
// before, in codecs.ts
import { pgvectorVector } from './data-types';

const vectorParamsSchema = arktype({
  length: 'number',
}).narrow((params, ctx) => {
  // … integer and range checks …
}) satisfies StandardSchemaV1<VectorParams>;

override readonly paramsSchema: StandardSchemaV1<VectorParams> = vectorParamsSchema;

// after
import { pgvectorVector, pgvectorVectorParams } from './data-types';

override readonly paramsSchema: StandardSchemaV1<VectorParams> = pgvectorVectorParams;
```

A codec with keys of its own sets `paramsSchema` to `dataType.params.and(ownKeys)`. A codec whose data type has no `params` keeps a schema of its own keys only; `arktype/json@1` is such a codec and changes nothing here.

## `column-helper-checks-data-type-params`

Delete the helper's own range check and the `@throws` tag that describes it, with the blank comment line directly before the tag when there is one. The helper returns its descriptor unchecked:

```ts
// before
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from '../core/constants';
import { pgVectorError } from '../core/errors';

/**
 * …
 * @returns A column type descriptor with `typeParams.length` set
 * @throws `CONTRACT.ARGUMENT_INVALID` if length is not an integer in the range [1, VECTOR_MAX_DIM]
 */
export function vector<N extends number>(length: N) /* : … */ {
  if (!Number.isInteger(length) || length < 1 || length > VECTOR_MAX_DIM) {
    throw pgVectorError('CONTRACT.ARGUMENT_INVALID', /* … */);
  }
  return { /* … */ } as const;
}

// after
import { VECTOR_CODEC_ID } from '../core/constants';

/**
 * …
 * @returns A column type descriptor with `typeParams.length` set
 */
export function vector<N extends number>(length: N) /* : … */ {
  return { /* … */ } as const;
}
```

PostGIS's `geometry({ srid })` and `pgGeometryColumn({ srid })` lose their `srid` checks the same way and keep `const { srid } = options;`. A contract whose column has parameters its data type refuses, such as `vector(0)` or `geometry({ srid: 0 })`, fails when it is built, with `CONTRACT.TYPE_PARAMS_INVALID` and the meta `{ dataType, parameters, modelName, fieldName }`.

## `type-constructor-templates-lose-native-type`

```ts
// before
Vector: {
  kind: 'typeConstructor',
  args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: VECTOR_MAX_DIM }],
  output: {
    codecId: 'pg/vector@1',
    nativeType: 'vector',
    typeParams: {
      length: { kind: 'arg', index: 0 },
    },
  },
},

// after
Vector: {
  kind: 'typeConstructor',
  inferred: true,
  args: [{ kind: 'number', name: 'length', integer: true }],
  output: {
    codecId: 'pg/vector@1',
    typeParams: {
      length: { kind: 'arg', index: 0 },
    },
  },
},
```

Put `inferred: true` directly after `kind` on the one constructor that `contract infer` should print for the data type. Keep `minimum` and `maximum` on an argument that also feeds something other than a data type parameter. An argument mapped onto a parameter the data type declares optional becomes `optional: true`, as PostGIS's `srid` does:

```ts
args: [{ kind: 'number', name: 'srid', integer: true, optional: true }],
```

## `runtime-descriptor-registers-data-types`

Add `dataTypes` directly after `version`:

```ts
const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  dataTypes: pgvectorPackMeta.dataTypes,
  // …
};
```

Without it, building the runtime adapter fails with `CONTRACT.DATA_TYPE_UNREGISTERED`, because the runtime stack has no data type to write the extension codec's casts from. When building an adapter by hand, pass the same list: `createPostgresAdapter({ codecDescriptors, dataTypes: pgvectorDataTypes })`. An extension whose codecs represent only the target's data types, such as `arktype/json@1` over `pg/jsonb`, has no data types of its own and adds nothing.

## `column-descriptors-drop-native-type`

Delete `nativeType` from every column type descriptor: column type helpers, hand-written descriptors, and enum descriptors.

```ts
// before
export function vector<N extends number>(length: N) {
  return { codecId: VECTOR_CODEC_ID, nativeType: 'vector', typeParams: { length } } as const;
}
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

// after
export function vector<N extends number>(length: N) {
  return { codecId: VECTOR_CODEC_ID, typeParams: { length } } as const;
}
const pgText = { codecId: 'pg/text@1' } as const;
```

Delete the fourth argument of `column()`, the type name:

```ts
// before
column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length }, 'vector');

// after
column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length });
```

Delete the `storage` list from the pack metadata's `types`: nothing reads it, and `StorageTypeMetadata`, its type, is deleted from `@internal/sql-contract/pack-types`. Delete an import that only the list used, and the part of a doc comment that describes the list. Contracts no longer carry `extensions.<pack>.types.storage`; the script removes it from yours.

```ts
// before
types: {
  codecTypes: { import: { package: '@acme/pack/codec-types', named: 'CodecTypes', alias: 'AcmeTypes' } },
  storage: [{ typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' }],
},

// after
types: {
  codecTypes: { import: { package: '@acme/pack/codec-types', named: 'CodecTypes', alias: 'AcmeTypes' } },
},
```

Delete `nativeType` from each `storage.types` entry of the contract space's source (`src/contract.ts`):

```ts
// before
[PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, nativeType: PGVECTOR_NATIVE_TYPE, typeParams: {} },

// after
[PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, typeParams: {} },
```

A codec descriptor's `columnFromEntity` returns `{ typeParams }` and no `nativeType`; code that read `nativeType` from its result stops reading it.

A `defineContract` facade that constrains the contract's `types` to what `type.*` helpers return uses `AuthoredStorageTypeInstance` from `@internal/sql-contract/types`, which has no `dataType`; the contract build adds it:

```ts
// before
type TypesConstraint = Record<string, StorageTypeInstance>;

// after
type TypesConstraint = Record<string, AuthoredStorageTypeInstance>;
```

Code that builds a stored contract's column by hand, for example a test helper, writes the data type id instead of the type name: `{ dataType: 'pg/int4', codecId: 'pg/int4@1' }` instead of `{ nativeType: 'int4', codecId: 'pg/int4@1' }`, and a contract type written by hand declares `readonly dataType: 'pg/int4'` instead of `readonly nativeType: 'int4'`.

Update doc comments and examples that describe what a helper produces: `// Produces: codecId: 'pg/vector@1', typeParams: { length: 1536 }` instead of `// Produces: nativeType: 'vector', typeParams: { length: 1536 }`.

## `sqlite-data-types-are-stored-types`

A codec, cast or authoring entry that named one of the deleted types names the type SQLite stores instead: `sqlite/text` for JSON and date-time values, `sqlite/integer` for big integers. The data types are exported from `@internal/target-sqlite/data-types`.

```ts
// before
override readonly dataType = sqliteJson.id;        // 'sqlite/json'
override readonly dataType = sqliteBigint.id;      // 'sqlite/bigint'

// after
override readonly dataType = sqliteText.id;        // 'sqlite/text'
override readonly dataType = sqliteInteger.id;     // 'sqlite/integer'
```

The canonical forms follow the stored type: `sqlite/integer` stores digit text and `sqlite/text` a string. A JSON codec on SQLite stores the JSON text of the document, and a date-time codec its text. `sqlite/text` declares no canonical form, so a codec whose values have several written forms declares one on its descriptor: `sqlite/datetime@1` does, with `toCanonicalForm` (the function that was `sqliteDatetime.toCanonicalForm`). A contract source, `db verify` and DDL use a codec's canonical form before its data type's.

```ts
import type { ToCanonicalForm } from '@internal/framework-components/codec';

// your function: written text in, the one text the contract stores out; it throws
// CONTRACT.CAST_REFUSED for text the codec does not hold
declare const datetimeCanonicalForm: ToCanonicalForm;

export class MyDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  override readonly dataType = sqliteText.id;
  override readonly toCanonicalForm = datetimeCanonicalForm;
  // codecId, traits, the JSON projection and the factory follow
}
```

## `canonical-form-of-a-column`

Read a column's canonical form through `canonicalFormOf`, and pass the renamed options:

```ts
// before
canonicalDateTime(text, { shape: 'instant', dataTypeId: 'acme/instant' });
mapDefault(stored, { dataTypeEntries, dataTypeLookup, columnDataType: codec.dataType });
const toCanonical = codec.toCanonicalForm ?? dataTypes.get(codec.dataType)?.toCanonicalForm;

// after
canonicalDateTime(text, { shape: 'instant', ownerId: 'acme/instant' });
mapDefault(stored, { dataTypeEntries, dataTypeLookup, columnCodec: codec });
const toCanonical = canonicalFormOf(codec, dataTypes);
```

## `authoring-entry-key-checked`

An entry whose tag yields a type that another entry already holds under that type's id, as SQLite's `json` tag yields `sqlite/text`, moves under its tag's key and names the type it yields:

```ts
import { tagEntryKey } from '@internal/framework-components/authoring';

// before
[sqliteJson.id]: {
  written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
  print: printJsonBody,
  documentation: 'Reads the body as a JSON document and stores it as the default value.',
},

// after
[tagEntryKey('json')]: {
  written: {
    kind: 'tag',
    tag: 'json',
    type: sqliteText.id,
    parse: (text) => canonicalizeJson(parseJsonBody(text)),
  },
  print: (value) => String(value),
  documentation: 'Reads the body as a JSON document and stores its JSON text as the default value.',
},
```

An entry under a data type's id keeps naming no `type`. Any other combination fails assembly with `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`.

## `the-sql-tag-writes-the-sql-expression-data-type`

This supersedes the section about lowering entries in the `data-types-column-defaults` extension instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12.

`sql` used to be a tag that named no data type and lowered its own body. It is now the tag of the data type `sql/expression`, which the SQL family defines and registers. The second kind of authoring entry is gone.

| Removed | Replacement |
| --- | --- |
| `AuthoringDataTypeEntry` | `DataTypeAuthoringEntry`, from `@internal/framework-components/authoring` |
| `DataTypeLoweringAuthoringEntry`, `loweringEntryKey`, `isLoweringEntryKey`, `isDataTypeLoweringEntry` | None. Remove the branch that told the two kinds of entry apart |
| `TaggedLiteralValue` from `@internal/framework-components/control` | None |
| `sqlDefaultLiteralTagEntry` from `@internal/family-sql/control` | Nothing to register. The SQL family descriptor registers `sqlExpressionAuthoringEntry` from `@internal/sql-contract/sql-expression` under `SQL_EXPRESSION_DATA_TYPE_ID` |
| `PSL_INVALID_DEFAULT_SQL` from `@internal/family-sql/control` | The string `'PSL_INVALID_DEFAULT_SQL'`. The code itself is unchanged |
| `createPostgresDataTypeEntries`, `createSqliteDataTypeEntries` in the adapters | `postgresDataTypeEntries()` from `@internal/target-postgres/data-types`, `sqliteDataTypeEntries()` from `@internal/target-sqlite/data-types` |

Every key of `authoring.dataTypes` must now be the id of a data type that a component in the stack registers, or the key `tagEntryKey(tag)` of an entry that names the type its tag yields (see `authoring-entry-key-checked`). A key such as `lowering:sql` fails assembly with `CONTRACT.DATA_TYPE_UNREGISTERED`.

The SQL family registers `sql/expression` and its entry itself. A target or an extension does not register it, and a target that registered it too fails assembly with `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE` (or `CONTRACT.DATA_TYPE_DUPLICATE` if it registers only the type). Remove both from the target. No component's data types may declare a cast or a list cast from `sql/expression`. The SQL family refuses a stack that has one with `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION` when it creates its control instance.

Two types exported from `@internal/sql-contract-psl/resolution` changed:

- The `WrittenValue` tag arm names its text `text`, not `body`.
- The `unreadable` arm of `DefaultRefusal` has no `json` field. A JSON text that is not a JSON document is an ordinary `unreadable` refusal.

## `prefixed-sql-tags-are-removed`

`pg.sql` and `sqlite.sql` were second names for the `sql` tag. They are removed, and a schema that uses one is refused with `PSL_UNKNOWN_LITERAL_TAG`: `Unknown literal tag "pg.sql". Known tags: sql, json.`

Replace the tag with `sql` and leave the text unchanged:

```diff
- createdAt DateTime @default(pg.sql`(now() + interval '1 hour')`)
+ createdAt DateTime @default(sql`(now() + interval '1 hour')`)
```

The stored default does not change, so no migration follows.

## `default-diagnostic-codes-changed`

This matters only to code that reads PSL diagnostic codes, such as a test that asserts one. The messages did not change, except for a `sql` literal inside a list literal and the list of known tags, both described below the table.

| Refusal | Old code | New code |
| --- | --- | --- |
| A tag no pack registered | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `PSL_UNKNOWN_LITERAL_TAG` |
| A `json` literal whose text is not a JSON document | `PSL_INVALID_JSON_LITERAL` | `PSL_INVALID_LITERAL` |
| Text an authoring entry or a cast refused | `PSL_INVALID_DEFAULT_LITERAL` | `PSL_INVALID_LITERAL` |
| A value whose type the column's type has no cast from, including a list written on a column that holds one value | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A written form the target has no data type for | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A single value on a list column | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_DEFAULT_LIST_EXPECTED` |
| A value the column's codec refused | `PSL_INVALID_DEFAULT_LITERAL` | unchanged |
| A `sql` literal inside a list literal | `PSL_INVALID_DEFAULT_LITERAL`, at the element | `PSL_VALUE_TYPE_INCOMPATIBLE`, at the `@default` attribute |

`PSL_INVALID_JSON_LITERAL` no longer exists.

The unknown-tag message lists the known tags in the order the stack registers them. The SQL family registers `sql` before the target registers `json`, so a Postgres or SQLite stack lists `sql, json`, where it used to list `json, sql, pg.sql` or `json, sql, sqlite.sql`. The completion list and the `Expected one of` message of `@default` offer `sql` before `json` for the same reason.

A `sql` literal inside a list literal used to report `Literal tag "sql" produces a default of its own and cannot be an element of a list literal.` It is now refused by the cast rule, like any other value the column's type does not take: `Field "Post.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing`. Write the whole list as one `sql` literal instead, as in `` @default(sql`'{}'::text[]`) ``.

This supersedes the statement in the `data-types-column-defaults` extension instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12 that a cast's refusal surfaces as `PSL_INVALID_DEFAULT_LITERAL`. It surfaces as `PSL_INVALID_LITERAL`.

## `resolve-identity-value-receives-data-type`

```ts
// before
resolveIdentityValue: ({ nativeType }) => (nativeType === 'vector' ? "'[0]'" : null),

// after
resolveIdentityValue: ({ dataType }) => (dataType === 'pgvector/vector' ? "'[0]'" : null),
```

A list column now reaches the hook with its element's data type and `typeParams`.

## `validate-scalar-type-codec-ids-removed`

Delete calls to `validateScalarTypeCodecIds`; the control stack checks the same thing when it is assembled. Fix any assembly error the new checks report in the extension's own contributions.

## `assemble-data-types-moved-to-codec`

Import `assembleDataTypes` from `@internal/framework-components/codec`. Remove it from the `@internal/framework-components/control` import, and delete that import if nothing is left in it:

```ts
// before
import { assembleDataTypes } from '@internal/framework-components/control';

// after
import { assembleDataTypes } from '@internal/framework-components/codec';
```

## `number-text-helpers-moved`

Import `numeralText` from `@internal/sql-contract/data-type`, adding it to an existing import from that module. Remove it from the `@internal/sql-relational-core/ast` import, and delete that import if nothing is left in it:

```ts
// before
import { numeralText } from '@internal/sql-relational-core/ast';

// after
import { numeralText } from '@internal/sql-contract/data-type';
```

## `data-type-support-moved`

Import each helper listed in the summary from `@internal/sql-contract/data-type-support`. `CanonicalDateTimeOptions.dataTypeId` is also renamed `ownerId`; see `canonical-form-of-a-column`. Remove it from the `@internal/sql-relational-core/ast` import, and delete that import if nothing is left in it. Add `@internal/sql-contract` to the package's dependencies if it is not there:

```ts
// before
import { escapePslString, createNumberClassifier } from '@internal/sql-relational-core/ast';

// after
import { createNumberClassifier, escapePslString } from '@internal/sql-contract/data-type-support';
```

## `numeric-limits-removed`

Validate `numeric` parameters against `pgNumericParams` instead of reading the two ranges:

```ts
// before
import { NUMERIC_PRECISION_RANGE } from '@internal/target-postgres/codecs';
const fits = precision >= NUMERIC_PRECISION_RANGE.min && precision <= NUMERIC_PRECISION_RANGE.max;

// after
import { pgNumericParams } from '@internal/target-postgres/data-types';
import { type as arktype } from 'arktype';
const fits = !(pgNumericParams({ precision }) instanceof arktype.errors);
```

## `postgres-codecs-decode-server-text`

In a Postgres codec, make `decode` parse the server text for its type. Do not expect a value that `pg` parsed:

- `bool` arrives as `t` or `f`, not a boolean.
- Integer, float and `oid` values arrive as decimal text, such as `42`, `1.5`, `NaN` or `-Infinity`, not numbers. `int8` and `numeric` already arrived as text.
- `bytea` arrives as `\x` hex text, such as `\x0102ff`, not a `Buffer`.
- `interval` arrives as PostgreSQL interval text, such as `1 day 02:03:04`, not an object.
- `point` and `circle` arrive as PostgreSQL geometric text, such as `(1,2)` and `<(1,2),3>`, not objects.
- `json` and `jsonb` arrive as JSON text, so a stored JSON string keeps its quotes (`"hello"`). Parse it with `JSON.parse` before you validate it.

Code that reads rows from the runtime driver's `query` without a codec now receives these strings for every column. Convert each value it uses, for example with `Number(row.count)` or `row.flag === 't'`.

## `codecs-decode-json-reads-stored-forms`

Code that calls a built-in codec's `decodeJson` must pass the stored JSON form of its type; another kind throws `RUNTIME.DECODE_FAILED` with the codec id in `meta`. A codec an extension contributes should follow the same rule, stated on `Codec.decodeJson` in `@internal/framework-components/codec`: read a stored JSON form of its type, including every form the database writes for it, and throw on anything else.

A codec's `decodeJson` reads a value in the stored JSON form of its type: a column's literal default in `contract.json`, a member of a value-object default, and a value inside the JSON the database returns for an included relation. The text codecs (`pg/text@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sqlite/text@1`, `pg/enum@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/tsquery@1`, `pg/timetz@1`, `pg/text-array@1` and the date and time codecs), the integer codecs `pg/int4@1`, `pg/int2@1` and `sql/int@1`, and `pg/bool@1` used to pass any JSON value through. Each now refuses a value of another kind with `RUNTIME.DECODE_FAILED`, naming the codec: a text codec takes a JSON string, `pg/int4@1` a JSON integer from -2147483648 to 2147483647, `pg/int2@1` one from -32768 to 32767, `sql/int@1` a safe integer, or on PostgreSQL, where its column is an int4, an integer from -2147483648 to 2147483647, `pg/bool@1` `true` or `false`, `pg/uuid@1` a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and a bit string only `0` and `1`. `pg/vector@1` refuses JSON that is not an array of the column's number of finite numbers with the same shape, as in `pg/vector@1 JSON value must be an array of 3 finite numbers`, where it said `Vector length mismatch` or `Vector value must contain only numbers`. `pg/int8@1` and `sqlite/bigint@1` take decimal text in the signed 64-bit range. `pg/timestamptz-date@1` refused a bad string with a plain `RangeError`; it now raises `RUNTIME.DECODE_FAILED` like the others. Every form PostgreSQL and SQLite write for a value the application type holds is still read; see `text-array-elements-nullable` and `sqlite-int-include-refuses-inexact-values` for the two stored values that now throw instead of reading wrong.

The float codecs `pg/float8@1`, `pg/float4@1`, `pg/float@1`, `sql/float@1` and `sqlite/real@1` take a finite JSON number or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which PostgreSQL writes for those values in JSON, and `encodeJson` writes that text for them. SQLite writes an infinity in JSON as `9.0e+999`, so on SQLite the float codecs' JSON projection writes the text instead. `sql/float@1`, `pg/float@1` and `sqlite/real@1` used to refuse NaN and the infinities, so an `.include()` of a row holding one failed with `RUNTIME.DECODE_FAILED`; it now reads the value. SQLite cannot store NaN, so on SQLite `sqlite/real@1` and `sql/float@1` refuse it; see `sqlite-nan-parameters-refused`.

Helpers for following the rule:

- `@internal/framework-components/codec` exports the JSON readers every family's codecs share: `decodeJsonString`, `decodeJsonMatching`, `decodeJsonBoolean`, `decodeJsonInteger` (with an `IntegerRange`), `decodeJsonIntegerText` (decimal text, with an optional `BigIntRange`), `decodeJsonFloat` and `encodeJsonFloat`, and `refuseJsonValue`, which raises the refusal they all raise: `RUNTIME.DECODE_FAILED`, `<codecId> JSON value must be <what it takes>`, with `meta.codecId` and `meta.received`, the value it got as JSON text, cut to 100 characters. It also exports the ranges they take, `INT32_RANGE` and `SAFE_INTEGER_RANGE` (`IntegerRange`, which `isIntegerIn(value, range)` tests a value against) and `INT64_RANGE` and `SAFE_INTEGER_BIGINT_RANGE` (`BigIntRange`), and `isNonFiniteText`, which says whether text is `NaN`, `Infinity` or `-Infinity`. The built-in codecs' refusals no longer say `database JSON value`.
- `@internal/utils/text` exports `counted`, which writes a count and its noun for a refusal, such as `3 characters`, and `withoutTrailing(text, character)`, which drops a trailing run of one character in time linear in the run's length.

## `mongo-codec-requires-decode-json`

`mongoCodec` now requires `decodeJson` when the codec's application type is narrower than `JsonValue`, such as `string` or `number`; only a codec whose application type is exactly `JsonValue` may leave it out. A codec that leaves it out no longer compiles. Supply a `decodeJson` that refuses a JSON value of another kind with `RUNTIME.DECODE_FAILED`, such as `decodeJsonString` or another reader from `@internal/framework-components/codec`.

## `sql-float-json-helpers-removed`

Replace `sqlFloatEncodeJson(value)` with `encodeJsonFloat(value)` and `sqlFloatDecodeJson(json)` with `decodeJsonFloat(codecId, json)`, and import `isNonFiniteText` from `@internal/framework-components/codec` instead of `@internal/sql-relational-core/ast`. An import of `isNonFiniteText` that already names `@internal/framework-components/codec` needs no change.

## `codec-lookup-has-no-descriptor-for`

`codecForRef(lookup, ref)` from `@internal/framework-components/codec` builds a column's codec from its descriptor, with the column's type parameters, so everything that builds one takes a `CodecLookupWithDescriptors`. `CodecLookup` no longer declares `descriptorFor`, not even as optional. Each of these no longer compiles:

- a `codecLookup` for `defineContract` or a `ContractSourceContext` without `descriptorFor`. Add one, as the registry `assemblePostgresCodecRegistryWithBuiltins` returns does, or leave `codecLookup` out of `defineContract` so it assembles the target's registry;
- a stub built as `{ ...emptyCodecLookup, get }` where a `CodecLookupWithDescriptors` is expected, because `emptyCodecLookup` no longer has a `descriptorFor` that answers `undefined`. Add a `descriptorFor` that answers for the same codecs as `get`, so the two never disagree;
- an object literal typed `CodecLookup` that sets `descriptorFor`, or a call `lookup.descriptorFor?.(id)` on a `CodecLookup`. Type the lookup `CodecLookupWithDescriptors` and call `descriptorFor(id)`.

## `mongo-codecs-check-json`

A Mongo codec's `decodeJson` reads the JSON form of its type. The Mongo runtime reads documents through `decode` and never calls it; the PSL reader calls it for each member of an enum. `mongo/string@1`, `mongo/objectId@1`, `mongo/int32@1`, `mongo/double@1`, `mongo/bool@1`, `mongo/vector@1` and `mongo/bson@1` used to return any JSON value as it was, so an enum member of the wrong kind was stored in the contract:

```prisma
enum Priority {
  @@type("mongo/int32@1")
  Low = "low"
}
```

This is now refused with `PSL_EXTENSION_INVALID_VALUE`, naming the codec's message, `mongo/int32@1 JSON value must be an integer from -2147483648 to 2147483647`. A member written without a value, such as a bare `Low`, under a codec that does not take text is `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`. Give each member a value of the codec's type.

Each codec now takes: `mongo/string@1` a string; `mongo/objectId@1` 24 hexadecimal digits; `mongo/int32@1` an integer from -2147483648 to 2147483647; `mongo/double@1` a number, or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which its `encodeJson` now writes for those values instead of a number JSON cannot hold; `mongo/bool@1` a boolean; `mongo/date@1` the text `Date.toISOString()` writes; `mongo/vector@1` an array of numbers; and `mongo/bson@1` canonical Extended JSON, the form its `encodeJson` writes. Another value throws `RUNTIME.DECODE_FAILED` with the codec id in `meta`. A TypeScript `enumType` member that `mongo/objectId@1` or `mongo/int32@1` does not hold now throws `RUNTIME.ENCODE_FAILED` when the contract is built.

## `text-array-elements-nullable`

`pg/text-array@1`, the codec of a contract-free `textArray()` column, reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`, and so is its entry in the Postgres `CodecTypes`. Code typed by a `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`. Read through an `.include()`, a two-dimensional `text[]` value now throws `RUNTIME.DECODE_FAILED`, where it read as the text `"a,b"`.

## `char-reads-drop-only-padding`

PostgreSQL pads a `char(n)` value with spaces to its length: `'a'` in a `char(3)` column is stored as `'a  '`. A flat read dropped every trailing whitespace character, so a stored `'a\t'` also read as `"a"`, while `.include()` returned the padded text, `"a  "`. Both reads now return the value without the padding and nothing more: `"a"` for `'a'`, and `"a\t"` for `'a\t'`. On SQLite, which does not pad, both reads drop trailing spaces, as a flat read did. Code that compared an included `char` value with its padding, or relied on a flat read dropping a trailing tab or newline, compares the value without its padding.

## `sqlite-nan-parameters-refused`

SQLite cannot store NaN: bound as a parameter, it becomes NULL. So `create({ value: 0 / 0 })` on an optional `Float` column stored NULL, and `where((p) => p.value.eq(Number.NaN))` matched nothing. On SQLite, `sqlite/real@1` and `sql/float@1` now refuse NaN with `RUNTIME.ENCODE_FAILED`, `<codecId> value must be a number other than NaN, which SQLite cannot store`, with `meta.codecId` and `meta.received`: when they encode a value to write or filter by, and when they encode a TypeScript `.default()`, which is still refused when the contract is built with `CONTRACT.DEFAULT_INVALID`, now with this message. Their `decodeJson` refuses the text `"NaN"`. A NaN parameter no codec encoded, such as one in raw SQL, is refused by the SQLite driver with the same code: `Parameter 2 is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`, with `meta.paramIndex`, counted from 0. On a required column SQLite already refused the NULL, so only the error changes. Where a computed value can be NaN, write `null` for no value, and filter with `isNull()` for rows that have none. Infinity and -Infinity are stored and read back as before.

## `sqlite-int-include-refuses-inexact-values`

`sql/int@1` holds a JavaScript safe integer. On SQLite, an INTEGER column can hold a larger integer or a REAL. An `.include()` read such a value rounded or with a fraction; it now throws `RUNTIME.DECODE_FAILED`, naming the codec. A flat read is unchanged. Store an integer past 2^53 in a `BigInt` column and a fraction in a `Float` column.

## `contract-build-takes-lookups`

The column's stored `dataType` is the data type its codec represents (see `contract-stores-data-type`), so the build needs both lookups. Through the facades, list every extension whose codec the contract uses:

```ts
defineContract({ extensions: { pgvector } }, ({ field, model }) => ({ /* … */ }));
```

A contract written with an empty definition (`defineContract({}, …)`) that names an extension's codec passes the lookups itself, as an extension's own contract space does:

```ts
// before
export const contract = defineContract({}, () => ({
  types: {
    [PGVECTOR_NATIVE_TYPE]: {
      kind: 'codec-instance',
      codecId: VECTOR_CODEC_ID,
      nativeType: PGVECTOR_NATIVE_TYPE,
      typeParams: {},
    },
  },
  models: {},
}));

// after
import { assembleDataTypes } from '@internal/framework-components/codec';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { pgvectorDataTypes } from './core/data-types';
import { pgvectorCodecRegistry } from './core/registry';

const dataTypeLookup = assembleDataTypes([
  { id: 'postgres', dataTypes: postgresDataTypes },
  { id: 'pgvector', dataTypes: pgvectorDataTypes },
]).lookup;
const codecLookup = assemblePostgresCodecRegistryWithBuiltins(
  [{ types: { codecTypes: { codecDescriptors: [...pgvectorCodecRegistry.values()] } } }],
  dataTypeLookup,
);

export const contract = defineContract(
  { codecLookup, dataTypeLookup },
  () => ({
    types: {
      [PGVECTOR_NATIVE_TYPE]: {
        kind: 'codec-instance',
        codecId: VECTOR_CODEC_ID,
        typeParams: {},
      },
    },
    models: {},
  }),
);
```

The `storage.types` entry loses `nativeType` as `column-descriptors-drop-native-type` describes. A column whose codec the lookup lacks fails with `CONTRACT.CODEC_DESCRIPTOR_MISSING`; one whose codec's data type the lookup lacks fails with `CONTRACT.DATA_TYPE_UNREGISTERED`. A direct call of `buildSqlContractFromDefinition(definition, codecLookup, dataTypeLookup)` passes both.

## `define-contract-wrapper-builds-data-type-lookup`

A package that exposes its own `defineContract` over `buildBoundContract`, as the Postgres and SQLite facades do, makes four edits.

1. Directly after the first import, import the lookup types and the data type assembly:

   ```ts
   import {
     assembleDataTypes,
     type CodecLookupWithDescriptors,
     type DataTypeLookup,
   } from '@internal/framework-components/codec';
   ```

2. In the result type, the object passed to `ContractInput`'s build gains both lookups directly after `createNamespace`:

   ```ts
   readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
   readonly codecLookup: CodecLookupWithDescriptors;
   readonly dataTypeLookup: DataTypeLookup;
   ```

3. The scaffold type adds `'codecLookup' | 'dataTypeLookup'` at the end of the keys it omits from `ContractInput`, and takes both as optional overrides. When the `Omit<…>` is already intersected with an object type, the two members go at the start of that object; otherwise add `& { … }` with them:

   ```ts
   > & {
     /** Overrides the codecs of the target and the extensions. */
     readonly codecLookup?: CodecLookupWithDescriptors;
     /** Overrides the data types of the target and the extensions. */
     readonly dataTypeLookup?: DataTypeLookup;
   ```

4. In the implementation, assemble the data type lookup once, with the target pack as the first contributor, and build the codec lookup against it. On Postgres, `assemblePostgresCodecRegistryWithBuiltins` now takes the data type lookup as its second argument:

   ```ts
   const extensions: readonly ExtensionPackRef<'sql', string>[] = Object.values(
     definition.extensions ?? {},
   );
   const dataTypeLookup =
     definition.dataTypeLookup ?? assembleDataTypes([postgresPack, ...extensions]).lookup;
   const bound = {
     ...definition,
     createNamespace: postgresCreateNamespace,
     codecLookup:
       definition.codecLookup ??
       assemblePostgresCodecRegistryWithBuiltins(extensions, dataTypeLookup),
     dataTypeLookup,
   };
   ```

   On SQLite, the target constant is the first contributor:

   ```ts
   const extensionPacks: readonly ExtensionPackRef<'sql', string>[] = Object.values(
     definition.extensions ?? {},
   );
   const bound = {
     ...definition,
     createNamespace: sqliteCreateNamespace,
     codecLookup: definition.codecLookup ?? assembleSqliteCodecRegistry(target, extensionPacks),
     dataTypeLookup:
       definition.dataTypeLookup ?? assembleDataTypes([target, ...extensionPacks]).lookup,
   };
   ```

   Both refuse a data type id that two packs register, with `CONTRACT.DATA_TYPE_DUPLICATE`.

## `postgres-codec-registry-takes-data-type-lookup`

The Postgres codec registry no longer carries the data types. Each function that builds one takes the data type lookup its codecs are checked against, and refuses a codec whose data type the lookup lacks with `CONTRACT.DATA_TYPE_UNREGISTERED`. Build the lookup first, from the same components, with `assembleDataTypes(components).lookup` from `@internal/framework-components/codec`, or take the target's own with `createPostgresBuiltinDataTypeLookup()` from `@internal/target-postgres/data-types`:

```ts
// before
const codecRegistry = assemblePostgresCodecRegistry(components);
const adapter = new PostgresControlAdapter(codecRegistry);

// after
const dataTypeLookup = assembleDataTypes(components).lookup;
const codecRegistry = assemblePostgresCodecRegistry(components, dataTypeLookup);
const adapter = new PostgresControlAdapter(codecRegistry, dataTypeLookup);
```

`assemblePostgresCodecRegistryWithBuiltins(extensions, dataTypeLookup)` and `createPostgresAdapterWithCodecRegistry(codecRegistry, dataTypeLookup)` change the same way. `createPostgresCodecRegistryWithBuiltins(codecDescriptors, dataTypeLookup)` takes the lookup in place of a list of data types, and defaults to the target's own. A built-in adapter in a test is `new PostgresControlAdapter(createPostgresBuiltinCodecLookup(), createPostgresBuiltinDataTypeLookup())`.

## `contract-to-schema-takes-components`

```ts
// before
const fromSchema = migrations.contractToSchema(fromContract);

// after
const fromSchema = migrations.contractToSchema(fromContract, frameworkComponents);
```

Pass the framework components of the stack the contract was built with. A custom target's implementation passes them on to the family's `contractToSchemaIR` as `dataTypeLookup` and `codecLookup`.

## `contract-to-schema-ir-takes-lookups`

```ts
// before
contractToSchemaIR(contract, { annotationNamespace: 'pg', expandNativeType });

// after
contractToSchemaIR(contract, { annotationNamespace: 'pg', dataTypeLookup, codecLookup });
```

`dataTypeLookup` and `codecLookup` come from the assembled stack: `sqlTypeLookupsOf(frameworkComponents)` from `@internal/family-sql/control` returns both. Every field or parameter that holds a `DataTypeLookup` is now named `dataTypeLookup`; `dataTypes` names only a list of data types.

## `authoring-entity-context-takes-data-type-lookup`

```ts
// before
const ctx: AuthoringEntityContext = { family: 'sql', target: 'postgres' };

// after
const ctx: AuthoringEntityContext = {
  family: 'sql',
  target: 'postgres',
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};
```

Pass the lookups of the stack the context serves; `createDataTypeLookup` from `@internal/framework-components/codec` builds a data type lookup from a list of data types, and `{ ...emptyCodecLookup, descriptorFor: () => undefined }`, with `emptyCodecLookup` from the same module, stands in where no codecs apply. A stub codec lookup that answers `descriptorFor` is typed `CodecLookupWithDescriptors`. A call of `interpretPslDocumentToMongoContract` passes `codecLookup` as well: the stack's codec lookup, or that stand-in.

## `mongo-derive-json-schema-takes-lookups`

```ts
// before
deriveJsonSchema(fields, valueObjects, codecLookup, valueSets);
derivePolymorphicJsonSchema(baseFields, discriminator, variants, valueObjects, codecLookup, valueSets);

// after
deriveJsonSchema(fields, { codecLookup, dataTypeLookup }, valueObjects, valueSets);
derivePolymorphicJsonSchema(
  baseFields,
  discriminator,
  variants,
  { codecLookup, dataTypeLookup },
  valueObjects,
  valueSets,
);
```

`codecLookup` is a `CodecLookupWithDescriptors`, the stack's codec lookup. `dataTypeLookup` holds the stack's data types: `createDataTypeLookup(mongoDataTypes)`, with `createDataTypeLookup` from `@internal/framework-components/codec` and `mongoDataTypes` from `@internal/target-mongo/data-types`, plus any data types the extension registers. A call that passed no codec lookup passes the stack's now; without it the validator left out every scalar field's BSON type.

## `field-type-params-come-from-the-domain-type`

- `buildSqlContractFromDefinition` takes a model field's domain type parameters from its `descriptor.typeParams`, or else from the named storage type its `descriptor.typeRef` names. A value-object model field carries its column's `descriptor` (the target's value-object storage type) instead of the builder assuming `jsonb`. A value-object member has no `columnName` and is typed by a codec and its type parameters only.
- `EmissionSpi.resolveFieldTypeParams` is removed. A family whose domain fields do not carry their type parameters puts them there when it builds the contract.
- `generateFieldOutputTypesMap` from `@internal/emitter` takes `(models, codecLookup)`: its third parameter, the type-parameter resolver, is removed with the hook.

## `sql-infer-psl-contract-takes-build-context`

The SQL family calls a target's `inferPslContract(schema, context, describedContracts?)` with the same `SqlPslBuildContext` it passes `buildPslContract`: the stack's authoring contributions, codec lookup and data types. `contract emit` reads the inferred schema with that stack, so a target reads a written type's codec and type parameters from `context.authoringContributions.type` and `context.codecLookup` instead of a table of its own. A target that implements the hook adds the parameter.

Code that called the hook on a target descriptor, such as a script that infers PSL from an introspected schema, has no context to pass. It calls the SQL family instance's `inferPslContract(schema)`, which builds the context from the control stack it was created with:

```ts
// before
const inferPslContract = postgresTargetDescriptor.inferPslContract;
if (!inferPslContract) {
  throw new Error('the postgres target descriptor has no inferPslContract');
}
const ast = inferPslContract(rawSchemaNode);

// after
const ast = sqlFamilyDescriptor.create(controlStack).inferPslContract(rawSchemaNode);
```

`sqlFamilyDescriptor` is the default export of `@internal/family-sql/control`, and `controlStack` is the stack `createControlStack` from `@internal/framework-components/control` builds for the family, target, adapter and driver the script already uses.

## `imported-postgres-field-checks-defaults`

`import { field } from '@prisma/orm-postgres/contract-builder'` now gives the same field builders the `defineContract` callback receives, without the ones an extension adds: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()`, and `field.column(columnType)` as before. Its `.default(...)` now checks the value against the Postgres target's column types; a column type an extension adds, such as pgvector's `vector`, is not checked. A default of another type no longer compiles:

```diff
- field.column(int8Column).default(1)
+ field.column(int8Column).default(1n)
```

## `codecs-check-stored-json`

The built-in SQL, PostgreSQL and SQLite codecs now refuse a value that is not a stored form of their type, including one its type parameters rule out, where most used to pass it through. A TypeScript `.default()` given such a value is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` naming the model and field: a value of another kind, such as a number for a text column, or one the PostgreSQL column rules in `psl-values-checked-by-codecs` refuse, such as `'toolong'` for a `varchar(3)` column. A TypeScript `enumType` member its codec does not take is refused the same way, with `CONTRACT.ENUM_INVALID` naming the enum, the member and the codec: for example a `pg/char@1` or `sql/char@1` member longer than one character on PostgreSQL, since the enum's column is `character`, which holds one. Correct the value the error names.

A `contract.json` with such a default, emitted by an earlier version or edited by hand, still loads. `db init`, `db update` and `migration plan` used to plan the default; they now stop with `CONTRACT.DEFAULT_INVALID`, which names the table, the column, the codec and the value. Emit the contract again with this version, and correct the default in the contract source if emit refuses it. Running a `migration.ts` that an earlier version planned with such a default fails with the same message; correct the default in that file. Every statement that writes a default reads it this way: a new table or column, a changed default, and on SQLite a rebuilt table, which used to write a changed default or a rebuilt table's defaults unread. Each element of a list default is read the same way, and the message names the element's position: `Column "post"."tags" has a default (element 2) its codec pg/text@1 refuses: pg/text@1 JSON value must be a string`. A NULL element stays NULL. The codecs that carry PostgreSQL's own date and time text, those of `DateString`, `TimeString`, `TimestampString`, `TimestamptzString` and `Timetz`, read only a date or time in ISO 8601 or as PostgreSQL writes it, so such a default as `'now'`, which PostgreSQL would read once when it creates the table, is refused the same way. An `.include()` of such a column reads the text PostgreSQL writes in the ISO DateStyle, its default; on a server set to another DateStyle it now fails with `RUNTIME.DECODE_FAILED`, where it passed the text through. Set `DateStyle` to `ISO` on that server.

## `psl-values-checked-by-codecs`

The PSL reader reads each literal default, and each member of a SQL `enum`, with the column's codec, so the stricter codecs refuse schemas that loaded before. A value of another kind is refused: a text codec takes a string, an integer codec an integer in its range, `Boolean` `true` or `false`, and `Uuid` a UUID. On PostgreSQL the codecs also check what the column stores:

- `VarChar(n)` and `Char(n)` take at most n characters, counted by code point, and a `Char` value's trailing spaces do not count. A `Char` without a length is `character(1)`, so it takes one character.
- `Bit(n)` takes exactly n bits and `VarBit(n)` at most n, and a bit column without a length is `bit(1)`.
- `Numeric(p, s)` takes a value it stores without rounding.
- `Int`, `sql/int@1` and an enum whose members are integers take an integer from -2147483648 to 2147483647, and `SmallInt` one from -32768 to 32767.
- `Real` takes a finite number only if float4 holds it, neither overflowing to an infinity nor becoming 0.

Such a default used to load, and the migration planned and applied; the first insert that used the default then failed. A `Char` or bit column without a length, which did not apply on PostgreSQL whatever its default, now applies as `character(1)` or `bit(1)`. SQLite does not enforce a declared length, so on SQLite the char and varchar codecs take text of any length. Each of these is now refused at `contract emit`:

| Schema | Diagnostic |
| --- | --- |
| `enum P { @@type("pg/int4@1") Low = "low" }` | `PSL_EXTENSION_INVALID_VALUE`: `enum "P" member "Low" was rejected by codec "pg/int4@1": pg/int4@1 JSON value must be an integer from -2147483648 to 2147483647` |
| the same enum with a bare `Low` | `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`: `enum "P" member "Low" has no value and codec "pg/int4@1" does not accept a bare name as input` |
| `enum P { @@type("pg/text@1") Low = 1 }` | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/text has no cast from pg/int2; it casts from nothing` |
| an enum without `@@type` whose integer members include one outside -2147483648 to 2147483647, such as `Low = 3000000000` | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2` |
| `u Uuid @default("nope")` | `PSL_INVALID_LITERAL`, `"nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.` |
| `s VarChar(3) @default("toolong")` | `PSL_INVALID_DEFAULT_LITERAL`, `sql/varchar@1 JSON value must be a string of at most 3 characters` |
| `c Char @default("abc")` on PostgreSQL | `PSL_INVALID_DEFAULT_LITERAL`, `sql/char@1 JSON value must be a string of at most 1 character before any trailing spaces` |
| `enum P { @@type("sql/int@1") Low = 3000000000 }` on PostgreSQL | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2` |
| `n Numeric(5, 2) @default(1.555)` | `PSL_INVALID_DEFAULT_LITERAL`, `pg/numeric@1 JSON value must be a decimal string that numeric(5, 2) stores without rounding` |

Give each enum member a value its codec takes, and each default a value its column's type holds unchanged. A `Uuid` default is still read in any form PostgreSQL reads; see `uuid-defaults-stored-as-postgresql-writes`.

## `value-object-default-matches-composite-type`

A literal default on a field typed by a composite type used to be stored whatever its shape. It is now checked, naming the path that is wrong, as in `Field "User.home.street"`:

- A single value object takes a JSON object, and a list of them a JSON array: `` homes Address[] @default(json`{"street": "x"}`) `` is refused; write `@default([])` or `` @default(json`[{"street": "x"}]`) ``. JSON `null` is taken when the field is optional. `PSL_VALUE_TYPE_INCOMPATIBLE`.
- A key that is not a member is refused, and so is a missing member that is not optional, and `null` for a member that is not optional. `PSL_VALUE_TYPE_INCOMPATIBLE`.
- The default holds each member in the form its codec stores, so the member's codec must read the value. A `Decimal`, `Numeric(p, s)` or `BigInt` member takes a decimal string, `"1.5"`, and a number is refused; a `String` member takes a JSON string, so `"street": 1` is refused; a `DateTime` member takes a date and time string; a `Json` member takes any JSON value. `PSL_INVALID_DEFAULT_LITERAL`, with the codec's message.
- A member typed by an enum takes only the enum's values: `PSL_INVALID_DEFAULT_LITERAL`, `Expected one of:` the values.
- Nested value objects are checked the same way.

Correct the value the diagnostic names.

## `composite-type-attributes-refused`

An attribute inside a `type` block was ignored: `street String @default("x")` stored no default, and `@@map` mapped nothing. Each is now refused, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` on a member and `PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE` on the type. Remove the attribute. To give a value object a default, write it on the model field as a whole value, such as `` home Address @default(json`{"street": "x"}`) ``.

## `uuid-defaults-stored-as-postgresql-writes`

A `Uuid` default may be written in any form PostgreSQL reads: either case, with or without a hyphen after any group of four digits, and optionally in braces. The contract now stores it as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and so does a TypeScript `.default()` on a `pg/uuid@1` column, so the applied default verifies against the database with no difference.

Earlier versions stored such a default as written. The database stores the lower-case form, so the check that runs after the change is applied failed: `db init`, `db update` and `db migrate` stopped with `MIGRATION.RUNNER_FAILED` and rolled the change back. The database has none of the changes that contract adds, and no marker for it. With this version, a `contract.json` that still holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, as `codecs-check-stored-json` describes.

Emit the contract again with this version. The stored default changes, and with it the storage hash. Then:

- For a project kept with `db init` or `db update`, run the command that failed again. It applies the contract, and `db verify` then passes.
- For a project with migrations, delete the migration package that never applied: its directory under `migrations/app/`, and its contract snapshot `migrations/snapshots/<hash>/`, where `<hash>` is the `to` hash in the package's `migration.json`. Then run `prisma migration plan` and `prisma db migrate`. Left in place, the package stays in the migration graph, ending at a contract no database reaches.

## `domain-types-match-their-columns`

Run `prisma contract emit`. `contract.json` and `contract.d.ts` gain these entries in the domain half:

| PSL | Added to the field's domain entry |
| --- | --- |
| `code Short`, with `types { Short = VarChar(10) }` (also `Short[]`) | `"typeParams": { "length": 10 }` on `type` |
| `roles Role[]`, where `Role` is an `enum` | `"valueSet": { "plane": "domain", "entityKind": "enum", "namespaceId": "public", "entityName": "Role" }`, as `role Role` already had |
| composite type member `amount Numeric(10, 2)` (also a list, or a named type) | `"typeParams": { "precision": 10, "scale": 2 }` on `type` |
| composite type member `role Role` or `roles Role[]` | the same `valueSet` as a model field of that enum |

A named type without parameters, such as `Email = String`, adds nothing.

In `contract.d.ts`, a composite type's output type (`AddressOutput`) now gives a member with type parameters the parameterized output type a model field of that type has, such as `Varchar<10>` or `Numeric<10, 2>`, instead of the codec's plain output type. These are branded strings, so code that builds such an output object from plain strings, such as a test fixture or a mock, no longer type-checks. Build the value as the ORM returns it, or type it with the composite type's input type (`AddressInput`), which is unchanged.

Migration snapshots under `migrations/snapshots/<hash>/` need no change for this. Migration commands read only their storage half, which this change leaves unchanged. The script of `contract-stores-data-type` rewrites the storage half and the snapshots separately.

`prisma contract print` now expects a field typed by a parameterized named type, and an enum list field, to carry these domain entries. It refuses a contract emitted before this change that lacks them. Re-emit it first.

A pack that ships a contract with such fields re-emits it with `build:contract-space` (`prisma contract emit`).

## `default-renderer-receives-data-type`

```ts
// before
const renderDefault: DefaultRenderer = (def, column) => render(def);
renderDefaultLiteral(value, { many: true, nativeType: 'text', dataTypeId: 'pg/text' });

// after
const renderDefault: DefaultRenderer = (def, column, type) => render(def, type.baseTypeName);
renderDefaultLiteral(value, { many: { elementNullable: false }, baseTypeName: 'text', dataType: 'pg/text' });
```

`baseTypeName` is the type's written name without parameters, for example `jsonb` or `varchar`. Compare `dataType`, for example `pg/jsonb`, when the decision depends on which type the column stores.

## `ddl-column-default-visitor-removed`

Code that dispatched a column default through `accept` reads its `kind` instead:

```ts
// before
const sql = node.accept({ literal: (n, ctx) => renderLiteral(n, ctx.nativeType), function: (n) => n.expression }, { nativeType: 'jsonb' });

// after
const sql = node.kind === 'literal' ? renderLiteral(node, 'jsonb') : node.expression;
```

## `ddl-nodes-hold-opaque-sql`

SQL that Prisma places inside a larger statement now travels as an `OpaqueSql` value, exported with `opaqueSql` and `renderOpaqueSql` from `@internal/sql-relational-core/ast`. These types changed:

| Type | Field | Was | Is |
| --- | --- | --- | --- |
| `FunctionColumnDefault` | `expression` | `string` | `OpaqueSql` |
| `CheckExpressionConstraint` | `expression` | `string` | `OpaqueSql` |
| `PostgresCreatePolicy` | `using`, `withCheck` | `string \| undefined` | `OpaqueSql \| undefined` |
| `PostgresCreateIndex` | `where` | `string \| undefined` | `OpaqueSql \| undefined` |
| `PostgresCreateIndex` | `elements.expression` | `string` | `OpaqueSql` |
| `DdlIndexElements` (`@internal/target-postgres/ddl`) | `expression` | `string` | `OpaqueSql` |

Code that constructs one of these nodes directly wraps the string:

```diff
- new FunctionColumnDefault('now()')
+ new FunctionColumnDefault(opaqueSql('now()'))
```

The factories `fn` and `checkExpression` still take strings, as do `createPolicy` and `createIndex` inside the Postgres target. Prefer a factory over a constructor where one is exported:

```diff
- new CheckExpressionConstraint({ name: 'chk', expression: 'price > 0' })
+ checkExpression('chk', 'price > 0')
```

`createIndex` now takes its element list as `CreateIndexElements`, which holds strings and is exported from `@internal/target-postgres/ddl` next to `DdlIndexElements`. Code that typed the elements it passes to `createIndex` as `DdlIndexElements` uses `CreateIndexElements` instead.

Code that reads `.expression`, `.using`, `.withCheck` or `.where` of these nodes now reads `.text`. The TypeScript compiler reports a read only where the value goes to a `string`, such as a comparison with a string or a `string` parameter. It does not report a read placed in a template string, which renders `[object Object]`, or passed to a function that accepts any value, such as `JSON.stringify` or a code generator. Search your code for these reads and check each one.

An adapter that renders these nodes into SQL renders the SQL with `renderOpaqueSql(node.expression)`, not `node.expression.text`. `renderOpaqueSql` ends text that contains `--` with a line break, so a line comment on the last line cannot comment out the rest of the statement.

## `adapter-writes-column-defaults`

The control adapter writes every column default that DDL writes, for a new table, a new column, a changed default and a rebuilt SQLite table, through one method on `ExecuteRequestLowerer`, which `SqlControlAdapter` extends (`family/control-adapter` of `@prisma/orm-postgres`, `@prisma/orm-sqlite` and `@prisma/orm-family-sql`):

```typescript
renderColumnDefault(column: DdlColumn, table: string): Promise<string>
```

It returns the `DEFAULT …` clause for the column, or `''` when the column has none or writes it another way, as an autoincrement column does. It reads a literal default, and each element of a list default, with the column's codec first, so a value the codec refuses is `CONTRACT.DEFAULT_INVALID` naming the table and the column.

- **An `ExecuteRequestLowerer` or `SqlControlAdapter` implementation** must add the method, and so must a fake lowerer in tests. An adapter returns the clause its CREATE TABLE writes for the column. To read a literal default with the column's codec, use `encodeLiteralDefault` and `encodeListLiteralDefault` from `relational-core/ast`. A fake that writes no defaults can return `''`:

  ```typescript
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: '', params: [] }),
    lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
    renderColumnDefault: async () => '',
  };
  ```

- **`buildColumnDefaultSql`** is removed from `target/planner-ddl-builders` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`. Build the column with `col`, `lit` and `fn` from `relational-core/contract-free`, and ask the adapter for the clause:

  ```typescript
  // before
  const clause = buildColumnDefaultSql({ kind: 'literal', value: 'member' }, { nativeType: 'text' });
  // after
  const clause = await adapter.renderColumnDefault(
    col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }),
    'user',
  );
  ```

- **`SetDefaultCall`** (`target/op-factory-call` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`) takes the column instead of its name and the SQL text:

  ```typescript
  // before
  new SetDefaultCall('public', 'user', 'role', "DEFAULT 'member'", 'widening');
  // after
  new SetDefaultCall('public', 'user', col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }), 'widening');
  ```

## `migration-ts-column-defaults`

A `migration.ts` no longer carries a column default as SQL text. The control adapter writes the `DEFAULT …` clause for every statement, the same way for a new table, a new column, a changed default and a rebuilt SQLite table, and it reads a literal default with the column's codec first. A `migration.ts` that sets a default the codec refuses fails when it runs, with `CONTRACT.DEFAULT_INVALID` naming the table and the column.

On PostgreSQL, `setDefault` takes the column and its default:

```typescript
// before
this.setDefault({ table: 'user', column: 'role', defaultSql: "DEFAULT 'member'" })
// after
this.setDefault({ table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }) })
```

On SQLite, a column in `addColumn` or `recreateTable` carries the default and its codec, and a `recreateTable` postcheck that checks a default names the column:

```typescript
// before
{ name: 'role', typeSql: 'TEXT', defaultSql: "DEFAULT 'member'", nullable: false }
{ description: 'verify "role" default on "user"', sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE ..." }
// after
{ name: 'role', typeSql: 'TEXT', default: { kind: 'literal', value: 'member' }, codecRef: { codecId: 'sqlite/text@1' }, nullable: false }
{ description: 'verify "role" default on "user"', columnDefault: 'role' }
```

An applied migration needs nothing: `db migrate` applies `ops.json`, which holds the SQL. Change a `migration.ts` this way only when you run it again to write `ops.json`. `node migration.ts` does not check types, so an earlier file still runs; `setDefault`, `addColumn` and `recreateTable` then refuse a `defaultSql` with `MIGRATION.OPERATION_OPTION_REMOVED`, naming the table and the column, rather than leave the default out. Rewrite the call as shown, or, if the migration is not applied, delete its package and run `migration plan` again.

The `migration.ts` that `migration plan` writes for a new SQLite table now gives each column its `codecRef`, so running it writes the same `ops.json` as the plan.

## `rename-check-constraint-call-is-rename-constraint-call`

Find references to the class `RenameCheckConstraintCall`, imported from `@prisma/orm-postgres/target/op-factory-call` or `@internal/target-postgres/op-factory-call`. The class is now `RenameConstraintCall`. It also renames primary keys, unique constraints and foreign keys, so it takes the constraint kind as a new third constructor argument: `'primaryKey'`, `'unique'`, `'foreignKey'` or `'checkConstraint'`.

- Rename the import and every reference to `RenameConstraintCall`.
- Change `new RenameCheckConstraintCall(schema, table, from, to)` to `new RenameConstraintCall(schema, table, 'checkConstraint', from, to)`.
- Change a comparison of a call's `factoryName` with `'renameCheckConstraint'`, or a `case 'renameCheckConstraint':` over it, to test `factoryName === 'renameConstraint' && call.kind === 'checkConstraint'`.

The operation a check-constraint rename produces keeps its id, label and SQL. It now renders as `this.renameConstraint({ ..., kind: "checkConstraint", ... })`. Migration files that call `this.renameCheckConstraint({ ... })` keep working; leave them unchanged.

## `control-family-instance-sign-spaces`

A family that implements `ControlFamilyInstance` adds `signSpaces`:

```ts
signSpaces(options: {
  readonly driver: ControlDriverInstance<TFamilyId, string>;
  readonly spaces: readonly SpaceToSign[];
}): Promise<readonly SpaceSignature[]>;
```

`SpaceToSign` is `{ space, contract, expected }`, where `expected` is the marker `db sign` read before it verified the space. The method writes each space's marker with its contract's hashes and returns one `SpaceSignature` per space: `{ status, space, contract: { storageHash, profileHash } }`, where `status` is `created`, `updated` (with `previous`, the hashes the marker held) or `unchanged`. It writes a space's marker only while the marker still holds `expected`, and returns `{ status: 'conflict', space, contract, expected, found }` for a space whose marker changed, whether it finds that on reading the marker or when its compare-and-swap write fails. It does not verify the schema; `db sign` verifies every space before it calls the method. A SQL family's control adapter implements `lockMarker(driver)`, which takes the one lock the target's migration runner holds while it reads and writes markers. The SQL family writes every marker in one transaction, so a failed write leaves every marker as it was; the Mongo family writes them one by one, and running `db sign` again finishes the job.

`ControlFamilyInstance.sign`, `ControlClient.sign`, `SignOptions` and `SignDatabaseResult` are removed: a family that implemented `sign` deletes it and keeps `signSpaces`, and code that called `client.sign({ contract })` calls `client.dbSign({ contract, migrationsDir })`, which verifies every contract space and signs each one that verified, as `db sign` does.

## `db-sign-signs-extension-spaces`

`db sign` signs the contract space of every extension in the project together with the application's, and signs a space only when its schema verifies; a space that does not verify is reported with its differences and the command exits with code 4. If your extension's documentation explains what happens when a user's database does not match your contract space, add that `db sign` does not sign the space either. The Supabase extension's `src/contract/CONTRACT-FIDELITY.md` adds this sentence at the end of the paragraph that says a database with a different constraint set fails verify:

> `db sign` signs a contract space only when its schema verifies, so such a database cannot be signed for this pack's space either: `db sign` signs the application's space, reports this one with its differences and exits 4.

## `cli-error-from-caught`

`mapCaughtMigrationError(error)`, exported from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`), returned a CLI error unchanged and `null` for anything else, which the caller wrapped as `CLI.UNEXPECTED`. `errorFromCaught(error, why)`, exported from the same place, does the whole job: it returns a CLI error unchanged, reports any other error with a structured `NAMESPACE.SUBCODE` code as itself, reports anything else as `CLI.UNEXPECTED` with `why` given the error's message, and throws an `InternalError` again. Replace `mapCaughtMigrationError(error) ?? errorUnexpected(...)` with `errorFromCaught(error, (message) => ...)`. A caller that holds a database connection string passes it as `errorFromCaught(error, why, { connection })`, which removes it from every field of the reported error.

## `adapter-control-loads-temporal-polyfill`

The adapter contributes the PostgreSQL type constructors, which it imports from the target's control entry, and that entry sets up the fallback `Temporal` from `temporal-polyfill`. So the adapter's control entry, `@prisma/orm-postgres/adapter/control` or `@prisma/orm-target-postgres/adapter/control`, now loads `temporal-polyfill` as well. Both packages declare it as a required peer dependency, and npm, pnpm and bun install it automatically.

For each Yarn project whose tests or tooling load the adapter's control entry, `detection` finds the import. If the project's `package.json` does not already list `temporal-polyfill`, add `"temporal-polyfill": "^1.0.4"` to its `devDependencies` and reinstall. Without it, a test or script that loads the adapter's control entry fails because Node.js cannot find the package `temporal-polyfill`.

## `parameter-casts-use-base-names`

A cast written into query text names the data type's base name and never its parameters, because an explicit cast to `varchar(n)` truncates and to `numeric(p,s)` rounds:

| Before | After |
| --- | --- |
| `$1::integer` | `$1::int4` |
| `$1::smallint` | `$1::int2` |
| `$1::bigint` | `$1::int8` |
| `$1::real` | `$1::float4` |
| `$1::double precision` | `$1::float8` |
| `$1::boolean` | `$1::bool` |
| `$1::integer[]` | `$1::int4[]` |

Update test expectations and snapshots that assert such text. Extension types keep their names (`$1::vector`, `$1::geometry`).

## `sql-builder-reads-codec-descriptors`

When a computed projection such as `fns.eq` or `fns.raw` names a codec id but no codec ref, `sql()` asks `context.codecDescriptors.descriptorFor(codecId)` whether the composed stack registers that id. A hand-built `ExecutionContext` that a test passes to `sql()` must therefore carry `codecDescriptors`. Add `codecDescriptors: { descriptorFor: () => undefined }` to the stub, or return a descriptor for the ids the test expects to decode. A context from `createExecutionContext` already has it.

## `select-ast-options-carry-locking`

`SelectAstOptions` now has a required `locking: ReadonlyArray<LockingClause> | undefined`. Where you construct `new SelectAst({ ... })` from an existing select's fields, add `locking: ast.locking` when you rebuild an existing select. Pass `locking: undefined` only for a select you build from nothing. Setting it to `undefined` while rebuilding an existing select removes the caller's `FOR UPDATE` without an error.

## `render-lowered-sql-takes-capabilities`

`renderLoweredSql(ast, contract, codecDescriptorRegistry)` is now `renderLoweredSql(ast, contract, codecDescriptorRegistry, dataTypeLookup, capabilities)`. The renderer writes PostgreSQL parameter casts from the data type lookup (see `parameter-casts-use-base-names`): pass the stack's, or the target's own from `createPostgresBuiltinDataTypeLookup()` in `@internal/target-postgres/data-types`. It refuses a locking clause whose strength or option the given capabilities do not report. To render as the Postgres adapter does, pass its capabilities:

```ts
import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { renderLoweredSql } from '@internal/adapter-postgres/sql-renderer';

renderLoweredSql(ast, contract, codecDescriptorRegistry, dataTypeLookup, postgresAdapterCapabilities);
```

## `sql-runtime-close-refusal-option`

`close()` on a SQL runtime waits for the work already in flight and refuses runtime-scope work that starts later with `DRIVER.NOT_CONNECTED` ("Runtime is closed"). The new `closeRefusal` option says when the refusal begins: `'at-once'` refuses from the call of `close()`, and `'when-idle'` refuses once the runtime has been idle for one turn of the event loop, so work that keeps it busy from the close onward is admitted.

The key is optional, so existing code compiles unchanged. In each place that constructs a runtime class that extends `SqlRuntimeBase`, or builds a `RuntimeOptions` object for one, decide whether to add it:

1. If the runtime belongs to a client or service that many callers share, such as a pooled client, pass `closeRefusal: 'at-once'`.
2. If the runtime belongs to one request or one scope, such as a per-request connection, leave the key out or pass `closeRefusal: 'when-idle'`.

## `writes-on-a-conditional-collection-are-refused`

`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` and `include` now return the collection they were called on, with what they establish added to its type as a fact. A custom collection class keeps its methods through the chain, so `db.Post.where({ userId }).withTitle('orm')` and `db.Post.include('user').withTitle('orm')` compile.

The facts have names. Write a filtered collection's type as `Filtered<C>` and an ordered one as `Ordered<C>`. `Filtered<C>` is `C & HasWhere`, and `HasWhere` is the name error messages print. Import the names from `@internal/sql-orm-client`, or from the `orm-client` entry of the facade your extension depends on.

The collection changes from here to `custom-collection-methods-chain`, `scope` included, apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it. `variant-takes-discriminator-value` applies to both.

A write needs a collection that is filtered on every code path. Code that filters only on some paths compiled before and no longer does:

```ts
const posts = search ? db.Post.withTitle(search) : db.Post;
await posts.deleteAll(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasWhere'
```

The same applies to an `if` with an early return, a `switch`, a loop, and a `let` reassigned in an `if`. Make the write only where the filter was applied, or filter on every path:

```diff
- const posts = search ? db.Post.withTitle(search) : db.Post;
- await posts.deleteAll();
+ if (search) {
+   await db.Post.withTitle(search).deleteAll();
+ }
```

If the code relied on deleting or updating every row when there is no filter, that was the unsafe case the check now refuses. State the intent with an explicit filter instead.

## `writes-refuse-what-they-would-ignore`

`updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter. They ignored a `limit`, an `offset`, a `cursor`, `distinct` and `distinctOn` on the collection, so a chain such as `db.orm.public.Post.where(...).limit(10).deleteAll()` deleted every matching row, not ten, and one with `.cursor({ id })` deleted the rows before the cursor too. They now throw `ORM.ARGUMENT_INVALID` instead. An order does not change which rows they change, and they still accept it. Remove what the write would ignore, or read the rows and change them by their ids:

```diff
- await db.orm.public.Post.where({ userId }).limit(10).deleteAll();
+ const ids = (await db.orm.public.Post.where({ userId }).select('id').limit(10).all()).map((p) => p.id);
+ await db.orm.public.Post.where((p) => p.id.in(ids)).deleteAll();
```

`update` and `delete` change one row, the one `first()` returns, so the order, the offset, the cursor, `distinct` and `distinctOn` choose it; they are unchanged, except after `limit(0)`. `first()` replaces the limit with 1, so after `limit(0)` they changed one row; they now change none and return `null`. A `limit(0)` that a request can set, such as a page size of zero, no longer writes.

The exception is `update` with a relation callback, such as `posts: (posts) => posts.connect(...)`. It finds its row by the filter alone and ignored the order, the limit, the offset, the cursor, `distinct` and `distinctOn`, so it could change another row than the chain chose. It now throws `ORM.ARGUMENT_INVALID` on a collection with any of them. Find the row first and filter to it:

```diff
- await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).update({ posts: (posts) => posts.connect([{ id: postId }]) });
+ const oldest = await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).select('id').first();
+ if (oldest) await users.where({ id: oldest.id }).update({ posts: (posts) => posts.connect([{ id: postId }]) });
```

## `cursor-and-distinct-on-check-the-receiver`

`cursor` and `distinctOn` need an order on the collection they are called on. The check is on the receiver, so a cast on the argument no longer bypasses it:

```ts
await db.Post.cursor({ id } as never).all(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasOrderBy'
```

Add the order the query needs:

```diff
- await db.Post.cursor({ id } as never).all();
+ await db.Post.orderBy((post) => post.id.asc()).cursor({ id }).all();
```

Where the query is meant to run without an order, cast the collection instead of the argument:

```ts
import type { Ordered } from '@internal/sql-orm-client';

const unordered = db.Post as Ordered<typeof db.Post>;
await unordered.cursor({ id }).all();
```

## `apply-is-a-collection-member`

Collections have a new method, `apply(fn)`, which calls `fn` with the collection and returns the result. A custom collection class that declares its own `apply` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   apply(limit: number) { return this.limit(limit); }
+   firstPage(limit: number) { return this.limit(limit); }
  }
```

An aggregate operation named `apply` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## `scope-is-a-collection-member`

Collections have a new method, `scope(body)`, which defines a scope for the collection's model: `db.orm.public.Post.scope((posts) => posts.select('id', 'title'))`. A custom collection class that declares its own `scope` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   scope(userId: string) { return this.where({ userId }); }
+   ownedBy(userId: string) { return this.where({ userId }); }
  }
```

An aggregate operation named `scope` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## `overriding-a-chaining-method`

A class that extends `Collection` and overrides one of the chaining methods, or one of the methods that return rows (`all`, `first`, `create`, `createAll`, `upsert` and the writes), must declare the override with the new signature: a type parameter for the receiver, a `this` parameter of that type, and the result type the base method returns. Call the base method with `call` and explicit type arguments, so that the receiver type passes through:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   override limit(n: number) {
-     return super.limit(Math.min(n, 100));
-   }
+   override limit<Self>(this: Self, n: number): Self {
+     return super.limit.call<Self, [number], Self>(this, Math.min(n, 100));
+   }
  }
```

Only classes that extend the SQL `Collection` are affected; skip matches in other classes.

## `collection-state-flags-are-boolean`

`DefaultCollectionTypeState` declares `hasWhere`, `hasOrderBy` and `hasUniqueFilter` as `boolean`, meaning not known. A method that establishes a flag sets it to `true`. Where your code expects `false`, expect `boolean`:

```diff
- type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], false>;
+ type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], boolean>;
```

A type of your own that sets a flag to `false` should set it to `boolean`. The writes still need `hasWhere: true`, and `cursor` and `distinctOn` still need `hasOrderBy: true`.

## `read-collection-state-and-row-with-helpers`

`where`, `orderBy` and `include` record what they establish in two declared properties, not in the type arguments of `Collection`. Inferring the third or fourth type argument gives the row and the state the collection started with. Read them with `CollectionRowOf` and `CollectionTypeStateOf` instead:

```diff
- type RowOf<C> = C extends Collection<infer _C, infer _M, infer Row, infer _S> ? Row : never;
- type UsersRow = RowOf<typeof users>;
+ import type { CollectionRowOf } from '@internal/sql-orm-client';
+ type UsersRow = CollectionRowOf<typeof users>;
```

To keep a helper of your own, constrain its parameter, because both helpers require one:

```ts
import type { CollectionRowOf, CollectionTypeStateOf, HasRow, HasTypeState } from '@internal/sql-orm-client';

type RowOf<C extends HasRow> = CollectionRowOf<C>;
type StateOf<C extends HasTypeState> = CollectionTypeStateOf<C>;
```

## `return-type-of-a-chaining-method`

The chaining methods are generic in their receiver, and `ReturnType` of a generic method uses the constraint of its type parameter. `ReturnType<PostCollection['where']>` is now `HasWhere`, and `ReturnType<PostCollection['limit']>` is `unknown`. Write the type with `Filtered` after `where`, `Ordered` after `orderBy`, and the collection type itself after `limit`, `offset`, `distinct`, `distinctOn` and `cursor`. You can also take `typeof` of a value:

```diff
- type MatchingPosts = ReturnType<PostCollection['where']>;
+ import type { Filtered } from '@internal/sql-orm-client';
+ type MatchingPosts = Filtered<PostCollection>;
```

`ReturnType` of a method of your own class, such as `ReturnType<PostCollection['withTitle']>`, still works.

## `chaining-methods-take-no-explicit-type-arguments`

These methods infer their receiver from the call. With explicit type arguments the receiver is not inferred: `posts.include<'user'>('user')` does not compile, `posts.distinct<['title']>('title')` and `posts.distinctOn<['title']>('title')` fail with "Expected 2 type arguments, but got 1", and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments. They are inferred from the arguments, so `distinct<['title']>('title')` becomes `distinct('title')`:

```diff
- const titles = posts.distinct<['title']>('title');
+ const titles = posts.distinct('title');
```

To name the type of an include, call `include` on a value and take its type:

```diff
- type WithUser = ReturnType<typeof posts.include<'user'>>;
+ const withUser = posts.include('user');
+ type WithUser = typeof withUser;
```

## `custom-collection-methods-chain`

Custom collection methods are now available after `where`, `orderBy`, `limit` and the other chaining methods. Where code on a client built with `orm({ collections })` repeats a class method's body inline after a chaining call on that class, it can call the method. A client without custom classes, such as `db.orm`, has no such methods.

```diff
  return db.Post.forUser(userId)
-   .orderBy((post) => post.createdAt.desc())
+   .newestFirst()
    .limit(limit)
    .all();
```

Here `newestFirst()` is a method of the application's `PostCollection` whose body is that `orderBy`.

## `variant-takes-discriminator-value`

For every `.variant(...)` call matched by `detection`, replace the variant's model name with the discriminator value that variant declares. Read the value from the contract: in PSL it is the second argument of the variant's `@@base(Base, "<value>")`; in the TypeScript builder it is the `value` under the base model's `discriminator.variants.<VariantName>`; in `contract.json` it is `domain.namespaces.<ns>.models.<Base>.variants.<VariantName>.value`.

```ts
// before
db.orm.public.Task.variant('Bug');
db.orm.events.variant('ViewProductEvent');

// after, for @@base(Task, "bug") and a ViewProductEvent variant declaring "view-product"
db.orm.public.Task.variant('bug');
db.orm.events.variant('view-product');
```

Custom collection methods that call `this.variant('<ModelName>')`, and helpers or closures that call `.variant()`, change the same way. When the argument is a variable or a forwarded parameter, follow it back to where the model name is written and replace it there, including in type annotations that list variant model names. Update code comments and READMEs that show `.variant('<ModelName>')` too.

The type checker catches most old call sites, because the parameter only accepts the base model's declared values. It does not catch a call whose model-name argument happens to equal a declared value, for example a variant model declared with `@@base(Base, "Admin")`. Such a call keeps compiling and now selects the variant declaring that value, so check every call site against the contract rather than relying on type errors.

A call that passes a value through `as never` or another cast also escapes the type checker. At runtime, a value the base model does not declare, or a `variant()` call on a model without a discriminator, throws `ORM.ARGUMENT_INVALID`. The error names the model and lists its declared values. Previously the call returned the collection unchanged, so the query read every variant. Code that relied on that fallback must stop calling `variant()` in that case.

A second `.variant()` call on a variant collection is rejected. It no longer replaces the first selection: it is a type error, and at runtime it throws `ORM.OPERATION_UNSUPPORTED` naming the model and the discriminator value already selected. Select each variant from the base collection instead, and keep a reference to the base collection where code needs more than one variant.

```ts
// before
const bugs = db.orm.public.Task.variant('Bug');
const features = bugs.variant('Feature');

// after
const tasks = db.orm.public.Task;
const bugs = tasks.variant('bug');
const features = tasks.variant('feature');
```
