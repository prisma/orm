---
from: "8.0.0-rc.20"
to: "8.0.0-rc.21"
changes:
  - id: client-members-reject-instead-of-throwing
    summary: |
      A client member that returns a promise or a result no longer throws at the call when the client or the transaction is in a failed state. On `postgres()`, `sqlite()`, a `supabase()` role-bound client and a transaction, `query`, `execute`, `prepare`, `transaction`, ORM calls and a prepared statement's `query(target, params)` and `execute(target, params)` now report a closed client, a failed connection or an ended transaction through what they return: the promise rejects, and a result rejects when it is awaited or read. Error codes and messages do not change. Code that wraps such a call in `try`/`catch` without awaiting it no longer catches the error; add `await`, or handle it with `.catch(...)`. `db.runtime()` still throws at the call, and so does a mistake in the call itself, such as an ORM query the database's capabilities do not allow. The detection matches a file that imports an `@prisma/orm-*` package and has a `try` block, one line or many, nested or not, that calls one of these members or an ORM terminal (`all`, `first`, `create`, `update`, `delete`, `upsert`, …) without `await` directly before it, on a receiver shaped like a client: a name ending in `db`, `tx`, a name ending in `client`, `admin`, a prepared statement, or a chain through `.orm`; chains may span lines and take callbacks; leave a call whose result is awaited or returned to an awaiting caller as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*[\x27\x22]@prisma/orm-)[\s\S]*\btry\s*\{(?:(?!\}\s*(?:catch|finally)\b)[\s\S])*?(?<![\w$.])(?<!\bawait\s+)(?:this\s*\.\s*)?(?:[\w$]*(?:db|Db|DB)|tx|trx|[\w$]*[Cc]lient|admin|[\w$]*[Pp]repared[\w$]*|[\w$]+\s*\.\s*orm)(?:\s*\.\s*[\w$]+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*?\s*\.\s*(?:query|execute|prepare|transaction|all|first|firstOrThrow|create|createAll|createAndCount|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount|upsert|aggregate)\s*\('
  - id: lazy-activity-source-rejects
    summary: |
      `lazyActivitySource(source)` and `delegatingActivitySource(target)` now reject from `startActivity` and `planContentHash` when `source()` or `target()` throws, instead of throwing at the call. A transaction context from `withTransaction` and its activity handles report `RUNTIME.TRANSACTION_CLOSED` from `query` and from the prepared-statement bridges through the result they return. No code change is needed unless your code caught these errors with a synchronous `try`/`catch`.
  - id: control-adapter-marker-location
    summary: |
      `SqlControlAdapter` (from `@prisma/orm-family-sql/family/control-adapter`) and `MongoControlAdapter` (from `@prisma/orm-family-mongo/family/control-adapter`) have a new required field, `markerLocation`: the name of the table or collection that holds the contract markers, which messages show the user. `ControlFamilyInstance` (from `@prisma/orm-framework/components/control`) has it too; the SQL and Mongo families read it from the control adapter.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*markerLocation)(?=[\s\S]*\b(?:SqlControlAdapter|MongoControlAdapter)\b)[\s\S]*\breadMarker\s*[(:]'
        - '(?<![\s\S])(?![\s\S]*markerLocation)(?=[\s\S]*\bControlFamilyInstance\b)[\s\S]*\bstorageNameOf\s*[(:]'
  - id: control-adapter-hold-marker-lock
    summary: |
      `SqlControlAdapter` has a new optional method, `holdMarkerLock(driver, work)`. A target whose DDL ends an open transaction provides it: `db sign` then creates the marker table under that lock, outside the transaction that writes the markers. Without it, `db sign` takes the lock with `lockMarker` and creates the marker table inside that transaction, as before.
  - id: verify-contract-spaces-marker-location
    summary: |
      `verifyContractSpaces` (from the `spaces` subpath of the migration tools) takes a required `markerLocation`, the name of the target's marker table or collection, which the remediation of an orphan marker names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])verifyContractSpaces\s*\('
  - id: plan-target-details-schema-optional
    summary: |
      `SqlPlanTargetDetails.schema` (from `@prisma/orm-family-sql/family/control`) is optional, and SQLite operations no longer carry `schema: 'main'`. Code that reads `target.details.schema` handles `undefined`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.details\??\.schema(?![\w$])'
  - id: enum-value-rename-statement
    summary: |
      `ResolvedRenameStatement` from `@prisma/orm-framework/components/control` gains `ResolvedEnumValueRenameStatement`, `{ kind: 'rename', entity: 'enumValue', from, to }`, whose sides are `EnumValueCoordinate`s (`namespaceId`, `enum`, `member`). `MigrationSubject` gains `{ kind: 'enumValue' }` with the same coordinate. Code that switches over a rename's `entity` or a subject's `kind` handles `'enumValue'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:ResolvedRenameStatement|ResolvedMigrationStatement|MigrationSubject)(?![\w$])'
  - id: rows-holding-value-and-keep-data-edit
    summary: |
      Three optional fields let a target say how to keep data that a removed enum value would lose. `MigrationRunnerFailureMeta.rowsHoldingValue` (`RowsHoldingValue`: `enumValue`, `value`, `rows`, `operationIndex`, `keepDataEdit?`) reports the rows that still hold a stored value a removal check refused to remove. `MigrationDataLoss.keepDataEdit` (`KeepDataEdit`: `remove`, `replaceWith`, `swapsValues?`) names the edit to `migration.ts` that keeps the data of a planned loss. `MigrationPlannerConflict.leaveOut` lists the statements to leave out of a plan whose `migration.ts` the user finishes by hand. All three are optional: a target that sets none of them keeps working, and the CLI then gives only its general advice.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:MigrationRunnerFailureMeta|MigrationDataLoss|MigrationRunnerFailure|MigrationPlannerConflict)(?![\w$])'
  - id: contract-source-warnings
    summary: |
      A contract source's warnings now reach the caller when the source then fails. `loadContractSource` (`@prisma/orm-toolchain/cli/control-api`) no longer takes `onWarning`; it returns `{ contract, warnings }` on success and adds `warnings` to its failure. The control client's `emit` failure (`EmitFailure`) gains `sourceWarnings`, as its success already had. Read `result.value.contract` where you read `result.value`, and report `warnings` instead of passing `onWarning`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bloadContractSource\('
  - id: mongo-contract-target-option
    summary: |
      `mongoContract(schemaPath, options)` now requires `options.target`, the MongoDB target pack, which the contract records. Pass `{ target: mongoTargetPack }` with `mongoTargetPack` imported from `@prisma/orm-target-mongo/target/pack` (or `@prisma/orm-mongo/target/pack`), alongside any options you already pass. A config written with `defineConfig` from `@prisma/orm-mongo/config` needs no change.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '(?<![\w$.])mongoContract\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,?\s*\)'
        - '(?<![\w$.])mongoContract\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*\{(?![^{}]*\btarget\b)[^{}]*\}\s*\)'
        - '(?<![\w$.])mongoContract\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*[A-Za-z_$][\w$.]*\s*\)'
  - id: mongo-contract-input
    summary: |
      The MongoDB type for the object you pass to `defineContract`, `ContractDefinition`, is renamed `ContractInput`. It is the same type under SQL's name for it. `ContractDefinition` now names the plain-data definition every MongoDB contract source builds from, which takes no type parameters, so the detection flags an import from `@prisma/orm-family-mongo/contract-ts` only where the file writes `ContractDefinition<...>`. Import `ContractInput` from `@prisma/orm-mongo/contract-builder` or `@prisma/orm-family-mongo/contract-ts/contract-builder` where you imported `ContractDefinition`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-mongo/contract-builder[\x27"]'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/contract-ts(?:/contract-builder)?[\x27"][\s\S]*\bContractDefinition<'
  - id: mongo-model-definition-removed
    summary: |
      `MongoModelDefinition` is removed. It was another name for `ContractModel<MongoModelStorage>`. Write `ContractModel<MongoModelStorage>` instead, with `ContractModel` from `@prisma/orm-framework/contract/types` and `MongoModelStorage` from `@prisma/orm-family-mongo/contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])MongoModelDefinition(?![\w$])'
  - id: mongo-ts-polymorphism-rules
    summary: |
      `defineContract` now applies the MongoDB polymorphism rules that PSL applied. It refuses a discriminator that is optional, a list or not text, such as an `Int32` field (`CONTRACT.ARGUMENT_INVALID`); a variant value the discriminator field cannot hold or that is not a member of its enum; a variant listed in `discriminator.variants` that no model declares with that base; a variant stored in another collection than its base (`CONTRACT.COLLECTION_INVALID`); and, in TypeScript and PSL, a variant field stored under a name a field of its base is stored under, such as the discriminator (`CONTRACT.NAME_DUPLICATE`, `PSL_DUPLICATE_STORED_NAME`), which would overwrite that field; and, in TypeScript and PSL, a variant field that restates a base field with a different stored name, type, nullability or list shape (`CONTRACT.ARGUMENT_INVALID`, `PSL_VARIANT_FIELD_DIFFERS_FROM_BASE`), whose documents the collection's validator, written from the base, would refuse. Make the discriminator a required `field.string()` or a string enum, list only declared variants, leave a variant's `collection` out or set it to its base's, give each variant field a stored name its base does not use, and restate a base field on a variant exactly as the base declares it, or not at all.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bdiscriminator\s*:\s*\{'
  - id: mongo-index-shape-rules
    summary: |
      Every MongoDB contract source now refuses an index MongoDB would refuse (`CONTRACT.INDEX_INVALID` in TypeScript, `PSL_INVALID_INDEX` in PSL): a unique wildcard index, a wildcard with a hashed, 2d or 2dsphere key, a hashed index on several fields, a TTL wildcard index, a wildcard projection without a wildcard key, a collation without a locale, and a second text index in one collection. PSL also refuses an index that another model on the same collection, or the same model, already declares, such as `@unique` and `@@unique` on one field. Remove the index or change it to a shape MongoDB accepts; remove a duplicate.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma}"
      matches:
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*(?:\$\*\*|\bwildcardProjection\b|[\x27"]hashed[\x27"]|\bcollation\s*:)'
        - '\bwildcard\('
  - id: mongo-value-object-enum-check
    summary: |
      `defineContract` now refuses a value object field typed by an enum the contract does not declare (`CONTRACT.ENUM_UNKNOWN`), as it already did for a model field. Add the enum to `defineContract({ enums })`.
  - id: mongo-newly-accepted
    summary: |
      No action is needed. An optional field that a type alias, `@onCreate(...)`/`@onUpdate(...)` or `.onCreate(...)`/`.onUpdate(...)` fills is now accepted, as on SQL; a list that generates a value is still refused. A TypeScript variant may leave its `collection` out and is stored in its base's.
  - id: mongo-prisma6-merged-indexes
    summary: |
      A Prisma 6 schema read by `prisma6Schema()` in which one collection holds two identical indexes, such as `@unique` and `@@unique` on one field, or the same `@@index` on two models stored in one collection, now gives one index, as the database holds one. That contract's storage hash changes. Run `prisma contract emit`, then `prisma db sign` to record the new hash; the database itself needs no change.
  - id: psl-temporal-type-renames
    summary: |
      On PostgreSQL, the PSL types `Timestamptz`, `Timestamp` and `Interval` are renamed to `TimestamptzTemporal`, `TimestampTemporal` and `IntervalParts`, and the old names are errors. Rename each use in your `.prisma` files, keeping its arguments: `Timestamptz(3)` becomes `TimestamptzTemporal(3)`. Each new name reads the same value with the same codec, so the contract and its hashes do not change. `@db.Timestamp` and `@db.Timestamptz` in a Prisma 7 schema are not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w$.@"\x27`])(?:Timestamptz|Timestamp|Interval)(?![\w$])'
  - id: ts-temporal-type-helpers-renamed
    summary: |
      In a TypeScript contract, `type.Timestamptz(...)`, `type.Timestamp(...)` and `type.Interval(...)` are renamed to `type.TimestamptzTemporal(...)`, `type.TimestampTemporal(...)` and `type.IntervalParts(...)`, and the column helper `intervalColumn(...)` from `@prisma/orm-postgres/adapter/column-types` is renamed to `intervalPartsColumn(...)`. Rename each call; the arguments do not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:Timestamptz|Timestamp|Interval)\('
        - '(?<![\w$])intervalColumn(?![\w$])'
  - id: interval-with-precision-typed-as-parts
    summary: |
      An `IntervalParts(p)` column, an interval with a precision, is now typed as the `{ months, days, micros }` object its codec reads, as an interval without a precision already was, instead of a string. Type such a value as `PgInterval` from `@prisma/orm-postgres/target/codec-types`. Code that treated the value as a string was wrong at run time and now fails to type-check.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])Interval(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: branded-time-types-removed
    summary: |
      The string types `Timestamp`, `Timestamptz`, `Time` and `Interval` are no longer exported from `@prisma/orm-postgres/target/codec-types` (and `Interval` no longer from `@prisma/orm-postgres/contract-builder`). No column was typed by the first three. Remove each of these names from the import that names it, and delete the import if it names nothing else. A `contract.d.ts` written by an earlier release, such as one in a migration snapshot, imports them without using them, so removing them from its import is the only change it needs.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])(?:Timestamptz|Timestamp|Time|Interval)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: temporal-types-from-temporal-spec
    summary: |
      Temporal fields are now typed with the `Temporal` types of the `temporal-spec` package rather than a global `Temporal` declaration, so they are typed even in a project without the polyfill's global types. The values are the same and assign to and from the global types. An extension's type test that requires a field to be exactly `Temporal.Instant` (or another `Temporal` type) from the global declarations now fails: add `temporal-spec` (`1.0.1`) to your development dependencies and import the type with `import type { Temporal } from 'temporal-spec'` in that test.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*import\s+(?:type\s+)?\{[^}]*(?<![\w$])Temporal(?![\w$])(?!\s+as(?![\w$]))[^}]*\}\s*from\s*[\x27"]temporal-spec[\x27"])[\s\S]*toEqualTypeOf<\s*Temporal\.'
  - id: contract-types-list-new-aggregates
    summary: |
      Optional. An emitted `contract.d.ts` lists the aggregates of every codec in the stack, so `prisma contract emit` now adds rows for the three new codecs to it, and the contract itself does not change. An extension that commits an emitted `contract.d.ts` re-emits it when it next changes the contract; until then the existing `contract.d.ts` keeps working. A migration snapshot's `contract.d.ts` does not need the new rows; it needs only the import change `branded-time-types-removed` describes.
  - id: driver-ensures-target-session-settings
    summary: |
      A target descriptor may declare `sessionSettings`, the settings its codecs need on every database session; the PostgreSQL target declares `DateStyle=ISO`. A stack passes them to each driver it creates: a runtime driver descriptor's `create(options, sessionSettings)` receives them as a second argument, and a control driver's connect options carry them as `sessionSettings`. A driver for a target that declares them must ensure them on every connection it hands out. A wrapper around a driver descriptor's `create` passes `sessionSettings` on.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$])(?:RuntimeDriverDescriptor|ControlDriverDescriptor)(?![\w$])'
  - id: authoring-field-namespace-removed
    summary: |
      A component's `authoring.field` namespace and the `fieldPreset` descriptor kind are removed. A component whose `authoring` still has a `field` key is refused with `CONTRACT.PACK_CONTRIBUTION_INVALID` when the stack is assembled. Contribute a type alias (`kind: 'typeAlias'`) or a type constructor in `authoring.type` instead. The detection matches files that declare a field preset or read or set `authoring.field`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'kind:\s*[\x27"]fieldPreset[\x27"]'
        - '(?<![\w$])authoring\??\.field(?![\w$])'
        - '(?<![\w$.])field\s*:\s*\w*[Ff]ieldPresets(?![\w$])'
  - id: argument-kinds-removed
    summary: |
      An authoring argument has one kind, `value`. The `number`, `object` and `option` argument kinds, the `select` template node, and the `path` and `default` of an `arg` template reference are removed, with the types `AuthoringOption`, `AuthoringValueArgument` and `AuthoringSelectRef`. Write each argument as `{ kind: 'value', dataType }` and use `AuthoringArgumentDescriptor` where you used `AuthoringValueArgument`. The detection matches authoring code that uses one of the removed kinds or types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\b[Aa]uthoring)[\s\S]*kind:\s*[\x27"](?:option|number|object|select)[\x27"]'
        - '(?<![\w$])Authoring(?:Option|ValueArgument|SelectRef)(?![\w$])'
        - '(?<![\w$])isAuthoringSelectRef(?![\w$])'
  - id: preset-builders-removed
    summary: |
      The helpers that built and read field presets are removed: `instantiateAuthoringFieldPreset`, `isAuthoringFieldPresetDescriptor`, `getAuthoringFieldPreset`, `fieldPresetSpellings`, `instantiatePslFieldPreset`, `reportPresetNotCalled`, `temporalAuthoringPresets`, `temporalCodecPreset`, `temporalCodecPresetWithPrecision`, `temporalStringAuthoringPresets`, `temporalPhaseTemplate`, `temporalPhaseTemplateWithParams`, `TEMPORAL_ON_CREATE_ARG`, `TEMPORAL_ON_UPDATE_ARG`, `createFieldHelpersFromNamespace`, the types `PresetStorageTemplate`, `AuthoringFieldPresetDescriptor`, `AuthoringFieldPresetOutput`, `AuthoringFieldNamespace`, `AuthoringColumnDefaultTemplate`, `ObjectArgumentType`, `OptionalObjectArgumentKeys` and `GeneratedColumnSpec`, and the spec helpers `uuidv4`, `uuidv7`, `ulid`, `nanoid`, `cuid2` and `ksuid` of `@prisma/orm-framework/ids`. `assertNoCrossRegistryCollisions` no longer takes a field namespace. The detection matches files that use one of them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:instantiateAuthoringFieldPreset|isAuthoringFieldPresetDescriptor|getAuthoringFieldPreset|fieldPresetSpellings|instantiatePslFieldPreset|reportPresetNotCalled|temporalAuthoringPresets|temporalCodecPreset|temporalCodecPresetWithPrecision|temporalStringAuthoringPresets|temporalPhaseTemplate|temporalPhaseTemplateWithParams|TEMPORAL_ON_CREATE_ARG|TEMPORAL_ON_UPDATE_ARG|createFieldHelpersFromNamespace|PresetStorageTemplate|AuthoringFieldPresetDescriptor|AuthoringFieldPresetOutput|AuthoringFieldNamespace|AuthoringColumnDefaultTemplate|ObjectArgumentType|OptionalObjectArgumentKeys|GeneratedColumnSpec)(?![\w$])'
        - 'import\s*(?:type\s*)?\{[^}]*(?<![\w$])(?:uuidv4|uuidv7|ulid|nanoid|cuid2|ksuid)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-framework/ids[\x27"]'
        - '(?<![\w$])assertNoCrossRegistryCollisions\('
  - id: preset-diagnostics-removed
    summary: |
      The PSL diagnostics `PSL_PRESET_NOT_CALLED`, `PSL_PRESET_NOT_LIST`, `PSL_PRESET_NOT_OPTIONAL`, `PSL_PRESET_AND_ID_CONFLICT`, `PSL_PRESET_AND_DEFAULT_CONFLICT` and `PSL_PRESET_WITHOUT_EFFECT` are removed, and MongoDB's `PSL_PRESET_ON_VARIANT_FIELD` and `PSL_PRESET_CONFLICT` are renamed `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_GENERATOR_CONFLICT`. A preset call is now reported as `PSL_UNRESOLVED_REFERENCE`. The detection matches files that name a `PSL_PRESET_` code.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'PSL_PRESET_'
  - id: field-presets-in-extension-code
    summary: |
      Code and documentation in an extension that calls a field preset, such as `field.id.uuidv4String()` in a test contract, a README or a message, uses the replacement of the app guide's tables: `field.column(type.UuidString()).id().onCreate(gen.uuid())`. A package that exports `field` and `gen` built by `createComposedAuthoringHelpers` for use outside a contract also exports `type` from the same call. The detection matches files that call a preset.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,md}"
      matches:
        - '(?<![\w$.])field\.(?:id|temporal)\.'
        - '(?<![\w$.])field\.(?:text|int|bigint|float|decimal|boolean|bytes|dateTime|uuidString|uuidNative|ulid|nanoid|cuid2|ksuid|generated)\('
---

# 8.0.0-rc.20 → 8.0.0-rc.21 — Extension author upgrade instructions

No change in this release comes with a script. Make the changes below in any order.

## A client reports failures through what its members return

### `client-members-reject-instead-of-throwing`

A member that returns a promise or a result now reports a closed client, a failed connection or an ended transaction through what it returns. Code that relied on the call itself throwing must await the result or attach `.catch(...)`:

```ts
await db.close();

// Before: throws at the call, so .catch never runs
db.query(plan).toArray().catch(handle);

// After: the result rejects, so handle runs
db.query(plan).toArray().catch(handle);

// A synchronous try/catch around an unawaited call stops catching
try {
  db.transaction(work);
} catch (error) {
  handle(error);
}

// Await it instead
try {
  await db.transaction(work);
} catch (error) {
  handle(error);
}
```

For each file the detection matches, check each `try` block it names. Leave a call whose result is awaited or returned to an awaiting caller as it is.

### `lazy-activity-source-rejects`

No code change is needed unless your code caught errors from `lazyActivitySource`, `delegatingActivitySource` or a `withTransaction` context with a synchronous `try`/`catch`. Await the call inside the `try` block instead.

## A control adapter names where it keeps its markers

### `control-adapter-marker-location`

Add `markerLocation` to your control adapter, so messages about the contract markers name the right table or collection:

```ts
// Before
export class MyControlAdapter implements SqlControlAdapter<'my-target'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'my-target' as const;
  …
}

// After
export class MyControlAdapter implements SqlControlAdapter<'my-target'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'my-target' as const;
  readonly markerLocation = 'my_schema.marker';
  …
}
```

The same applies to an adapter written as an object literal or returned by a factory: add `markerLocation: 'my_schema.marker'` to the object.

A family that implements `ControlFamilyInstance` itself adds `markerLocation` too, usually read from its control adapter:

```ts
return {
  familyId: 'my-family',
  get markerLocation() {
    return getControlAdapter().markerLocation;
  },
  …
};
```

A test double that builds a control adapter or a `ControlFamilyInstance` sets it too.

### `control-adapter-hold-marker-lock`

If your database commits a transaction when it runs DDL, as MySQL does, give your SQL control adapter `holdMarkerLock(driver, work)`: take the marker lock, run `work`, and release the lock when `work` ends. `db sign` then creates the marker table inside `work`, under the lock, and writes the markers in a transaction after it. A target whose DDL is transactional needs nothing: without `holdMarkerLock`, `db sign` keeps the lock, the marker table and the writes in one transaction.

### `verify-contract-spaces-marker-location`

A call to `verifyContractSpaces` (from `@prisma/orm-toolchain/migration-tools/spaces`) passes the marker location of the target it verifies, such as `markerLocation: 'prisma_contract.marker'` for Postgres or `'_prisma_marker'` for SQLite.

## A SQL operation's schema is optional

### `plan-target-details-schema-optional`

Code that reads `target.details.schema` from a SQL migration operation treats it as `string | undefined`: SQLite and MySQL operations name no schema.

## Statements and subjects can name an enum value

### `enum-value-rename-statement`

`--rename Status.ARCHIVED:Status.RETIRED` resolves to a rename statement with `entity: 'enumValue'`, and a data-loss subject can be `{ kind: 'enumValue', namespaceId, enum, member }`, named by the member's name in the contract source. A `switch` or `if` over `statement.entity` or `subject.kind` gains an `'enumValue'` branch. A planner that does not plan enum value renames refuses the statement with a `statementRefused` conflict, as it refuses a namespace rename it cannot plan.

### `rows-holding-value-and-keep-data-edit`

A target that plans the removal of a stored value can tell the user how to keep the data it would lose. Nothing is required: `rowsHoldingValue`, `keepDataEdit` and `leaveOut` are all optional.

- In the runner, when the check before a removal fails because rows still hold the value, count them and set `meta.rowsHoldingValue` on the failure: `enumValue` is the enum value in its JSON form, `{ namespaceId?, enum, member }`, with `namespaceId` left out for the unbound namespace; `value` is the stored value as the database stores it; `rows` is the count; `operationIndex` is the position of the failed operation in its plan; and `keepDataEdit`, when the target can say it, is the edit below. If the count fails, return the plain check failure without the field.
- In the planner, set `keepDataEdit` on a `MigrationDataLoss` entry when an edit to the `migration.ts` the plan writes keeps the data: `remove` is the call as the file writes it, and `replaceWith` is the text that replaces it, which may be several calls separated by `, `. Set `swapsValues: true` when the edit moves values between members that trade them, so the CLI offers no way that renames them in a cycle. The CLI prints the edit beside the question, and leads its next actions with it.
- In the planner, when a refused statement's change can be written by hand, set `leaveOut` on the conflict to the statements to leave out. The CLI then prints the plan without them as the next action, and the conflict's `why` says what to add to its `migration.ts`.

## Contract source warnings reach the caller

### `contract-source-warnings`

This change applies to every family. The detection matches every call to `loadContractSource`.

```typescript
// Before
const result = await loadContractSource(config, { onWarning: (warning) => warnings.push(warning) });
if (result.ok) use(result.value);

// After
const result = await loadContractSource(config);
const { warnings } = result.ok ? result.value : result.failure;
if (result.ok) use(result.value.contract);
```

## MongoDB contract sources share one builder

Every MongoDB contract source, `defineContract`, Prisma 8 PSL and the Prisma 6 reader, now builds through one builder, so each MongoDB rule applies to every source in the same way. The builder records the stack's target and extension packs. Two MongoDB type names change to match SQL's, and the sections after them list where a source now refuses or accepts what it did not before. A contract that every source accepted before builds to the same `contract.json`.

### `mongo-contract-target-option`

Pass the MongoDB target pack as `target`:

```typescript
import { mongoContract } from '@prisma/orm-family-mongo/contract-psl/provider';
import mongoTargetPack from '@prisma/orm-target-mongo/target/pack';

const contract = mongoContract('./prisma/schema.prisma', { target: mongoTargetPack });
```

Keep any other options you pass, such as `output`, in the same object. A config that names its contract through `defineConfig({ contract: './prisma/schema.prisma' })` from `@prisma/orm-mongo/config` already passes the pack. A call without `target` is refused with `CONTRACT.ARGUMENT_INVALID` (`reason: 'target-pack-missing'`).

### `mongo-contract-input`

The type of the object you pass to `defineContract` is now `ContractInput`, as it is in SQL. Rename the import and each use:

```typescript
import type { ContractInput } from '@prisma/orm-family-mongo/contract-ts/contract-builder';
```

### `mongo-model-definition-removed`

`MongoModelDefinition` was an alias for a model of a built contract. SQL has no such alias. Write the type it stood for:

```typescript
import type { ContractModel } from '@prisma/orm-framework/contract/types';
import type { MongoModelStorage } from '@prisma/orm-family-mongo/contract';

function collectionOf(model: ContractModel<MongoModelStorage>): string | undefined {
  return model.storage.collection;
}
```

### `mongo-ts-polymorphism-rules`

The detection matches a file that imports the MongoDB contract builder and declares a discriminator; an emitted `contract.d.ts` imports no builder, so it is not matched.

A discriminator must be a required text field, and each variant must be declared and stored in its base's collection:

```typescript
const Task = model('Task', {
  collection: 'tasks',
  fields: { _id: field.objectId(), type: field.string() },
  discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
});
const Bug = model('Bug', { base: Task, fields: { severity: field.int32() } });
```

### `mongo-index-shape-rules`

MongoDB refuses these indexes when it creates them, so the contract now refuses them first. A matched file uses a wildcard, a hashed key, a wildcard projection or a collation; check each such index against the list in the summary.

### `mongo-value-object-enum-check`

Declare every enum a value object field uses in `defineContract({ enums })`.

### `mongo-newly-accepted`

Nothing to change.

### `mongo-prisma6-merged-indexes`

Emit the contract again and sign the database, so `db verify` compares against the new storage hash.

## Explicit date and time types carry the kind of value they read

On PostgreSQL, a column type that several codecs read now names the kind of value in its name. The `Temporal` types gain the suffix `Temporal`, and the interval type that reads `{ months, days, micros }` gains the suffix `Parts`:

| Before | After | Reads |
| --- | --- | --- |
| `Timestamptz(p?)` | `TimestamptzTemporal(p?)` | `Temporal.Instant` |
| `Timestamp(p?)` | `TimestampTemporal(p?)` | `Temporal.PlainDateTime` |
| `Interval(p?)` | `IntervalParts(p?)` | `{ months, days, micros }` |

This change leaves `DateTime`, `Date` and `Time` as they are, and adds `DateTemporal` and `TimeTemporal` as the explicit names of what `Date` and `Time` read today. A later release gives `DateTime`, `Date` and `Time` new meanings, as convenience date and time types, and brings its own instructions. To keep what a field reads today through that change, you can already write the explicit name: `TimestamptzTemporal` for `DateTime`, `DateTemporal` for `Date` and `TimeTemporal` for `Time`.

Three explicit types are new, and need no change to existing schemas: `TimestampJsDate(p?)`, a `timestamp` column read as a JavaScript `Date`; `TimestampInstant(p?)`, a `timestamp` column read as a `Temporal.Instant`; and `IntervalString(p?)`, an `interval` column read as an ISO 8601 duration such as `P1Y2M`. Both timestamp types read and write the stored date and time as UTC.

### `psl-temporal-type-renames`

Rename each field type in your extension's `.prisma` contract source using the table above, keeping its arguments and its attributes:

```prisma
model Event {
  id    Int                    @id
  at    TimestamptzTemporal(3) // was Timestamptz(3)
  local TimestampTemporal      // was Timestamp
  span  IntervalParts          // was Interval
}
```

A type alias written with one of the names, such as `types { Stamp = Timestamp(3) }`, is renamed the same way. The detection can match one of the words in a comment or a model name; rename only a field type or an alias's type.

### `ts-temporal-type-helpers-renamed`

```ts
field.column(type.TimestamptzTemporal(3)); // was type.Timestamptz(3)
field.column(intervalPartsColumn(6)); // was intervalColumn(6)
```

### `interval-with-precision-typed-as-parts`

```ts
import type { PgInterval } from '@prisma/orm-postgres/target/codec-types';

const span: PgInterval = row.span; // an IntervalParts(6) column
```

### `branded-time-types-removed`

Remove the four names from the import, and leave the rest of the file as it is:

```ts
import type {
  CodecTypes as PgTypes,
  JsonValue,
} from '@prisma/orm-postgres/target/codec-types'; // was also importing Interval, Time, Timestamp and Timestamptz
```

### `temporal-types-from-temporal-spec`

```ts
import type { Temporal } from 'temporal-spec';

expectTypeOf<Row['createdAt']>().toEqualTypeOf<Temporal.Instant>();
```

If the test file also creates `Temporal` values, import the type under another name, such as `import type { Temporal as TemporalTypes } from 'temporal-spec'`, so the runtime `Temporal` stays in scope.

### `contract-types-list-new-aggregates`

No change is needed now. The next `prisma contract emit` adds rows for the three new codecs to `contract.d.ts`.

## A driver ensures the session settings its target declares

### `driver-ensures-target-session-settings`

A target can now state the settings every database session needs, as data on its descriptor:

```ts
const target = { ...meta, sessionSettings: { DateStyle: 'ISO' } };
```

`createExecutionStack` and `createControlStack` pass them to the driver. A runtime driver descriptor receives them as the second argument of `create`, after its own options; a control driver receives them in its connect options:

```ts
create(options?: MyDriverOptions, sessionSettings?: SessionSettings): MyDriver
create(url: string, options?: ControlDriverConnectOptions): Promise<MyControlDriver> // options.sessionSettings
```

A driver for a target that declares settings applies them to every connection it hands out, before the first statement, and again whenever a connection's session may have been reset. A driver for a target that declares none needs no change. Code that wraps a driver descriptor to curry its options passes the second argument on, or the driver never receives the settings:

```ts
const driverWithCursor = {
  ...postgresDriverDescriptor,
  create(_options, sessionSettings) {
    return postgresDriverDescriptor.create({ cursor }, sessionSettings);
  },
};
```

A codec whose application value is the stored form of its data type builds its values with the new `CodecImpl.storedDataTypeValueOf`, which takes only the stored spelling, instead of `dataTypeValueOf`.

## Field presets are removed

This section replaces two pieces of advice from the 8.0.0-rc.19 upgrade guide. That guide said that a field preset keeps its `number`, `option` and `object` arguments, and showed field presets built with `instantiatePslFieldPreset` and `temporalCodecPresetWithPrecision`. Neither holds any more: this release removes field presets, the `authoring.field` namespace and every argument kind except `value`.

A pack now contributes what a schema writes in a field's type position only through `authoring.type`: a type constructor, such as `Char(36)`, or a type alias, such as `temporal.CreatedAt`. Generated values and the identity are written by the user as attributes (`@id`, `@onCreate(...)`, `@onUpdate(...)` in PSL; `.id()`, `.onCreate(gen.fn())`, `.onUpdate(gen.fn())` in TypeScript), or set by a type alias. The upgrade guide for apps lists the replacement of every preset Prisma contributed.

### `authoring-field-namespace-removed`

Move each field preset out of `authoring.field`. A preset that stored a column with fixed type parameters and generated values becomes a type alias in `authoring.type`, as the targets' `temporal.CreatedAt` is:

```ts
// Before
authoring: {
  field: {
    temporal: {
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz-temporal@1',
          executionDefaults: { onCreate: { kind: 'generator', id: 'instantNow' } },
        },
      },
    },
  },
},

// After
authoring: {
  type: {
    temporal: {
      CreatedAt: {
        kind: 'typeAlias',
        documentation: 'A timestamp the client sets to now when a row is created.',
        output: {
          type: { codecId: 'pg/timestamptz-temporal@1' },
          onCreate: { name: 'now', args: {} },
        },
      },
    },
  },
},
```

`temporalTypeAliases(type, value)` from `@prisma/orm-framework/components/authoring` builds the `CreatedAt` and `UpdatedAt` pair for a timestamp type. A type alias calls a generator function by name, as `@onCreate(now())` does, and the stack's bindings pick the generator for the alias's codec. A preset that took arguments becomes a type constructor in `authoring.type`, and the user writes the generated values and `@id` as attributes. A preset whose only job was `@id` plus a generator, such as `id.uuidv4String()`, has no replacement in the pack: the user writes the SQL family's identifier alias with the attributes, `UuidString @id @onCreate(uuid())`.

Remove the `field` key from `authoring` on both the pack ref and the control descriptor. Then assemble the stack: if any `field` key is left, the control stack and the TypeScript builders throw `CONTRACT.PACK_CONTRIBUTION_INVALID` with `Component "<id>" contributes authoring.field, which Prisma 8 removed with field presets. Contribute a type alias (kind: 'typeAlias') or a type constructor in authoring.type.`

### `argument-kinds-removed`

`AuthoringArgumentDescriptor` is now `{ kind: 'value'; dataType: string; name?: string; optional?: boolean }`. A type constructor already took only `value` arguments; the other kinds were left only for field presets. Replace `AuthoringValueArgument` with `AuthoringArgumentDescriptor`, and delete code that builds or reads `option`, `number`, `object` or `select` descriptors and templates, and the `path` and `default` of a `{ kind: 'arg' }` template reference. A template refers to a whole argument by its index: `{ kind: 'arg', index: 0 }`.

### `preset-builders-removed`

Delete each use of the removed helpers and types with the preset it built or read. `temporalTypeAliases`, `TIMESTAMP_NOW_GENERATOR_ID` and `timestampNowControlDescriptor` stay. `generatedLength` stays in `@prisma/orm-framework/ids`; the spec helpers `uuidv4()` and the others fed only `field.generated(...)`, which is removed too.

`assertNoCrossRegistryCollisions` takes the type namespace, then the entity type, PSL block and model attribute namespaces. Remove the field namespace argument you passed second:

```ts
// Before
assertNoCrossRegistryCollisions(typeNamespace, fieldNamespace, entityTypeNamespace);

// After
assertNoCrossRegistryCollisions(typeNamespace, entityTypeNamespace);
```

### `preset-diagnostics-removed`

Code that matches a diagnostic by code: a preset call is now `PSL_UNRESOLVED_REFERENCE`, with the message `<call> was a field preset, and Prisma 8 removed field presets. Write <replacement>.` The other `PSL_PRESET_*` codes cannot occur, so remove the code that handles them. Rename `PSL_PRESET_ON_VARIANT_FIELD` to `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_PRESET_CONFLICT` to `PSL_GENERATOR_CONFLICT`. Their messages now start `Generated value on`, and they are reported for `@onCreate(...)`, `@onUpdate(...)` and type aliases that generate a value.

### `field-presets-in-extension-code`

Rewrite every preset call in the extension's code, test contracts, messages, doc comments and documentation with the tables of the app upgrade guide. In a `defineContract` callback, take `gen` and `type` from the callback's argument where the rewritten fields use them, adding each missing name at the end of the destructuring, `gen` before `type`. A preset named in a message or doc comment as an example, such as `field.text()` or `field.temporal.timestamptz()`, becomes its replacement, such as `field.column(type.String())` or `field.column(type.TimestamptzTemporal())`. A sentence that describes the presets themselves, such as one saying a `field` export has the same presets as the callback, says instead that the export gives the same `field` and `type` as the callback. If a callback renames `field`, as in `({ field: f })`, the detection does not see `f.id.uuidv4String()`; search for it yourself.

If your package exports `field` and `gen` from a `createComposedAuthoringHelpers(...)` call so that code outside a contract, such as a query fragment, can declare fields, export that call's `type` too, with a doc comment that names an example such as `type.TimestamptzTemporal()`:

```ts
export const type: Helpers['type'] = helpers.type;
```

Add it wherever the package re-exports `field` and `gen`, and replace the preset examples in the doc comment of `field` with `field.column(type.X())` examples. The app upgrade guide's section `ts-field-presets-removed` covers the rest of a `defineContract` callback: a name `type` that is already bound, code that does not know its target, and a `field` imported outside a callback.
