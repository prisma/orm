# Change list: production code that replaces `nativeType` with `dataType`

Made on 2026-09-29 for planning pull request #30518; the raw outputs were not kept. It lists every production file that contains one of the symbols named in the brief, and the files the symbol search misses. Tests, fixtures, `dist/` and `node_modules/` are excluded and only counted in list (d). The decisions referred to as "decision N" are the numbered engineering decisions in [`../design-notes.md`](../design-notes.md); "settled Q…" refers to the sections settled with Will.

## How the list was made

The search was `git grep -nwE` for the 23 symbols over the whole repository, without `test/`, `*.test.ts`, `*.test-d.ts`, `fixtures/`, `*.md`, `*.mdc`, `*.json`, `contract.d.ts` and `projects/`. It found 918 lines in 145 files. Line numbers that are close together are shown as one range.

Two symbols from the brief do not exist under that name. `CODEC_ID_BY_PRINTED_TYPE` is now `CODEC_ID_BY_INFERRED_TYPE` (`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-default-codec.ts:24`). `normalizeFormattedType` exists only in the Postgres adapter (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:1482`).

Several hits use the word `nativeType` for a different thing and do not change: the Prisma 7 `@db.X` attribute in `contract-prisma7` and the Prisma 6 `@db.ObjectId` attribute in `contract-prisma6`. They are marked "Unchanged" below.

## Number of production files per group

| Group | Files with a listed symbol | Further files that must change |
| --- | --- | --- |
| Framework | 10 | 1 |
| SQL core contract | 7 | 0 |
| Schema IR | 4 | 0 |
| Authoring: contract-ts | 5 | 1 |
| Authoring: contract-psl | 3 | 0 |
| Authoring: contract-prisma7 | 3 | 0 |
| SQL emitter | 1 | 0 |
| relational-core | 5 | 1 |
| SQL runtime | 0 | 0 |
| SQL family | 14 | 1 |
| Postgres target | 30 | 4 |
| Postgres adapter | 7 | 1 |
| SQLite target | 12 | 2 |
| SQLite adapter | 4 | 1 |
| Extensions | 22 | 2 |
| Mongo family and target | 8 | 1 |
| CLI | 1 | 0 |
| Examples | 3 | 0 |
| Public packages | 0 | 0 |
| Repository tooling and shipped skills | 6 | 0 |
| Total | 145 | 15 |

## Files by package

### Framework (`packages/1-framework`, without the CLI)

- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts`
  - Symbols and lines: `targetTypes` 620, 631-632; `nativeType` 647; `targetTypesFor` 678.
  - Today: Builds `targetTypesById` from every codec descriptor and exposes it as `codecLookup.targetTypesFor`.
  - Becomes: The `targetTypes` map and `targetTypesFor` are deleted; the comments at 620 and 647 are rewritten. The same file gains the assembly checks the decisions add (constructor codec is registered; no two data types claim one text), which are new code, not listed here.
- `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts`
  - Symbols and lines: `nativeType` 26.
  - Today: A doc comment uses `{ nativeType, codecId, nullable }` as its example of a plain object.
  - Becomes: Comment text only: the example names `dataType`.
- `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`
  - Symbols and lines: `targetTypes` 4, 20, 34, 88, 97.
  - Today: Declares `targetTypes: readonly string[]` on the `CodecDescriptor` interface (34) and the abstract base class (97).
  - Becomes: Both declarations and the doc text are deleted.
- `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts`
  - Symbols and lines: `targetTypesFor` 51-56, 98; `targetTypes` 51.
  - Today: Declares `CodecLookup.targetTypesFor` (56) and the empty lookup's implementation (98).
  - Becomes: Deleted.
- `packages/1-framework/1-core/framework-components/src/shared/codec.ts`
  - Symbols and lines: `targetTypes` 25.
  - Today: Doc comment mentions `targetTypes` as descriptor metadata.
  - Becomes: Comment text only.
- `packages/1-framework/1-core/framework-components/src/shared/column-spec.ts`
  - Symbols and lines: `nativeType` 22, 64-76.
  - Today: `ColumnTypeDescriptor` requires `nativeType: string` (22); `column(codecFactory, codecId, typeParams, nativeType)` copies it (70-76). This is the type every TypeScript column helper and every user-written `{ codecId, nativeType }` object satisfies.
  - Becomes: The field leaves the descriptor. DECISION NEEDED 1 (below): whether the descriptor carries `dataType` instead or carries neither.
- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`
  - Symbols and lines: `nativeType` 100, 1016, 1101, 1760-1767, 1785, 1871, 1915.
  - Today: `AuthoringStorageTypeTemplate.nativeType` (100) is the type-constructor and field-preset template field; `ScalarTypeConstructorOutput.nativeType` (1016); assembly refuses a plain constructor without it (1101); `resolveAuthoringStorageTypeTemplate` copies it and throws when missing (1760-1785); `instantiateAuthoringTypeConstructor` (1871) and `instantiateAuthoringFieldPreset` (1915) return it.
  - Becomes: The template field is deleted (decision 5). The three instantiate functions return `{codecId, typeParams}`; the "declares no nativeType" checks at 1101 and 1764-1768 are deleted, because an entity-ref constructor no longer differs from a plain one in this respect. The per-constructor minimum and maximum checks in `validateAuthoringArgument` are replaced by the data type's parameter schema.
- `packages/1-framework/1-core/framework-components/src/shared/framework-components.ts`
  - Symbols and lines: `controlPlaneHooks` 40; `targetTypes` 42; `nativeType` 55.
  - Today: The component descriptor type declares `types.codecTypes.controlPlaneHooks` (40) and `types.storage[].nativeType` (55).
  - Becomes: `types.storage[].nativeType` is deleted. `controlPlaneHooks` stays as a slot, because the hooks `planTypeOperations` and `resolveIdentityValue` remain; only the `expandNativeType` member is deleted (in the family's `CodecControlHooks`).
- `packages/1-framework/2-authoring/contract/src/enum-type.ts`
  - Symbols and lines: `nativeType` 76-77, 131-132, 145, 156-158, 176-181, 229, 249.
  - Today: `enumType(name, codec, ...members)` takes `Pick<ColumnTypeDescriptor, 'codecId' | 'nativeType'>` and stores `nativeType` on the handle (77, 229).
  - Becomes: Takes and stores what `ColumnTypeDescriptor` carries after DECISION NEEDED 1. This is a public authoring function that users call with a hand-written object.
- `packages/1-framework/2-authoring/ids/src/index.ts`
  - Symbols and lines: `nativeType` 10.
  - Today: `GENERATED_CHAR_TYPE = { codecId: 'sql/char@1', nativeType: 'character' }` is the descriptor of generated-id columns.
  - Becomes: Drops `nativeType`. It cannot name a data type: `sql/char@1` represents `pg/char` on Postgres and a SQLite type on SQLite, and this package is target-blind.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/1-framework/1-core/framework-components/src/shared/data-type.ts`
  - Today: `DataType` has `id`, `casts`, `listCast` (research section 1).
  - Becomes: Gains the parameter schema (decision 1).

### SQL core contract (`packages/2-sql/1-core/contract`)

- `packages/2-sql/1-core/contract/src/exports/pack-types.ts`
  - Symbols and lines: `StorageTypeMetadata` 1.
  - Today: Re-exports `StorageTypeMetadata`.
  - Becomes: Deleted together with the type, if no other type in `pack-types.ts` needs the export file.
- `packages/2-sql/1-core/contract/src/factories.ts`
  - Symbols and lines: `nativeType` 18-24.
  - Today: `col(nativeType, codecId, nullable)` builds a `StorageColumn`.
  - Becomes: First parameter becomes the data type id; reads `dataType`.
- `packages/2-sql/1-core/contract/src/ir/storage-column.ts`
  - Symbols and lines: `nativeType` 17, 44, 58.
  - Today: `StorageColumnInput.nativeType` (17) and `StorageColumn.nativeType` (44, 58).
  - Becomes: Replaced by `dataType` (a data type id).
- `packages/2-sql/1-core/contract/src/ir/storage-entry-schemas.ts`
  - Symbols and lines: `nativeType` 39.
  - Today: The arktype schema of a stored column requires `nativeType: 'string'` (39) and rejects unknown keys.
  - Becomes: Requires `dataType`; an old-format column fails as an unknown key `nativeType` plus a missing `dataType`. The message must name the entry and say contracts no longer store the field (settled Q1b), which the generic unknown-key message does not do today.
- `packages/2-sql/1-core/contract/src/ir/storage-type-instance.ts`
  - Symbols and lines: `nativeType` 23, 36, 49.
  - Today: `StorageTypeInstanceInput.nativeType` (23), `StorageTypeInstance.nativeType` (36), `toStorageTypeInstance` (49).
  - Becomes: Replaced by `dataType`.
- `packages/2-sql/1-core/contract/src/pack-types.ts`
  - Symbols and lines: `StorageTypeMetadata` 4; `nativeType` 8.
  - Today: Declares `StorageTypeMetadata { typeId, familyId, targetId, nativeType? }`, the element of pack metadata `types.storage[]`.
  - Becomes: Deleted (decision 7).
- `packages/2-sql/1-core/contract/src/validators.ts`
  - Symbols and lines: `nativeType` 67, 719-721, 943-964.
  - Today: `StorageTypeInstanceSchema` requires `nativeType` (67); the value-object check requires the column's `nativeType` to be `json` or `jsonb` (711-721); the junction-column check compares `nativeType` and `typeParams` (943-964).
  - Becomes: Schema requires `dataType`. The junction check compares `dataType` and `typeParams` (decision 3). The value-object check compares `dataType` against the JSON data types; DECISION NEEDED 2, because the set `pg/json`, `pg/jsonb`, `sqlite/json` is target knowledge in a family package. Loading also gains the new check that each column's codec represents its `dataType`, which needs a codec lookup this validator does not take today.

### Schema IR (`packages/2-sql/1-core/schema-ir`)

- `packages/2-sql/1-core/schema-ir/src/ir/resolved-default-equality.ts`
  - Symbols and lines: `nativeType` 14-27, 43-51, 107-124.
  - Today: `resolvedDefaultsEqual(expected, actual, nativeType)` decides how to normalise literal values by matching the type text: temporal names, `int8`/`bigint`, `numeric(...)`, a `[]` suffix.
  - Becomes: DECISION NEEDED 3: these branches match Postgres type names in a family package. TML-3253 moves value reading to codecs; what remains here must branch on something other than a type text.
- `packages/2-sql/1-core/schema-ir/src/ir/sql-column-default-ir.ts`
  - Symbols and lines: `codecBaseNativeType` 35-36, 66-67, 79.
  - Today: The default node copies `codecBaseNativeType`, `codecRef`, `codecNamedType`, `many` and `nativeTypeContext` from its column so `SET DEFAULT` can be rendered and defaults compared.
  - Becomes: Carries the column's data type id and parameters instead of `codecBaseNativeType` and `nativeTypeContext`.
- `packages/2-sql/1-core/schema-ir/src/ir/sql-column-ir.ts`
  - Symbols and lines: `nativeType` 21-26, 104-108, 124, 159, 192; `resolvedNativeType` 36, 68, 94, 110, 129, 157, 178, 188-189; `codecBaseNativeType` 73, 116-117, 133, 166.
  - Today: Declares the column node and its type comparison. See "The schema IR" below.
  - Becomes: See "The schema IR" below.
- `packages/2-sql/1-core/schema-ir/src/types.ts`
  - Symbols and lines: `targetTypes` 55; `nativeType` 61.
  - Today: Declares `SqlTypeMetadata { typeId, targetTypes, nativeType? }` and its registry interface.
  - Becomes: Deleted with `typeMetadataRegistry` (decision 7).

### Authoring: contract-ts (`packages/2-sql/2-authoring/contract-ts`)

- `packages/2-sql/2-authoring/contract-ts/src/authoring-helper-runtime.ts`
  - Symbols and lines: `nativeType` 49.
  - Today: Turns a type constructor into a `type.*` helper that returns a `StorageTypeInstance` with the template's `nativeType`.
  - Becomes: Writes `dataType`, looked up from the constructor's codec.
- `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`
  - Symbols and lines: `nativeType` 392, 428-432, 638-651, 848, 876, 1638.
  - Today: The one write point of every SQL contract. `buildStorageColumn` copies `descriptor.nativeType` (876); value-object columns are hard-coded to `jsonb` / `pg/jsonb@1` (729-730, 848); `qualifyColumnDescriptor` passes `nativeType` through the target's `qualifyColumnType` hook (428-432, 638-651); raw `storageTypes` entries are normalised with `nativeType` (1638).
  - Becomes: Writes `dataType` for columns and `storage.types` entries. The qualifier hook returns only `typeParams`, since an enum's name lives in `typeParams.typeName` (decision 3). The codec lookup is optional here today (835); see DECISION NEEDED 1.
- `packages/2-sql/2-authoring/contract-ts/src/composed-authoring-helpers.ts`
  - Symbols and lines: `nativeType` 82.
  - Today: Type-level: a composed helper's result type resolves `Descriptor['output']['nativeType']`.
  - Becomes: The type member is deleted with the template field.
- `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts`
  - Symbols and lines: `nativeType` 108, 136.
  - Today: Builds a field's column descriptor from an enum handle or a named storage type, copying `nativeType` (108, 136).
  - Becomes: Copies `dataType`.
- `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts`
  - Symbols and lines: `nativeType` 306, 349, 363-365, 485.
  - Today: Type-level: infers the literal `nativeType` of a descriptor into the built contract's column type (306, 363-365, 485).
  - Becomes: Infers `dataType`. The built contract type must match the emitted `contract.d.ts` column shape.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/2-sql/2-authoring/contract-ts/src/data-contract-json-schema.ts`
  - Today: Generates `schemas/data-contract-sql-v1.json` from the arktype schemas.
  - Becomes: No edit expected; its output changes. See list (a).

### Authoring: contract-psl (`packages/2-sql/2-authoring/contract-psl`)

- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`
  - Symbols and lines: `nativeType` 555.
  - Today: Records each enum block's `{codecId, nativeType}` from its handle (555).
  - Becomes: Records what the handle carries after DECISION NEEDED 1.
- `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts`
  - Symbols and lines: `nativeType` 78, 94-98, 159, 254-260, 285, 377; `nativeTypeFor` 255.
  - Today: Resolves a field's type to a `ColumnDescriptor` with `nativeType`, from constructors, presets, enums and the codec's `columnFromEntity` hook (78-98, 159, 254-285, 377).
  - Becomes: The descriptor drops `nativeType`; `columnFromEntity` returns only `typeParams`.
- `packages/2-sql/2-authoring/contract-psl/src/psl-named-type-resolution.ts`
  - Symbols and lines: `nativeType` 150, 198.
  - Today: Lowers a `types { X = ... }` alias to a `storage.types` entry with `nativeType` (150) and a field descriptor (198).
  - Becomes: Writes `dataType` (decision 8: aliases keep working).

### Authoring: contract-prisma7 (`packages/2-sql/2-authoring/contract-prisma7`)

- `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts`
  - Symbols and lines: `nativeType` 845-858, 921-929, 1021-1045, 1098.
  - Today: Lines 845-1045 use `nativeType` for the Prisma 7 `@db.X` attribute name, which is a different thing. Line 1098 prints the resolved column's `descriptor.nativeType` in the `@updatedAt` message.
  - Becomes: Only line 1098 changes: the message names the rendered type name, obtained from the family's render function. The `@db.X` code is unchanged.
- `packages/2-sql/2-authoring/contract-prisma7/src/native-types.ts`
  - Symbols and lines: `nativeType` 30-34.
  - Today: Maps a Prisma 7 `@db.X` name to a Prisma 8 constructor call.
  - Becomes: Unchanged: `nativeType` here is the Prisma 7 attribute name.
- `packages/2-sql/2-authoring/contract-prisma7/src/target-binding.ts`
  - Symbols and lines: `nativeType` 7.
  - Today: `Prisma7ColumnType` carries `nativeType`; the binding's `literalDefaultForm` receives it.
  - Becomes: Carries the column's data type id; `literalDefaultForm` branches on the id.

### SQL emitter (`packages/2-sql/3-tooling/emitter`)

- `packages/2-sql/3-tooling/emitter/src/index.ts`
  - Symbols and lines: `nativeType` 667-683, 730, 747.
  - Today: Writes `readonly nativeType: '…'` into every column (730, 747) and every `storage.types` entry (667-683) of `contract.d.ts`.
  - Becomes: Writes `readonly dataType: '…'`. See list (b).

### relational-core (`packages/2-sql/4-lanes/relational-core`)

- `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`
  - Symbols and lines: `targetTypes` 90.
  - Today: Doc comment lists `targetTypes` as descriptor metadata.
  - Becomes: Comment text only.
- `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts`
  - Symbols and lines: `nativeType` 18.
  - Today: `DdlColumnRenderContext.nativeType` tells the default visitor the parent column's rendered type, so the Postgres renderer can add a `::jsonb` cast.
  - Becomes: Unchanged in shape: it carries a rendered name, which DDL rendering still needs. It may be renamed for clarity.
- `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`
  - Symbols and lines: `targetTypes` 75, 113, 151, 189, 230.
  - Today: The five shared `sql/*` codec descriptors declare `targetTypes` (`text`, `int`, `float`, `char`, `varchar`).
  - Becomes: The five declarations are deleted.
- `packages/2-sql/4-lanes/relational-core/src/codec-descriptor-registry.ts`
  - Symbols and lines: `byTargetType` 24, 38-42, 58-59; `targetTypes` 37.
  - Today: Indexes descriptors by `targetTypes` and exposes `byTargetType`; only tests read it.
  - Becomes: The index and `byTargetType` are deleted.
- `packages/2-sql/4-lanes/relational-core/src/query-lane-context.ts`
  - Symbols and lines: `targetTypes` 11, 37, 87; `byTargetType` 39.
  - Today: Declares `byTargetType` on the registry interface (39) and mentions `targetTypes` in comments.
  - Becomes: Declaration deleted; comments rewritten.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts`
  - Today: `col(name, type, options)` (line 30) builds a `DdlColumn` whose `type` is a rendered type text; generated and hand-written `migration.ts` files call it.
  - Becomes: Unchanged. It is the public migration authoring function and takes a rendered name.

### SQL runtime (`packages/2-sql/5-runtime`)

No production file in this group contains any of the listed symbols.

### SQL family (`packages/2-sql/9-family`)

- `packages/2-sql/9-family/src/core/assembly.ts`
  - Symbols and lines: `controlPlaneHooks` 12-23, 40-41.
  - Today: Collects every component's `controlPlaneHooks` into one map keyed by codec id.
  - Becomes: Unchanged as a mechanism (the map still carries `planTypeOperations` and `resolveIdentityValue`); the hook type loses `expandNativeType`.
- `packages/2-sql/9-family/src/core/authoring-entity-types.ts`
  - Symbols and lines: `nativeType` 42-43, 129; `targetTypesFor` 42, 57.
  - Today: An enum block takes its type name from `codecLookup.targetTypesFor(codecId)[0]` (42) and passes `{codecId, nativeType}` to `enumType` (129).
  - Becomes: Stops reading `targetTypes`. Checks that the codec is registered through `codecLookup.get`, and passes the descriptor shape from DECISION NEEDED 1.
- `packages/2-sql/9-family/src/core/authoring-field-presets.ts`
  - Symbols and lines: `nativeType` 46, 56, 67, 82, 92, 103, 120, 137, 155, 184, 201.
  - Today: Eleven id presets hard-code `nativeType: 'character'` with `sql/char@1`.
  - Becomes: The eleven `nativeType` lines are deleted (decision 8: presets lower through the new template).
- `packages/2-sql/9-family/src/core/authoring-type-constructors.ts`
  - Symbols and lines: `nativeType` 11.
  - Today: `sql.String(length)` hard-codes `nativeType: 'character varying'`.
  - Becomes: The line is deleted.
- `packages/2-sql/9-family/src/core/control-adapter.ts`
  - Symbols and lines: `normalizeNativeType` 192.
  - Today: Declares the optional `normalizeNativeType` member of the control adapter, which nothing calls.
  - Becomes: Deleted.
- `packages/2-sql/9-family/src/core/control-instance.ts`
  - Symbols and lines: `nativeType` 197, 352, 383, 1110, 1119; `typeMetadataRegistry` 205, 553, 649.
  - Today: Builds `typeMetadataRegistry` from pack metadata `types.storage[]` (197-205, 352-386, 553, 649). Separately, the schema view labels each column with the schema IR's `nativeType` (1110-1119).
  - Becomes: The registry and its types are deleted. The schema view is unchanged if the schema IR keeps a rendered name (it must, see "The schema IR").
- `packages/2-sql/9-family/src/core/diff/sql-schema-diff.ts`
  - Symbols and lines: `nativeType` 18-26.
  - Today: Declares the types `DefaultNormalizer(rawDefault, nativeType)` and `NativeTypeNormalizer`.
  - Becomes: `NativeTypeNormalizer` is deleted. `DefaultNormalizer`'s second parameter follows DECISION NEEDED 3.
- `packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts`
  - Symbols and lines: `nativeType` 36, 46, 78, 96, 107-123, 132, 154, 165, 188, 207, 588; `resolvedNativeType` 71, 120-128, 146; `expandNativeType` 92, 105-106, 332, 343, 439, 460, 508, 559; `codecBaseNativeType` 154; `deriveAnnotations` 567, 579.
  - Today: `convertColumn` resolves `typeRef`, expands the name through the `expandNativeType` callback, and stamps `nativeType`, `resolvedNativeType`, `codecRef`, `codecBaseNativeType` and `codecNamedType` (88-157). `deriveAnnotations` builds a `storageTypes` annotation keyed by `nativeType` (567-596).
  - Becomes: `convertColumn` reads `dataType` and `typeParams` and calls the family's render function for the rendered name. The `NativeTypeExpander` type, the `expandNativeType` option and the `storageTypes` part of `deriveAnnotations` are deleted.
- `packages/2-sql/9-family/src/core/migrations/field-event-planner.ts`
  - Symbols and lines: `nativeType` 199.
  - Today: `sameStorageColumn` compares `nativeType` to decide whether a codec lifecycle event fires.
  - Becomes: Compares `dataType`.
- `packages/2-sql/9-family/src/core/migrations/native-type-expander.ts`
  - Symbols and lines: `expandNativeType` 5, 25-26; `nativeType` 18-25.
  - Today: `buildNativeTypeExpander` composes the per-codec `expandNativeType` hooks into one callback.
  - Becomes: The file is deleted; the family's render function replaces it.
- `packages/2-sql/9-family/src/core/migrations/types.ts`
  - Symbols and lines: `nativeType` 45, 58, 133-136; `expandNativeType` 138.
  - Today: Declares `ExpandNativeTypeInput` (45), `ResolveIdentityValueInput.nativeType` (58) and `CodecControlHooks.expandNativeType` (138).
  - Becomes: `ExpandNativeTypeInput` and the `expandNativeType` member are deleted. `ResolveIdentityValueInput` carries the data type id.
- `packages/2-sql/9-family/src/core/psl-build/type-map.ts`
  - Symbols and lines: `nativeType` 10-20.
  - Today: Declares `PslTypeMap.resolve(nativeType)`, the interface of `contract infer`'s hand table.
  - Becomes: Deleted with the hand tables (decision 7); infer asks the stack which constructor a data type prints.
- `packages/2-sql/9-family/src/core/psl-contract-infer/printer-config.ts`
  - Symbols and lines: `nativeType` 14.
  - Today: Declares `parseRawDefault(rawDefault, nativeType)`.
  - Becomes: The second parameter follows DECISION NEEDED 3.
- `packages/2-sql/9-family/src/core/timestamp-now-generator.ts`
  - Symbols and lines: `nativeType` 46, 55.
  - Today: `temporalCodecPresetWithPrecision({codecId, nativeType})` builds a temporal field preset whose output carries `nativeType`.
  - Becomes: The `nativeType` input and output field are deleted.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/2-sql/9-family/src/core/ (new files)`
  - Today: Nothing today.
  - Becomes: New: `sqlDataType(id, spec)`, the render function, and the resolver from a reported type text to a data type id and parameters.

### Postgres target (`packages/3-targets/3-targets/postgres`)

- `packages/3-targets/3-targets/postgres/src/core/authoring.ts`
  - Symbols and lines: `nativeType` 118, 127, 751-869, 883.
  - Today: Type constructors `BigIntNumber`, `UnboundedInt` (118, 127) and the field presets (751-883) hard-code `nativeType`.
  - Becomes: The 23 `nativeType` lines are deleted. The target also receives the adapter's constructor table (decision 6).
- `packages/3-targets/3-targets/postgres/src/core/codec-descriptor.ts`
  - Symbols and lines: `nativeTypeFor` 41, 88, 123, 236-237; `nativeType` 51, 89, 113, 175-176; `targetTypes` 131, 151, 222-224.
  - Today: Declares the Postgres codec hook: abstract `nativeType(params)` (51), public `nativeTypeFor(ref)` (41, 88-89), the `postgresCodec` option `nativeType` (113, 175-176), and the descriptor type guard that requires `targetTypes` and `nativeTypeFor` (222-237).
  - Becomes: The hook, `nativeTypeFor`, the option and the two guard conditions are deleted (decision 2).
- `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`
  - Symbols and lines: `nativeType` 35, 57, 261, 270.
  - Today: Parameter validation errors carry `meta.nativeType` with the type name.
  - Becomes: Moves into the data types' parameter schemas; the error metadata key is a naming choice.
- `packages/3-targets/3-targets/postgres/src/core/codecs.ts`
  - Symbols and lines: `nativeType` 326-350, 377, 416, 467, 494, 503-505, 533-550, 582, 623, 673, 734, 790, 838, 886, 934, 996, 1057, 1112, 1163, 1213, 1261, 1308, 1355, 1418, 1479, 1528, 1573, 1622, 1652, 1687, 1714; `targetTypes` 386, 476, 591, 632, 682, 743, 799, 847, 895, 943, 1005, 1066, 1121, 1172, 1222, 1270, 1317, 1364, 1427, 1488, 1537, 1582, 1630, 1660, 1695, 1722; `qualifyNativeType` 493, 517, 533, 549; `nativeTypeFor` 495.
  - Today: Thirty codec descriptors each declare `targetTypes` and a `nativeType()` hook; the five adapted `sql/*` descriptors pass `nativeType: () => …` (326-350). `PgEnumDescriptor.columnFromEntity` returns `nativeType` (503-505); `qualifyNativeType` and `qualifyPgEnumColumnType` schema-qualify an enum's name in both `nativeType` and `typeParams.typeName` (517-550).
  - Becomes: Every `targetTypes` and `nativeType` member is deleted. `columnFromEntity` and the qualifier return only `typeParams`.
- `packages/3-targets/3-targets/postgres/src/core/date-codecs.ts`
  - Symbols and lines: `nativeType` 121; `targetTypes` 130.
  - Today: `pg/timestamptz-date@1` declares an empty `targetTypes` and a `nativeType()` hook.
  - Becomes: Both deleted.
- `packages/3-targets/3-targets/postgres/src/core/default-normalizer.ts`
  - Symbols and lines: `nativeType` 139-141, 361-369; `resolvedNativeType` 454-459.
  - Today: `parsePostgresDefault(rawDefault, nativeType)` and `postgresResolveDefault(def, resolvedNativeType)` branch on the type text with regular expressions (139-141, 361-369, 454-459).
  - Becomes: Shared with TML-3253, which makes the parser syntax-only. What is left takes the column's data type or codec instead of a type text.
- `packages/3-targets/3-targets/postgres/src/core/migrations/column-ddl-rendering.ts`
  - Symbols and lines: `buildExpectedFormatType` 12-16, 104; `codecBaseNativeType` 18, 41-54; `nativeType` 30, 47-57, 133.
  - Today: Rebuilds a `StorageColumn`-shaped object from the schema IR node's `codecRef`, `codecBaseNativeType` and `codecNamedType`, then calls `buildColumnTypeSql`, `buildExpectedFormatType` and `resolveIdentityValue`.
  - Becomes: Reads the node's data type id and parameters and calls the family's render function. `buildExpectedFormatType` is deleted; see DECISION NEEDED 5.
- `packages/3-targets/3-targets/postgres/src/core/migrations/diff-database-schema.ts`
  - Symbols and lines: `expandNativeType` 135-138, 231-234.
  - Today: Builds the expander with `buildNativeTypeExpander` and passes it to `contractToSchemaIR` (135-138, 231-234).
  - Becomes: The option is deleted; `contractToSchemaIR` reads the stack's data types.
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts`
  - Symbols and lines: `resolvedNativeType` 371-372; `nativeType` 375.
  - Today: `columnTypeChanged` compares `resolvedNativeType`, falling back to `nativeType` and `many`.
  - Becomes: Compares data type id, parameters and `many` by exact equality.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts`
  - Symbols and lines: `nativeType` 18-24, 55, 66-72, 84, 94-103, 113-115, 126-145, 168-173, 190, 199-208; `resolvedNativeType` 81; `expandNativeType` 120-133.
  - Today: `buildColumnTypeSql` picks `SERIAL`, `BIGSERIAL` or `SMALLSERIAL` by name, quotes enum and `typeRef` names, and expands parameters through the hook (52-140); `renderDefaultLiteral` and `renderArrayLiteralDefault` branch on `json`/`jsonb` and append `::<type>` (166-208); `assertSafeNativeType` guards the name (18-24).
  - Becomes: Branches on the data type id (`pg/int4`, `pg/int8`, `pg/int2`, `pg/enum`, `pg/json`, `pg/jsonb`) and calls the family's render function for the text. The `expandNativeType` error paths (103-139) are deleted.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-identity-values.ts`
  - Symbols and lines: `nativeType` 17-22, 31, 46-49, 122-123.
  - Today: `resolveIdentityValue` passes `nativeType` to the codec hook and falls back to a switch over type names.
  - Becomes: Reads `dataType`; the switch is keyed by data type id.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-sql-checks.ts`
  - Symbols and lines: `FORMAT_TYPE_DISPLAY` 22, 168; `buildExpectedFormatType` 146; `expandNativeType` 155-156; `nativeType` 157-168.
  - Today: `FORMAT_TYPE_DISPLAY` maps a stored name to the text `format_type` prints (22-33); `buildExpectedFormatType` uses it for the `ALTER COLUMN TYPE` postcheck (146-168).
  - Becomes: Both deleted (decision 7). See DECISION NEEDED 5 for what the postcheck compares.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`
  - Symbols and lines: `nativeType` 266-267, 328-334.
  - Today: The type-change strategies read the schema IR's `nativeType` on both sides: `SAFE_WIDENINGS` is keyed by `"int4→int8"` text (266-267), and `columnTypeChangedNativeOnly` compares the names (328-334).
  - Becomes: Compares data type ids; `SAFE_WIDENINGS` is keyed by id pairs.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-type-resolution.ts`
  - Symbols and lines: `nativeType` 5-9, 23.
  - Today: `resolveColumnTypeMetadata` follows `typeRef` to `{codecId, nativeType, typeParams}`.
  - Becomes: Returns `{codecId, dataType, typeParams}`.
- `packages/3-targets/3-targets/postgres/src/core/native-type-normalizer.ts`
  - Symbols and lines: `normalizeSchemaNativeType` 26; `nativeType` 26-27.
  - Today: `normalizeSchemaNativeType` rewrites `varchar`, `bpchar`, `varbit` and the `with/without time zone` forms to the stored names.
  - Becomes: The file is deleted; the family's resolver replaces it. (The decisions name `normalizeFormattedType`; this second table does the same job and goes with it.)
- `packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts`
  - Symbols and lines: `nativeType` 16-17, 60-79.
  - Today: `literalDefaultForm({nativeType, typeParams})` branches on `json`, `jsonb`, `bytea` and the temporal names, and renders `TIMESTAMP(3)`-style type text (16-17, 59-79).
  - Becomes: Branches on the data type id; the type text comes from the family's render function.
- `packages/3-targets/3-targets/postgres/src/core/prisma7-temporal-defaults.ts`
  - Symbols and lines: `nativeType` 48, 65, 79-92.
  - Today: `storedTemporalText(text, nativeType)` branches on `date`, `time`, `timetz`, `timestamptz`.
  - Becomes: Branches on the data type id.
- `packages/3-targets/3-targets/postgres/src/core/psl-build/postgres-type-map.ts`
  - Symbols and lines: `POSTGRES_TO_PSL` 3, 61, 107; `PRESERVED_NATIVE_TYPES` 17, 62, 99; `PARAMETERIZED_NATIVE_TYPES` 42, 63, 89; `nativeType` 81-115.
  - Today: The hand tables `POSTGRES_TO_PSL`, `PRESERVED_NATIVE_TYPES`, `PARAMETERIZED_NATIVE_TYPES` and the parameter regular expression map an introspected type text to a PSL type name.
  - Becomes: The file is deleted (decision 7).
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts`
  - Symbols and lines: `nativeType` 233, 243, 264, 376, 488-492.
  - Today: Resolves each introspected column through the type map (233), prints `Unsupported("…")` when nothing matches (243), finds enums by `nativeType` (264), and passes `nativeType` to the default parser (376, 488-492).
  - Becomes: Reads the column's resolved data type id and parameters and prints the constructor that data type marks. The `Unsupported` branch becomes a failure naming table, column and reported type.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-psl-contract.ts`
  - Symbols and lines: `nativeType` 144-149, 203.
  - Today: Matches a column's `nativeType` against enum type names owned by extension contract spaces (144-149, 203).
  - Becomes: Matches `typeParams.typeName` of a column resolved to `pg/enum`.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/junction-relation-field-names.ts`
  - Symbols and lines: `nativeType` 18, 41.
  - Today: Builds throwaway schema IR columns with `nativeType: 'int4'` to compute relation field names.
  - Becomes: Follows the schema IR column input shape.
- `packages/3-targets/3-targets/postgres/src/core/psl-print/column-types.ts`
  - Symbols and lines: `nativeType` 33, 96.
  - Today: The contract-to-PSL printer rebuilds `numeric(10, 2)` text from `nativeType` and `typeParams` to look up the type map (29-33) and finds enum blocks by `nativeType` (96).
  - Becomes: Looks up the constructor by `dataType` and parameters; finds the enum by `typeParams.typeName`.
- `packages/3-targets/3-targets/postgres/src/core/psl-print/domain-types.ts`
  - Symbols and lines: `nativeTypeFor` 40; `nativeType` 63, 127.
  - Today: Gets a value-object field's type name from `descriptor.nativeTypeFor({codecId})` (40) and copies a named type's `nativeType` (127).
  - Becomes: Reads the codec's `dataType`.
- `packages/3-targets/3-targets/postgres/src/core/psl-print/enum-blocks.ts`
  - Symbols and lines: `nativeType` 90.
  - Today: Keys enum value-set names by the column's `nativeType`.
  - Becomes: Keys by `typeParams.typeName`.
- `packages/3-targets/3-targets/postgres/src/core/psl-print/refusals.ts`
  - Symbols and lines: `nativeType` 63-66, 364-368, 455.
  - Today: Refusal messages and metadata name the column's `nativeType` (63-66); a column is compared with its named type by `nativeType` and `codecId` (364-368, 455).
  - Becomes: Names and compares `dataType`.
- `packages/3-targets/3-targets/postgres/src/core/temporal-codecs.ts`
  - Symbols and lines: `nativeType` 60, 109, 166, 221; `targetTypes` 69, 118, 175, 230.
  - Today: Four temporal codecs declare `targetTypes` and a `nativeType()` hook.
  - Becomes: All eight members deleted.
- `packages/3-targets/3-targets/postgres/src/core/temporal-string-codecs.ts`
  - Symbols and lines: `nativeType` 52, 100, 159, 217; `targetTypes` 61, 109, 168, 226.
  - Today: Four temporal string codecs declare an empty `targetTypes` and a `nativeType()` hook.
  - Becomes: All eight members deleted.
- `packages/3-targets/3-targets/postgres/src/exports/control.ts`
  - Symbols and lines: `expandNativeType` 73.
  - Today: Passes `expandNativeType` into the planner options.
  - Becomes: The option is deleted.
- `packages/3-targets/3-targets/postgres/src/exports/native-type-normalizer.ts`
  - Symbols and lines: `normalizeSchemaNativeType` 1.
  - Today: Exports `normalizeSchemaNativeType`.
  - Becomes: Deleted, and the `./native-type-normalizer` entry in the package's `exports`.
- `packages/3-targets/3-targets/postgres/src/exports/planner-sql-checks.ts`
  - Symbols and lines: `buildExpectedFormatType` 2.
  - Today: Exports `buildExpectedFormatType`.
  - Becomes: The export is deleted.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-targets/3-targets/postgres/src/core/data-types.ts`
  - Today: Declares 26 data types with `dataType(id, {casts})` (56-118).
  - Becomes: Each is declared with `sqlDataType`, adding name, other names, parameter schema and rendering.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-default-codec.ts`
  - Today: The hand table `CODEC_ID_BY_INFERRED_TYPE` (24-45) maps a PSL type name to a codec id. The task and `research.md` call it `CODEC_ID_BY_PRINTED_TYPE`; it was renamed.
  - Becomes: Deleted (decision 7); the codec comes from the constructor the data type marks (decision 10).
- `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`
  - Today: The operation call classes. `AlterColumnTypeOptions` (482-487) holds `qualifiedTargetType`, `formatTypeExpected`, `rawTargetTypeForLabel`; `CreateTableCall` and `AddColumnCall` hold `DdlColumn` values; `AddNotNullColumnWithTempDefaultCall` holds a `StorageColumn` (795).
  - Becomes: See "Migration operations" below.
- `packages/3-targets/3-targets/postgres/src/core/migrations/operations/columns.ts`
  - Today: `alterColumnType` writes `qualifiedTargetType` into the `ALTER` statement and `formatTypeExpected` into the postcheck (66-113).
  - Becomes: See "Migration operations" and DECISION NEEDED 5.

### Postgres adapter (`packages/3-targets/6-adapters/postgres`, `postgres-codec-testkit`)

- `packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts`
  - Symbols and lines: `nativeTypeFor` 335.
  - Today: The codec conformance kit gets the element type of a cast from `descriptor.nativeTypeFor(ref)`.
  - Becomes: Calls the family's render function with the codec's data type.
- `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
  - Symbols and lines: `normalizeSchemaNativeType` 75, 172, 1083-1091; `normalizeNativeType` 172; `nativeType` 210, 1052-1091, 1110, 1698-1708, 1788-1796, 1806-1830, 1845-1865, 1885-1889; `normalizeFormattedType` 1054, 1482-1484; `resolvedNativeType` 1091, 1106-1114.
  - Today: Introspection builds each column's type text from `format_type` through `normalizeFormattedType` and `normalizeSchemaNativeType`, strips `[]` into `many`, and stamps `nativeType` and `resolvedNativeType` (1052-1114). `normalizeFormattedType` is the alias table (1482-1531). The DDL default renderer branches on the rendered type text (1698-1889). The adapter sets the unused `normalizeNativeType` member (172).
  - Becomes: Introspection calls the family's resolver with the reported text and stamps the data type id and parameters. `normalizeFormattedType` and the `normalizeNativeType` member are deleted. The default renderer (shared with TML-3253) keeps receiving a rendered name, because it writes `::<type>` casts.
- `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`
  - Symbols and lines: `nativeType` 142, 152-198, 209, 219, 232, 245, 256, 266, 276-303, 312-320, 331, 341, 351; `targetTypesFor` 143.
  - Today: The main scalar type-constructor table; every constructor hard-codes `nativeType`.
  - Becomes: The 27 `nativeType` lines are deleted and the table moves to the Postgres target (decisions 5 and 6).
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts`
  - Symbols and lines: `nativeType` 66-108, 117-141, 226-325; `expandNativeType` 138-141; `controlPlaneHooks` 201.
  - Today: Defines the `expandLength`, `expandPrecision`, `expandNumeric` and identity hooks (66-141), registers them under `controlPlaneHooks` (201-223), and lists pack metadata `types.storage[]` with `nativeType` for 37 codec ids (225-326). It also registers the Postgres data types.
  - Becomes: The four hook functions, their registrations and the whole `types.storage` list are deleted. Data type registration moves to the target.
- `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`
  - Symbols and lines: `nativeTypeFor` 54-58, 115; `nativeType` 54, 115-121.
  - Today: Runtime: renders `$1::<type>` parameter casts from `descriptor.nativeTypeFor(ref)`; `POSTGRES_INFERRABLE_NATIVE_TYPES` lists the hook's names (`integer`, `boolean`, …) for which no cast is written (54-123).
  - Becomes: Calls the family's render function with the codec's data type, so casts read `$1::int4`. The inferrable set is keyed by data type id. See DECISION NEEDED 4 for how the runtime plane reaches the SQL data types.
- `packages/3-targets/6-adapters/postgres/src/exports/column-types.ts`
  - Symbols and lines: `nativeType` 4, 39-47, 57-84, 95, 106-136, 146, 158, 170-185, 195, 207, 217, 229-237.
  - Today: The public TypeScript column helpers; 27 descriptors hard-code `nativeType`.
  - Becomes: The `nativeType` lines are replaced according to DECISION NEEDED 1. The import path `@prisma/orm-postgres/column-types` does not change (decision 6).
- `packages/3-targets/6-adapters/postgres/src/exports/control.ts`
  - Symbols and lines: `normalizeSchemaNativeType` 43.
  - Today: Re-exports `normalizeSchemaNativeType`.
  - Becomes: The re-export is deleted.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts`
  - Today: Registers the Postgres data types (research section 1).
  - Becomes: Registration moves to the target (decision 6). Already listed above for its hooks.

### SQLite target (`packages/3-targets/3-targets/sqlite`)

- `packages/3-targets/3-targets/sqlite/src/core/authoring.ts`
  - Symbols and lines: `nativeType` 17, 26-30.
  - Today: Type constructor and presets hard-code `nativeType` (`integer`, `text`).
  - Becomes: The three lines are deleted. The target also receives the adapter's constructor table.
- `packages/3-targets/3-targets/sqlite/src/core/codec-descriptor.ts`
  - Symbols and lines: `targetTypes` 80, 97, 159-161.
  - Today: The adapted-descriptor class copies `targetTypes`, and the descriptor type guard requires it.
  - Becomes: Both deleted.
- `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`
  - Symbols and lines: `targetTypes` 283, 339, 390, 439, 500, 542, 614, 685.
  - Today: Eight codec descriptors declare `targetTypes`.
  - Becomes: All eight deleted. The adaptation of `sql/char@1` names the new `character` data type (settled Q4).
- `packages/3-targets/3-targets/sqlite/src/core/default-normalizer.ts`
  - Symbols and lines: `nativeType` 45, 78; `resolvedNativeType` 102-107.
  - Today: `parseSqliteDefault(rawDefault, nativeType)` treats a large integer as text when the type is `integer`; `sqliteResolveDefault(def, resolvedNativeType)`.
  - Becomes: Takes the column's data type or codec instead of a type text (follows DECISION NEEDED 3).
- `packages/3-targets/3-targets/sqlite/src/core/migrations/column-ddl-rendering.ts`
  - Symbols and lines: `codecBaseNativeType` 22, 33-39; `nativeType` 32-43.
  - Today: Rebuilds a `StorageColumn`-shaped object from the schema IR node's `codecRef` and `codecBaseNativeType`.
  - Becomes: Reads the node's data type id and calls the family's render function.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/diff-database-schema.ts`
  - Symbols and lines: `typeMetadataRegistry` 29; `nativeType` 29; `expandNativeType` 56, 67, 128-130, 170-172.
  - Today: Takes `typeMetadataRegistry` as an input it never reads (29) and passes the expander to `contractToSchemaIR` (56-67, 128-130, 170-172).
  - Becomes: Both inputs are deleted.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts`
  - Symbols and lines: `resolvedNativeType` 117-118; `nativeType` 121.
  - Today: `columnTypeChanged` compares `resolvedNativeType`, falling back to `nativeType` and `many`.
  - Becomes: Compares data type id, parameters and `many` by exact equality.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts`
  - Symbols and lines: `resolvedNativeType` 225-226; `nativeType` 229.
  - Today: A second copy of `columnTypeChanged`, used by the recreate-table postcheck.
  - Becomes: Same change.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts`
  - Symbols and lines: `nativeType` 24-30, 56-57, 128, 147.
  - Today: `buildColumnTypeSql` upper-cases the resolved `nativeType` and ignores parameters (52-57); `resolveColumnTypeMetadata` follows `typeRef` (128-147).
  - Becomes: Calls the family's render function and upper-cases the result; follows `typeRef` to `dataType`.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts`
  - Symbols and lines: `typeMetadataRegistry` 105.
  - Today: Passes `family.typeMetadataRegistry` to the diff.
  - Becomes: The argument is deleted.
- `packages/3-targets/3-targets/sqlite/src/core/native-type-normalizer.ts`
  - Symbols and lines: `normalizeSqliteNativeType` 7; `nativeType` 7-8.
  - Today: `normalizeSqliteNativeType` trims and lower-cases.
  - Becomes: The file is deleted.
- `packages/3-targets/3-targets/sqlite/src/exports/native-type-normalizer.ts`
  - Symbols and lines: `normalizeSqliteNativeType` 1.
  - Today: Exports `normalizeSqliteNativeType`.
  - Becomes: Deleted, and the package `exports` entry.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-targets/3-targets/sqlite/src/core/data-types.ts`
  - Today: Declares 7 data types (52-81).
  - Becomes: Declared with `sqlDataType`; gains the `character` data type.
- `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/shared.ts`
  - Today: `SqliteColumnSpec.typeSql` (38-44) is the rendered type token the operations write.
  - Becomes: Unchanged; it carries a rendered name.

### SQLite adapter (`packages/3-targets/6-adapters/sqlite`)

- `packages/3-targets/6-adapters/sqlite/src/core/column-types.ts`
  - Symbols and lines: `nativeType` 13-43.
  - Today: The TypeScript column helpers; seven descriptors hard-code `nativeType`.
  - Becomes: Replaced according to DECISION NEEDED 1.
- `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts`
  - Symbols and lines: `normalizeSqliteNativeType` 41, 127, 535; `normalizeNativeType` 127; `resolvedNativeType` 535-546; `nativeType` 539.
  - Today: Introspection stamps `nativeType` as the lower-cased declared type and `resolvedNativeType` through `normalizeSqliteNativeType` (535-546); sets the unused `normalizeNativeType` member (127).
  - Becomes: Calls the family's resolver with the declared type text and stamps the data type id. See DECISION NEEDED 6: on SQLite several data types are declared with the same text.
- `packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts`
  - Symbols and lines: `nativeType` 146, 156-191; `targetTypesFor` 147.
  - Today: The SQLite scalar type-constructor table; eight constructors hard-code `nativeType`.
  - Becomes: The lines are deleted and the table moves to the SQLite target.
- `packages/3-targets/6-adapters/sqlite/src/exports/control.ts`
  - Symbols and lines: `normalizeSqliteNativeType` 36-42.
  - Today: Re-exports `normalizeSqliteNativeType`.
  - Becomes: The re-export is deleted.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts`
  - Today: Registers the SQLite data types (line 33 per research section 1).
  - Becomes: Registration moves to the target.

### Extensions (`packages/3-extensions`)

- `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`
  - Symbols and lines: `nativeType` 214; `targetTypes` 223.
  - Today: Declares `targetTypes = ['jsonb']` and a `nativeType()` hook.
  - Becomes: Both deleted; the codec already names `pg/jsonb`.
- `packages/3-extensions/arktype-json/src/core/pack-meta.ts`
  - Symbols and lines: `nativeType` 34.
  - Today: Pack metadata `types.storage[]` entry with `nativeType: 'jsonb'`.
  - Becomes: Deleted.
- `packages/3-extensions/arktype-json/src/exports/control.ts`
  - Symbols and lines: `expandNativeType` 12, 24; `nativeType` 24; `controlPlaneHooks` 33.
  - Today: Registers an identity `expandNativeType` hook under `controlPlaneHooks`.
  - Becomes: The hook is deleted; the registration goes too if no other hook remains for the codec.
- `packages/3-extensions/pgvector/migrations/20260601T0000_install_vector_extension/migration.ts`
  - Symbols and lines: `nativeType` 12.
  - Today: A comment says contracts carry `vector(N)` as `nativeType`.
  - Becomes: Comment text only. The file is a shipped migration; its operations do not change.
- `packages/3-extensions/pgvector/src/contract.ts`
  - Symbols and lines: `nativeType` 52.
  - Today: The extension's own contract declares a `storage.types` entry with `nativeType: 'vector'`.
  - Becomes: Writes `dataType: 'pgvector/vector'`. The extension's contract-space hashes change; see `upgrade-rewrite.md` section 6.
- `packages/3-extensions/pgvector/src/core/authoring.ts`
  - Symbols and lines: `nativeType` 13.
  - Today: `pgvector.Vector(length)` hard-codes `nativeType: 'vector'`.
  - Becomes: The line is deleted.
- `packages/3-extensions/pgvector/src/core/codecs.ts`
  - Symbols and lines: `nativeType` 8, 176, 200; `expandNativeType` 8, 200; `targetTypes` 185.
  - Today: Declares `targetTypes = ['vector']` and a `nativeType()` hook; comments describe the hook.
  - Becomes: Both deleted; comments rewritten.
- `packages/3-extensions/pgvector/src/core/descriptor-meta.ts`
  - Symbols and lines: `nativeType` 105.
  - Today: Pack metadata `types.storage[]` entry with `nativeType: 'vector'`.
  - Becomes: Deleted.
- `packages/3-extensions/pgvector/src/exports/column-types.ts`
  - Symbols and lines: `expandNativeType` 2; `nativeType` 15, 40.
  - Today: The `vector(N)` column helper hard-codes `nativeType: 'vector'`.
  - Becomes: Replaced according to DECISION NEEDED 1.
- `packages/3-extensions/pgvector/src/exports/control.ts`
  - Symbols and lines: `controlPlaneHooks` 23, 95; `expandNativeType` 24, 65; `nativeType` 65-70.
  - Today: Registers the `expandNativeType` hook that renders `vector(N)` (64-73, 95).
  - Becomes: The hook is deleted; the rendering moves into the `pgvector/vector` data type declaration. `resolveIdentityValue` stays.
- `packages/3-extensions/pgvector/src/exports/runtime.ts`
  - Symbols and lines: `targetTypes` 11.
  - Today: A comment mentions `targetTypes`.
  - Becomes: Comment text only.
- `packages/3-extensions/postgis/migrations/20260601T0000_install_postgis_extension/migration.ts`
  - Symbols and lines: `nativeType` 12.
  - Today: A comment says contracts carry `geometry` as `nativeType`.
  - Becomes: Comment text only.
- `packages/3-extensions/postgis/src/contract.ts`
  - Symbols and lines: `nativeType` 47.
  - Today: The extension's own contract declares a `storage.types` entry with `nativeType: 'geometry'`.
  - Becomes: Writes `dataType: 'postgis/geometry'`. Contract-space hashes change.
- `packages/3-extensions/postgis/src/core/authoring.ts`
  - Symbols and lines: `nativeType` 11.
  - Today: `postgis.Geometry(srid)` hard-codes `nativeType: 'geometry'`.
  - Becomes: The line is deleted.
- `packages/3-extensions/postgis/src/core/codecs.ts`
  - Symbols and lines: `nativeType` 22-25, 149, 186-188; `expandNativeType` 22, 187; `targetTypes` 158.
  - Today: Declares `targetTypes = ['geometry']` and a `nativeType()` hook; comments describe the hook.
  - Becomes: Both deleted; comments rewritten.
- `packages/3-extensions/postgis/src/core/descriptor-meta.ts`
  - Symbols and lines: `nativeType` 174.
  - Today: Pack metadata `types.storage[]` entry with `nativeType: 'geometry'`.
  - Becomes: Deleted.
- `packages/3-extensions/postgis/src/exports/column-types.ts`
  - Symbols and lines: `nativeType` 15-23, 43.
  - Today: Two geometry column helpers hard-code `nativeType: 'geometry'`.
  - Becomes: Replaced according to DECISION NEEDED 1.
- `packages/3-extensions/postgis/src/exports/control.ts`
  - Symbols and lines: `controlPlaneHooks` 20, 88; `expandNativeType` 21, 52; `nativeType` 52-60.
  - Today: Registers the `expandNativeType` hook that renders `geometry(Geometry,srid)` (51-61, 88).
  - Becomes: The hook is deleted; the rendering moves into the `postgis/geometry` data type declaration.
- `packages/3-extensions/postgis/src/exports/runtime.ts`
  - Symbols and lines: `targetTypes` 12.
  - Today: A comment mentions `targetTypes`.
  - Becomes: Comment text only.
- `packages/3-extensions/postgres/src/contract/native-enum.ts`
  - Symbols and lines: `nativeType` 168.
  - Today: `pg.enum(handle)` builds a column descriptor whose `nativeType` is the enum's type name.
  - Becomes: The descriptor carries only `typeParams.typeName`; the column's data type is `pg/enum` (decision 3).
- `packages/3-extensions/supabase/src/contract/handles.ts`
  - Symbols and lines: `nativeType` 15-21.
  - Today: Hand-written descriptors `{ codecId: 'pg/text@1', nativeType: 'text' }` and the same for `timestamptz`.
  - Becomes: Replaced according to DECISION NEEDED 1. The generated `contract.json` beside it is regenerated by `contract:generate`.
- `packages/3-extensions/supabase/src/contract/roles.ts`
  - Symbols and lines: `nativeType` 15.
  - Today: Hand-written descriptor `{ codecId: 'pg/text@1', nativeType: 'text' }` passed to `enumType`.
  - Becomes: Replaced according to DECISION NEEDED 1.

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-extensions/pgvector/src/core/data-types.ts`
  - Today: Declares `pgvector/vector` (31-38).
  - Becomes: Declared with `sqlDataType`: name `vector`, parameter `length`, rendering `vector(N)` and its reading.
- `packages/3-extensions/postgis/src/core/data-types.ts`
  - Today: Declares `postgis/geometry` (6-10).
  - Becomes: Declared with `sqlDataType`: name `geometry`, parameter `srid`, rendering `geometry(Geometry,srid)` and its reading.

### Mongo family and target (`packages/2-mongo-family`, `packages/3-mongo-target`)

- `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`
  - Symbols and lines: `targetTypes` 13, 45.
  - Today: Comments mention `targetTypes`.
  - Becomes: Comment text only.
- `packages/2-mongo-family/2-authoring/contract-prisma6/src/interpreter.ts`
  - Symbols and lines: `nativeType` 543, 575, 584, 613-615, 634-638, 661, 791, 822, 834.
  - Today: Uses `nativeType` for the Prisma 6 `@db.ObjectId` attribute.
  - Becomes: Unchanged: a different thing with the same name.
- `packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts`
  - Symbols and lines: `targetTypesFor` 35.
  - Today: The collection validator takes each field's BSON type names from `codecLookup.targetTypesFor(codecId)`.
  - Becomes: Reads the BSON type names from the field codec's data type (decision 11). See DECISION NEEDED 7: `mongo/json@1` lists eight BSON type names, so a Mongo data type needs more than one name.
- `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`
  - Symbols and lines: `nativeType` 137.
  - Today: The deprecation message for an old scalar name prints `descriptor.output.nativeType`.
  - Becomes: Prints the BSON name from the data type.
- `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts`
  - Symbols and lines: `targetTypesFor` 42, 67; `nativeType` 139.
  - Today: An enum block takes its BSON type from `targetTypesFor(codecId)[0]` and passes `{codecId, nativeType: bsonType}` to `enumType`.
  - Becomes: Reads the BSON name from the data type; follows DECISION NEEDED 1 for the descriptor shape.
- `packages/3-mongo-target/1-mongo-target/src/core/authoring.ts`
  - Symbols and lines: `nativeType` 8.
  - Today: A hand-written descriptor `{ codecId, nativeType: 'date' }`.
  - Becomes: Drops `nativeType`.
- `packages/3-mongo-target/1-mongo-target/src/core/codecs.ts`
  - Symbols and lines: `targetTypes` 206, 219, 253-320; `nativeType` 246.
  - Today: Twelve codec descriptors declare `targetTypes` with their BSON type names (259-320); the descriptor builder copies it (206, 219); a parameter error carries `meta.nativeType` (246).
  - Becomes: The `targetTypes` members are deleted; the names move to the Mongo data types. The repository has twelve Mongo data types today, not eleven (`mongo/bson` was added).
- `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts`
  - Symbols and lines: `nativeType` 28-112; `targetTypesFor` 28; `targetTypes` 28.
  - Today: Fifteen zero-argument type constructors each carry a `nativeType` that nothing stores.
  - Becomes: The fifteen `nativeType` fields are deleted (decision 11).

Files in this group that the symbol search does not find but that must change or were checked:

- `packages/3-mongo-target/1-mongo-target/src/core/data-types.ts`
  - Today: Declares 12 data types with `dataType(id, {})` (9-20).
  - Becomes: Each takes its BSON type name or names (decision 11, DECISION NEEDED 7).

### CLI (`packages/1-framework/3-tooling/cli`)

- `packages/1-framework/3-tooling/cli/src/control-api/contract-enrichment.ts`
  - Symbols and lines: `controlPlaneHooks` 47.
  - Today: Copies each extension's pack metadata into the contract's `extensions` section, leaving out `controlPlaneHooks` and `codecDescriptors`. The copy includes `types.storage[]`, so emitted `contract.json` files carry `extensions.<pack>.types.storage[].nativeType`.
  - Becomes: Code unchanged, but its output changes: once pack metadata loses `types.storage`, the `extensions` section of every contract that uses pgvector, postgis or arktype-json loses those entries. The upgrade script must remove them too.

### Examples (`examples/`)

- `examples/prisma-8-demo/prisma/contract.ts`
  - Symbols and lines: `nativeType` 12-16.
  - Today: User-style TypeScript contract with hand-written `{ codecId: 'pg/text@1', nativeType: 'text' }` descriptors.
  - Becomes: Replaced according to DECISION NEEDED 1. This is the pattern in users' own `contract.ts` files.
- `examples/prisma-8-demo/src/app/ContractView.test.tsx`
  - Symbols and lines: `nativeType` 51-52.
  - Today: Test data for the view (matched the production filter because it is not under `test/`).
  - Becomes: Test data uses `dataType`.
- `examples/prisma-8-demo/src/app/ContractView.tsx`
  - Symbols and lines: `nativeType` 69.
  - Today: Shows each column's `nativeType` from `contract.json`.
  - Becomes: Shows `dataType`.

### Public packages (`packages/9-public`)

No production file in this group contains any of the listed symbols.

### Repository tooling and shipped skills

- `CHANGELOG.md`
  - Symbols and lines: `nativeType` 1045.
  - Today: A past release note mentions `nativeType`.
  - Becomes: Unchanged; history.
- `biome-plugins/no-family-vocabulary.grit`
  - Symbols and lines: `nativeType` 2, 70.
  - Today: Comments name `nativeType` as a forbidden word in the framework domain.
  - Becomes: Unchanged. The rule keeps forbidding the word; the framework code that loses the field lowers the ratchet count.
- `scripts/lint-framework-vocabulary.mjs`
  - Symbols and lines: `nativeType` 7.
  - Today: A comment names `nativeType` as an example.
  - Becomes: Unchanged.
- `scripts/lint-framework-vocabulary.test.mjs`
  - Symbols and lines: `nativeType` 22-27, 60.
  - Today: Test data for the lint.
  - Becomes: Unchanged.
- `skills/prisma-8/upgrading/app/upgrades/0.9-to-0.10/stamp-storage-types-kind.ts`
  - Symbols and lines: `nativeType` 21-26, 39-45, 56-60, 130-144, 162, 200-208.
  - Today: The earlier upgrade script; it reads and keeps `nativeType` in `storage.types` entries.
  - Becomes: Unchanged: it describes the 0.9 to 0.10 step. The new script runs after it in a multi-step upgrade.
- `skills/prisma-8/upgrading/extension/upgrades/0.9-to-0.10/stamp-storage-types-kind.ts`
  - Symbols and lines: `nativeType` 21-26, 39-45, 56-60, 130-144, 162, 200-208.
  - Today: Copy of the same script for extension authors.
  - Becomes: Unchanged.

## The schema IR

Package: `packages/2-sql/1-core/schema-ir`. The column node is `SqlColumnIR` (`src/ir/sql-column-ir.ts:100-197`).

### Fields today

| Field | Meaning | Set by `contractToSchemaIR` | Set by introspection | Read by |
| --- | --- | --- | --- | --- |
| `nativeType` | Type text without `[]`. On the contract side it already includes parameters (`character(36)`). | Yes (`packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:123, 132`) | Yes (Postgres `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:1052-1110`; SQLite `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:539`) | The fallback comparison (`sql-column-ir.ts:191-195`); Postgres type-change strategies (`planner-strategies.ts:266-267, 334`); `contract infer` (`infer-model-blocks.ts:233, 264, 376`; `infer-psl-contract.ts:144`); the schema view (`control-instance.ts:1110-1119`) |
| `resolvedNativeType` | The text both sides are compared by; `[]` appended for lists. | Yes (`contract-to-schema-ir.ts:124, 146`) | Yes (Postgres `control-adapter.ts:1091, 1114`; SQLite `control-adapter.ts:535, 542`) | `isEqualTo` (`sql-column-ir.ts:188-190`); `columnTypeChanged` in Postgres `issue-planner.ts:371-372`, SQLite `issue-planner.ts:117-118` and `operations/tables.ts:225-226`; passed to the default node as `nativeTypeContext` (`sql-column-ir.ts:157`) |
| `codecRef` | `{codecId, typeParams, many}` after `typeRef` is followed. Not enumerable. | Yes (`contract-to-schema-ir.ts:153, 164-181`) | No | DDL rendering only (Postgres `column-ddl-rendering.ts:44-71`, SQLite `column-ddl-rendering.ts:30-59`) |
| `codecBaseNativeType` | The stored name before parameters and `[]`. Not enumerable. | Yes (`contract-to-schema-ir.ts:154`) | No | DDL rendering only (same two files) |
| `codecNamedType` | True when the contract column used `typeRef`; makes Postgres quote the name. Not enumerable. | Yes (`contract-to-schema-ir.ts:155`) | No | Postgres `column-ddl-rendering.ts:69` |
| `many` | The column is a list. | Yes (`contract-to-schema-ir.ts:134`) | Yes (Postgres `control-adapter.ts:1081`); never on SQLite | Fallback comparison; DDL rendering |

The comparison is exact string equality of `resolvedNativeType` plus `nullable` (`sql-column-ir.ts:188-190`).

### What the IR must carry after the change

1. **The data type id and the parameters, on both sides.** `contractToSchemaIR` copies them from the column (after following `typeRef`). Introspection gets them from the family's resolver. Verify and the planners' `columnTypeChanged` compare id, parameters and `many` by exact equality (settled Q4).
2. **A missing id on the database side.** A reported type that no data type claims has no id. The node must be able to say so, keep the reported text for messages, and compare unequal to every contract column (settled Q4).
3. **A rendered name on the contract side**, produced by the family's render function from the id and parameters. `CREATE TABLE`, `ADD COLUMN`, `ALTER COLUMN TYPE`, `SET DEFAULT` casts and the schema view need it. It replaces `nativeType`, `resolvedNativeType` and `codecBaseNativeType`. It is never compared.
4. **The reported text on the database side**, kept for messages and for `contract infer`'s failure message, which must name the reported type.
5. **`codecRef` stays.** Lifecycle hooks (`planTypeOperations`, `resolveIdentityValue`) and default rendering are keyed by codec.
6. **`codecNamedType` is no longer needed for enums**, because `pg/enum` as the data type id says the name must be quoted. It is still needed for a `typeRef` column of another type only if Postgres must keep quoting those names; today `buildColumnTypeSql` quotes every `typeRef` name that has no parameters (`planner-ddl-builders.ts:93-96`). Keeping the rendered SQL identical means keeping that rule.

### `typeRef` columns and `storage.types` entries

A `typeRef` column stores its own copy of `codecId` and `nativeType` next to `typeRef`. For example, 118 Supabase columns are `{codecId: "pg/uuid@1", nativeType: "uuid", typeRef: …}` (counted over committed contracts). The validator only refuses `typeParams` together with `typeRef` (`packages/2-sql/1-core/contract/src/ir/storage-entry-schemas.ts:37-70`). So both the column and the `storage.types` entry it names replace `nativeType` with `dataType`, and the parameters stay on the entry.

Every reader follows `typeRef` to the entry's `{codecId, nativeType, typeParams}`: `contract-to-schema-ir.ts:185-214`, Postgres `planner-type-resolution.ts:5-23`, SQLite `planner-ddl-builders.ts:128-147`, Postgres `planner-identity-values.ts:15-18`. Each of them returns `dataType` instead.

`deriveAnnotations` builds a `storageTypes` annotation keyed by `nativeType` (`contract-to-schema-ir.ts:579-596`). It has no production reader and is deleted (decision 7).

## Migration operations: where a type name is stored

**Answer: yes, stored operations carry type names, but only inside rendered SQL text. They carry no `nativeType` field and no data type id.** No committed `ops.json` contains the string `nativeType`.

### What is written to disk

| File | What it holds | Example |
| --- | --- | --- |
| `ops.json` | A list of operations `{id, label, summary, operationClass, target, precheck[], execute[], postcheck[]}`. Each step is `{description, sql, params}`. Type names appear inside `sql`. | `examples/prisma-8-demo/migrations/app/20260422T0720_initial/ops.json`, operation `table.bug`: `"sql": "CREATE TABLE \"public\".\"bug\" (\n  \"id\" uuid NOT NULL,\n  \"severity\" text NOT NULL, …` |
| `migration.ts` | TypeScript that calls the operation functions. Column types are rendered text passed to `col(name, type, options)`. | `examples/prisma-8-demo/migrations/app/20260810T1108_add_post_engagement_counters/migration.ts:21`: `column: col('impressionCount', 'int8', { codecRef: { codecId: 'pg/int8@1' } })` |
| `migration.json` | `from`, `to`, `providedInvariants`, `createdAt`, `migrationHash`. No type names. | same directory |

Type texts used in the 79 committed `migration.ts` files: `text` (86), `uuid` (10), `character(36)` (10), `timestamptz` (5), `jsonb` (3), `geometry(Geometry,4326)` (3), `int8` (2), `bool` (2), `vector(1536)` (1), `numeric` (1), `int4` (1), `BIGSERIAL` (1).

### Operation kinds and their type-bearing fields

Postgres (`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`, methods in `postgres-migration.ts`):

| Operation | Field | Holds |
| --- | --- | --- |
| `createTable` (`CreateTableCall`, 232-239) | `columns: DdlColumn[]`, each with `type` | Rendered type text, from `renderColumnDdl` (`column-ddl-rendering.ts:79-92`) |
| `addColumn` (`AddColumnCall`, 370-376; `AddNotNullColumnDirectCall`, 744-751) | `column: DdlColumn` | Rendered type text, plus `codecRef` |
| `alterColumnType` (`AlterColumnTypeCall`, 482-497) | `options.qualifiedTargetType`, `options.formatTypeExpected`, `options.rawTargetTypeForLabel` | The type as written in `ALTER … TYPE`; the text `format_type` is expected to print; the text in the label. Written into `execute[].sql`, the postcheck's parameter and description, and `label` (`operations/columns.ts:66-113`) |
| `setDefault` (`SetDefaultCall`, 626-633) | `defaultSql` | A rendered `DEFAULT` clause, which can contain a `::<type>` cast |
| `AddNotNullColumnWithTempDefaultCall` (789-799) | `column: StorageColumn`, `storageTypes` | A contract column. It is planner-internal, is rendered as `rawSql(...)` in `migration.ts` (844-846), and is never stored as a column |
| `createNativeEnumType`, `dropNativeEnumType`, `addNativeEnumValue` (1519-1626) | `typeName` | The enum's type name |

SQLite (`packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts`):

| Operation | Field | Holds |
| --- | --- | --- |
| `createTable` (`CreateTableCall`, 132-136) | `columns: DdlColumn[]` | Rendered type text |
| `addColumn` (`AddColumnCall`, 341-346), `recreateTable` (`RecreateTableCall`, 265) | `SqliteColumnSpec.typeSql` (`operations/shared.ts:38-44`) | The upper-cased type token, for example `INTEGER` |

### Would stored operations change?

No, as long as decision 2 holds: a data type's name is the name contracts store today, so rendered DDL is byte-identical. Then every `ops.json` keeps its content, and every `migration.ts` keeps its `col(...)` calls.

Three things still change around them:

1. `migration.json`: `from`, `to` and `migrationHash` change, because the storage hashes change. See `upgrade-rewrite.md`.
2. `migration.ts`: the import paths `../../snapshots/<hash>/contract` change with the hashes (74 of the 79 committed files import a snapshot).
3. The `ALTER COLUMN TYPE` postcheck depends on `FORMAT_TYPE_DISPLAY`, which decision 7 deletes. No committed migration contains `alterColumnType`, so no stored file is affected, but newly planned operations must produce the same text. See DECISION NEEDED 5.

One statement in `design-notes.md` does not match the code: SQLite does not create `sql/char@1` columns as `CHARACTER(n)`. `buildColumnTypeSql` upper-cases the name and ignores parameters (`packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts:52-57`), so the column is created as `CHARACTER`.

## (a) JSON Schema files

- `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json`: a column declares `nativeType` (line 414) and requires `["codecId", "nativeType", "nullable"]` (line 509); a `storage.types` entry declares `nativeType` (line 738) and requires `["codecId", "kind", "nativeType"]` (line 746). Both become `dataType`.
- The file is generated. Command: `pnpm --filter @internal/sql-contract-ts schemas:generate` (`packages/2-sql/2-authoring/contract-ts/package.json:16`). The test `packages/2-sql/2-authoring/contract-ts/test/data-contract-json-schema.test.ts:17` fails when the committed file differs from the generated one.
- `packages/1-framework/0-foundation/contract/schemas/data-contract-document-v1.json` does not contain `nativeType`.

## (b) The emitter's `contract.d.ts` output

Source: `packages/2-sql/3-tooling/emitter/src/index.ts:683` (`storage.types` entry) and `:747` (column).

Before (`examples/prisma-8-demo/src/prisma/contract.d.ts:696-700` and `:956-961`):

```ts
readonly impressionCount: {
  readonly nativeType: 'int8';
  readonly codecId: 'pg/int8@1';
  readonly nullable: true;
};

readonly Embedding1536: {
  readonly kind: 'codec-instance';
  readonly codecId: 'pg/vector@1';
  readonly nativeType: 'vector';
  readonly typeParams: { readonly length: 1536 };
};
```

After:

```ts
readonly impressionCount: {
  readonly dataType: 'pg/int8';
  readonly codecId: 'pg/int8@1';
  readonly nullable: true;
};

readonly Embedding1536: {
  readonly kind: 'codec-instance';
  readonly codecId: 'pg/vector@1';
  readonly dataType: 'pgvector/vector';
  readonly typeParams: { readonly length: 1536 };
};
```

The same file also holds the three hashes as type literals (`contract.d.ts:42-46`: `StorageHashBase<'…'>`, `ExecutionHashBase<'…'>`, `ProfileHashBase<'…'>`). The storage hash literal changes. Nothing reads the column's `nativeType` at the type level (research section 4).

## (c) Documents that describe `nativeType` or the rendering hooks

The documents the brief names, with the section that must change:

| Document | Sections |
| --- | --- |
| `docs/architecture docs/adrs/ADR 171 - Parameterized native types in contracts.md` | "Context", "Decision", "Consequences", "Implementation Notes". The whole decision (`expandNativeType` hooks keyed by codec id) is replaced by ADR 254; mark it superseded. |
| `docs/architecture docs/adrs/ADR 186 - Codec-dispatched type rendering.md` | "Context" (line 64) and "`renderOutputType` on the Codec interface" (line 131): mentions only. |
| `docs/architecture docs/adrs/ADR 208 - Higher-order codecs for parameterized types.md` | "Decision" (lines 40, 52, 79, 111) and "1. Column authoring" (line 154): descriptor examples with `targetTypes` and `nativeType`. |
| `docs/architecture docs/adrs/ADR 205 - SQL cast emission is adapter policy.md` | Title paragraph, "TL;DR", "Decision", "Postgres inferrable set (v1)", "Worked example", "Lowering outcomes", "Codecs with no static `nativeType`", "Consequences", "Out of scope". It has the most hits (22 lines) and describes the runtime casts that change from `$1::integer` to `$1::int4`. |
| `docs/architecture docs/adrs/ADR 254 - Data types and casts.md` | Status paragraph (line 5), and "Columns and type constructors", which says a constructor "names a data type" (decision 5 amends it to "the data type follows from the codec"). |
| `docs/reference/codec-authoring-guide.md` | "At a glance", "Case 1", "Case 2", "Case 3", "PostgreSQL", "One source of target truth", "Target-owned Mongo codecs", "A codec whose data type depends on the target", "Reusing generic SQL descriptors in PostgreSQL". |
| `docs/architecture docs/subsystems/1. Data Contract.md` | "Structure & Content" (lines 152-164). |
| `docs/architecture docs/subsystems/2. Contract Emitter & Types.md` | "Example" (lines 105-119). |
| `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md` | "Schema-contributing extensions: contract spaces" (line 276). |
| `docs/architecture docs/subsystems/10. MongoDB Family.md` | "Schema validation ($jsonSchema)", "Execution pipeline", "`$jsonSchema` validator generation". |
| `docs/reference/error-reference.md` | "CONTRACT.PRINT_UNSUPPORTED", "CONTRACT.DEFAULT_INVALID", "CONTRACT.NATIVE_TYPE_INVALID". `pnpm check:error-reference` checks this file against the error codes. |
| Package READMEs | `packages/2-sql/1-core/contract/README.md` ("StorageColumn Structure", "Factories"); `packages/2-sql/1-core/schema-ir/README.md` ("Core Types", "Key Design Decisions", "Basic Usage"); `packages/2-sql/2-authoring/contract-ts/README.md` ("Callback Helper Vocabulary"); `packages/2-sql/4-lanes/relational-core/README.md` ("Codec authoring (class form)"); `packages/1-framework/1-core/framework-components/README.md` ("Higher-order codecs"); `packages/1-framework/3-tooling/cli/README.md` ("`prisma contract infer`", "Descriptor Declarative Fields"); `packages/1-framework/3-tooling/emitter/README.md` ("Test Utilities"); `packages/3-targets/6-adapters/postgres/README.md` ("Exports"); `test/utils/README.md` ("Operation Descriptors"). |
| `skills/` | `skills/prisma-8/references/contract.md` ("Workflow — Value objects (composite types)", line 283); `skills/prisma-8/references/migrations.md` ("Workflow — Author a migration by hand", line 362). |
| Rules | `.agents/rules/typed-contract-in-tests.mdc` ("Contract Type Definition"); `.agents/rules/prefer-assertions-over-defensive-checks.mdc`. `.agents/rules/no-family-vocabulary-in-framework.mdc` names the word as forbidden and does not change. |

Published upgrade guides under `skills/prisma-8/upgrading/**/upgrades/` and `upgrade-instructions/releases/` mention `nativeType` too. They describe past releases and do not change. `CHANGELOG.md`, `docs/releases/` and `projects/` are history and do not change.

The complete list, every document outside those history directories, with each section heading and the line numbers of the hits:

- `.agents/rules/no-family-vocabulary-in-framework.mdc`
  - ## How it is enforced (heading line 15; hits at 17)
  - ## Do (heading line 34; hits at 37)
- `.agents/rules/prefer-assertions-over-defensive-checks.mdc`
  - ## Test Cleanup (heading line 60; hits at 72)
  - ## Schema Validation Redundancy (heading line 78; hits at 87)
- `.agents/rules/typed-contract-in-tests.mdc`
  - ## Contract Type Definition (heading line 74; hits at 93)
- `docs/architecture docs/ADR-INDEX.md`
  - ## Contract & Schema (heading line 18; hits at 34)
- `docs/architecture docs/adrs/ADR 030 - Result decoding & codecs registry.md`
  - ## Registry model (heading line 58; hits at 64)
- `docs/architecture docs/adrs/ADR 155 - Driver Codec Boundary and Lowering Responsibilities.md`
  - ## Design constraints (the “why” behind the decision) (heading line 43; hits at 47)
  - #### Lowering (adapter responsibility) (heading line 130; hits at 143)
  - ### Compatibility enforcement happens during contract authoring (heading line 208; hits at 212,213)
  - ### Scenario (heading line 262; hits at 264)
- `docs/architecture docs/adrs/ADR 156 - Storage sets and check constraints.md`
  - ### A) Set + check constraint enforcement (heading line 63; hits at 79)
- `docs/architecture docs/adrs/ADR 157 - Execution enums.md`
  - #### Contract (simplified) (heading line 151; hits at 165,177)
  - #### Contract (simplified) (heading line 191; hits at 199,208)
- `docs/architecture docs/adrs/ADR 158 - Execution mutation defaults.md`
  - ### 3) Generator registry + compatibility validation (heading line 71; hits at 83)
  - ## Worked example (proposed contract shape) (heading line 123; hits at 143,144)
- `docs/architecture docs/adrs/ADR 167 - Typed default literal pipeline and extensibility.md`
  - ### Tagged type system (heading line 51; hits at 57)
  - ### 4. Consolidated bigint-like detection (heading line 129; hits at 131)
- `docs/architecture docs/adrs/ADR 171 - Parameterized native types in contracts.md`
  - ## Context (heading line 3; hits at 13)
  - ## Decision (heading line 15; hits at 17,20,23)
  - ## Consequences (heading line 31; hits at 35)
  - ## Implementation Notes (heading line 39; hits at 41,42,44)
- `docs/architecture docs/adrs/ADR 172 - Contract domain-storage separation.md`
  - ## At a glance (heading line 3; hits at 34,35,36)
  - ### Redundancy between levels (heading line 139; hits at 150)
- `docs/architecture docs/adrs/ADR 184 - Codec-owned value serialization.md`
  - ## At a glance (heading line 7; hits at 14)
  - ### Framework-level codec base interface (heading line 118; hits at 120)
- `docs/architecture docs/adrs/ADR 186 - Codec-dispatched type rendering.md`
  - ## Context (heading line 54; hits at 64)
  - ### `renderOutputType` on the Codec interface (heading line 107; hits at 131)
- `docs/architecture docs/adrs/ADR 202 - Codec trait system.md`
  - ### Trait declaration by adapters (heading line 62; hits at 70,81,89,97,110)
  - ### Replacing NumericNativeType (heading line 188; hits at 195)
  - ### Use native type names (current ORM approach) (heading line 274; hits at 276)
- `docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`
  - ### `Codec` interface shape (heading line 57; hits at 67)
  - ### `defineCodec()` / `mongoCodec()` factories (heading line 83; hits at 91,101)
- `docs/architecture docs/adrs/ADR 205 - SQL cast emission is adapter policy.md`
  - # ADR 205 — Postgres cast emission is adapter policy, codec metadata stays descriptive (heading line 1; hits at 3)
  - ## TL;DR (heading line 5; hits at 7)
  - ## Decision (heading line 51; hits at 55,57,59,60)
  - ### Postgres inferrable set (v1) (heading line 66; hits at 84)
  - ### Worked example (heading line 90; hits at 97,106,107,108,109,120)
  - ### Lowering outcomes (heading line 130; hits at 135)
  - ### Codecs with no static `nativeType` (heading line 140; hits at 140,142)
  - ## Consequences (heading line 144; hits at 148,149,156)
  - ## Alternatives considered (heading line 159; hits at 163)
  - ## Out of scope (heading line 169; hits at 172,173)
- `docs/architecture docs/adrs/ADR 207 - Codec call context per-query AbortSignal and column metadata.md`
  - ## Grounding example (heading line 9; hits at 52)
- `docs/architecture docs/adrs/ADR 208 - Higher-order codecs for parameterized types.md`
  - ## Decision (heading line 31; hits at 40,52,79,111)
  - ### 1. Column authoring (heading line 152; hits at 154)
- `docs/architecture docs/adrs/ADR 212 - Contract spaces.md`
  - ## Context (heading line 33; hits at 42)
  - ## IR vocabulary boundary (preserved) (heading line 284; hits at 286)
- `docs/architecture docs/adrs/ADR 213 - Codec lifecycle hooks.md`
  - ## Context (heading line 21; hits at 30)
  - ### Hook contract (heading line 36; hits at 52)
  - ### Worked example: cipherstash (heading line 123; hits at 127)
- `docs/architecture docs/adrs/ADR 224 - Control Policy — framework-locked vocabulary and family-owned dispatch.md`
  - ## At a glance (heading line 8; hits at 24,25)
  - ## Family-owned dispatch, target-supplied hooks (heading line 114; hits at 118)
- `docs/architecture docs/adrs/ADR 241 - Scalar types use the authoring type-constructor channel.md`
  - ## Grounding example (heading line 13; hits at 21,28,48)
  - ## Decision (heading line 56; hits at 62)
- `docs/architecture docs/adrs/ADR 246 - Option arguments and select templates for authoring helpers.md`
  - ## At a glance (heading line 3; hits at 42,48)
  - ## One preset per codec, named for the codec (heading line 169; hits at 179,183,187)
- `docs/architecture docs/adrs/ADR 254 - Data types and casts.md`
  - # ADR 254 — Data types and casts (heading line 1; hits at 5)
- `docs/architecture docs/subsystems/1. Data Contract.md`
  - ## Structure & Content (heading line 93; hits at 152,153,154,163,164)
- `docs/architecture docs/subsystems/10. MongoDB Family.md`
  - ### Schema validation ($jsonSchema) (heading line 169; hits at 175)
  - ## Execution pipeline (heading line 354; hits at 365)
  - ### `$jsonSchema` validator generation (heading line 453; hits at 455)
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
  - ### Example (heading line 20; hits at 105,106,107,108,117,118,119)
- `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md`
  - ## Schema-contributing extensions: contract spaces (heading line 274; hits at 276)
- `docs/reference/codec-authoring-guide.md`
  - ## At a glance (heading line 5; hits at 19)
  - ### Case 1 — Non-parameterized codec (`pg/text@1`) (heading line 49; hits at 82,91)
  - ### Case 2 — Parameterized codec with literal preservation (`pg/vector@1`) (heading line 108; hits at 132,141)
  - ### Case 3 — Parameterized codec with typed schema (`arktype/json@1`) (heading line 167; hits at 195,204)
  - ### PostgreSQL (heading line 246; hits at 258,269,277,290)
  - ### One source of target truth (heading line 383; hits at 385)
  - ## Target-owned Mongo codecs (heading line 389; hits at 420)
  - ### A codec whose data type depends on the target (heading line 525; hits at 533,546)
  - ## Reusing generic SQL descriptors in PostgreSQL (heading line 564; hits at 575,586,596)
- `docs/reference/error-reference.md`
  - ### CONTRACT.PRINT_UNSUPPORTED (heading line 292; hits at 297)
  - ### CONTRACT.DEFAULT_INVALID (heading line 382; hits at 384)
  - ### CONTRACT.NATIVE_TYPE_INVALID (heading line 514; hits at 516)
- `docs/reference/integer-representation-types.md`
  - ## Authoring (heading line 23; hits at 58)
- `drive/calibration/failure-modes.md`
  - ### F26. Review comment point-fixed; the defect class re-ships in new places next round (heading line 497; hits at 515)
- `drive/code/README.md`
  - ## Repo-specific smells to surface (heading line 9; hits at 27)
- `packages/1-framework/1-core/framework-components/README.md`
  - ## Higher-order codecs (`CodecDescriptor`, `CodecInstanceContext`) (heading line 69; hits at 77,79)
- `packages/1-framework/3-tooling/cli/README.md`
  - ### `prisma contract infer` (heading line 498; hits at 610)
  - ### Descriptor Declarative Fields (heading line 1367; hits at 1375)
- `packages/1-framework/3-tooling/emitter/README.md`
  - ## Test Utilities (heading line 171; hits at 183)
- `packages/2-sql/1-core/contract/README.md`
  - ## StorageColumn Structure (heading line 16; hits at 19,24)
  - ### Factories (heading line 133; hits at 140)
- `packages/2-sql/1-core/schema-ir/README.md`
  - ### Core Types (heading line 25; hits at 29)
  - ### Key Design Decisions (heading line 35; hits at 37)
  - ### Basic Usage (heading line 47; hits at 59,64)
- `packages/2-sql/2-authoring/contract-ts/README.md`
  - ### Callback Helper Vocabulary (heading line 114; hits at 124)
- `packages/2-sql/4-lanes/relational-core/README.md`
  - ### Codec authoring (class form) (heading line 94; hits at 124)
- `packages/3-targets/6-adapters/postgres/README.md`
  - ### Exports (`src/exports/`) (heading line 116; hits at 142)
- `skills/prisma-8/references/contract.md`
  - ## Workflow — Value objects (composite types) (heading line 264; hits at 283)
- `skills/prisma-8/references/migrations.md`
  - ## Workflow — Author a migration by hand (heading line 349; hits at 362)
- `test/utils/README.md`
  - ### Operation Descriptors (heading line 112; hits at 130)

## (d) Test files and fixtures affected, per package

Counts only. "Test code" is a TypeScript file under `test/` or named `*.test.ts` that contains one of the listed symbols. "JSON" is any JSON file that contains one (contracts, expected contracts, the JSON Schema). Totals: 547 test code files, 337 JSON files, 282 `contract.d.ts` files.

| Package | Test code | JSON | `contract.d.ts` |
| --- | --- | --- | --- |
| `apps/telemetry-backend` | 0 | 3 | 3 |
| `examples/bundle-size` | 0 | 1 | 1 |
| `examples/multi-extension-monorepo` | 0 | 5 | 5 |
| `examples/paradedb-demo` | 0 | 1 | 1 |
| `examples/prisma-8-cloudflare-worker` | 0 | 1 | 1 |
| `examples/prisma-8-demo` | 1 | 52 | 52 |
| `examples/prisma-8-demo-sqlite` | 0 | 1 | 1 |
| `examples/prisma-8-postgis-demo` | 0 | 3 | 3 |
| `examples/prisma7-adoption` | 0 | 2 | 2 |
| `examples/react-router-demo` | 0 | 1 | 1 |
| `examples/supabase` | 0 | 1 | 1 |
| `packages/1-framework/0-foundation/contract` | 4 | 0 | 0 |
| `packages/1-framework/1-core/framework-components` | 11 | 0 | 0 |
| `packages/1-framework/2-authoring/contract` | 2 | 0 | 0 |
| `packages/1-framework/2-authoring/ids` | 1 | 0 | 0 |
| `packages/1-framework/2-authoring/psl-parser` | 2 | 0 | 0 |
| `packages/1-framework/3-tooling/cli` | 3 | 0 | 0 |
| `packages/1-framework/3-tooling/emitter` | 7 | 0 | 0 |
| `packages/1-framework/3-tooling/language-server` | 3 | 0 | 0 |
| `packages/1-framework/3-tooling/migration` | 1 | 0 | 0 |
| `packages/2-mongo-family/2-authoring/contract-prisma6` | 1 | 0 | 0 |
| `packages/2-mongo-family/2-authoring/contract-psl` | 8 | 0 | 0 |
| `packages/2-mongo-family/2-authoring/contract-ts` | 5 | 0 | 0 |
| `packages/2-mongo-family/3-tooling/emitter` | 1 | 0 | 0 |
| `packages/2-mongo-family/9-family/test` | 1 | 0 | 0 |
| `packages/2-sql/1-core/contract` | 13 | 0 | 0 |
| `packages/2-sql/1-core/schema-ir` | 6 | 0 | 0 |
| `packages/2-sql/2-authoring/contract-prisma7` | 2 | 35 | 0 |
| `packages/2-sql/2-authoring/contract-psl` | 24 | 0 | 0 |
| `packages/2-sql/2-authoring/contract-ts` | 41 | 1 | 0 |
| `packages/2-sql/3-tooling/emitter` | 14 | 0 | 0 |
| `packages/2-sql/4-lanes/relational-core` | 12 | 0 | 0 |
| `packages/2-sql/4-lanes/sql-builder` | 10 | 1 | 1 |
| `packages/2-sql/5-runtime/test` | 32 | 0 | 0 |
| `packages/2-sql/9-family/test` | 24 | 0 | 0 |
| `packages/3-extensions/arktype-json` | 4 | 0 | 0 |
| `packages/3-extensions/mongo` | 4 | 0 | 0 |
| `packages/3-extensions/pgvector` | 14 | 2 | 2 |
| `packages/3-extensions/postgis` | 4 | 2 | 2 |
| `packages/3-extensions/postgres` | 19 | 1 | 1 |
| `packages/3-extensions/sql-orm-client` | 20 | 2 | 2 |
| `packages/3-extensions/sqlite` | 4 | 0 | 0 |
| `packages/3-extensions/supabase` | 9 | 4 | 4 |
| `packages/3-mongo-target/1-mongo-target/test` | 3 | 0 | 0 |
| `packages/3-mongo-target/2-mongo-adapter/test` | 1 | 0 | 0 |
| `packages/3-targets/3-targets/postgres` | 89 | 2 | 1 |
| `packages/3-targets/3-targets/sqlite` | 20 | 1 | 1 |
| `packages/3-targets/6-adapters/postgres` | 66 | 0 | 0 |
| `packages/3-targets/6-adapters/postgres-codec-testkit` | 5 | 0 | 0 |
| `packages/3-targets/6-adapters/sqlite` | 13 | 0 | 0 |
| `test/e2e` | 2 | 2 | 2 |
| `test/integration` | 40 | 213 | 195 |
| `test/utils` | 1 | 0 | 0 |

Commands that regenerate fixtures:

| Command | What it regenerates | Source |
| --- | --- | --- |
| `pnpm fixtures:emit` | Runs `emit` in every example, app, `@internal/sql-builder`, `@internal/sql-orm-client`, `@internal/postgres`, `@internal/extension-supabase`, `e2e-tests` and `integration-tests`; then `build:contract-space` in every extension; then `pnpm migrations:regen` and `pnpm migrations:regen:examples`. Needs a Postgres database at `DATABASE_URL`. | `package.json:59` |
| `pnpm fixtures:check` | `fixtures:emit`, then fails when `**/contract.*` or `**/expected.contract.json` differ from the commit. | `package.json:60` |
| `pnpm migrations:regen` | Extension packages: rewrites the head migration's `to`, re-emits `ops.json` and `migration.json`, re-pins `migrations/refs/head.json`, writes the snapshot. | `package.json:57`, `scripts/regen-extension-migrations.mjs:1-40` |
| `pnpm migrations:regen:examples` | Example migration chains: re-emits each migration's contract from its `contract.prisma`, writes snapshots, rewrites snapshot imports in `migration.ts`, re-runs `migration.ts`. It serialises the stored operations; it does not re-plan them. | `package.json:58`, `scripts/regen-example-migrations.mjs:1-40` |
| `pnpm --filter <example> emit` | One example's `contract.json` and `contract.d.ts`. | for example `examples/prisma-8-demo/package.json:10` |
| `pnpm --filter @internal/extension-supabase contract:generate` | The Supabase contract (`tsx scripts/generate-contract.ts`). | `packages/3-extensions/supabase/package.json:10` |
| `pnpm --filter @internal/sql-contract-ts schemas:generate` | The JSON Schema. | `packages/2-sql/2-authoring/contract-ts/package.json:16` |

Not regenerated by any command: the 35 `expected-contract.json` files under `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/`, the 16 `expected.contract.json` parity fixtures under `test/integration/test/authoring/parity/` (these are checked by `fixtures:check` but I did not find what writes them), and `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json`, which must stay in the old format because its test becomes "the old contract is refused" (settled Q1b).

## DECISION NEEDED

1. **What a TypeScript column descriptor carries.** `ColumnTypeDescriptor` requires `nativeType` (`packages/1-framework/1-core/framework-components/src/shared/column-spec.ts:20-23`). Users write `{ codecId: 'pg/text@1', nativeType: 'text' }` by hand (`examples/prisma-8-demo/prisma/contract.ts:12`). The contract builder's codec lookup is optional (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:835`). Recommended: the descriptor carries `codecId` and `typeParams` only, and the builder requires a codec lookup and writes the codec's `dataType`. Reason: decision 5 says the data type follows from the codec, and a second hand-written field could disagree with it. `GENERATED_CHAR_TYPE` (`packages/1-framework/2-authoring/ids/src/index.ts:10`) cannot name a data type in any case, because `sql/char@1` represents a different type on each target.
2. **The value-object check.** `validators.ts:711-721` requires `nativeType` `json` or `jsonb`. The builder hard-codes `pg/jsonb@1` for value objects on every target (`build-contract.ts:729-730, 848`). Recommended: the check compares the column's `dataType` with the data type of the codec the builder assigns to value objects, so the family names no target's type.
3. **Code that reads a type text to understand a default value.** `resolvedDefaultsEqual` (`packages/2-sql/1-core/schema-ir/src/ir/resolved-default-equality.ts:43-124`), `DefaultNormalizer` (`packages/2-sql/9-family/src/core/diff/sql-schema-diff.ts:16-19`), `parsePostgresDefault`, `parseSqliteDefault`. Recommended: they take the column's codec, as TML-3253 plans, and this project changes them only after TML-3253 lands. Reason: settled order against TML-3253.
4. **How the runtime reaches a SQL data type.** The runtime cast renderer has a codec descriptor, which names only a data type id (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts:110-123`). Data types are registered on control descriptors. Recommended: each target exports its SQL data types from an entry point the runtime plane may import, and the runtime stack holds them by id.
5. **The `ALTER COLUMN TYPE` postcheck.** It compares `format_type(...)` with a text from `FORMAT_TYPE_DISPLAY` (`planner-sql-checks.ts:22-33, 146-168`; `operations/columns.ts:86-93`). Decision 7 deletes the table. Recommended: a SQL data type marks which of its texts `format_type` prints, and the planner renders the postcheck text from that. Reason: the check is stored SQL in `ops.json` and runs without the framework, so it must compare text.
6. **SQLite: several data types are declared with the same text.** Committed contracts store `text` for `sqlite/text@1`, `sqlite/datetime@1` and `sqlite/json@1`, and `integer` for `sqlite/integer@1`, `sqlite/bigint@1` and `sqlite/bigintnumber@1`. Their data types are `sqlite/text`, `sqlite/datetime`, `sqlite/json`, `sqlite/integer`, `sqlite/bigint`. Settled Q4 and "Resolving a reported type" say exactly one data type may claim a text and assembly refuses two. On SQLite the database reports `text` for three data types, so the resolver cannot return one id and exact comparison cannot work. This contradicts the settled design and needs Will. Recommended: keep the stored names, and let a target declare that a group of its data types shares one database type, so that verify compares the shared type and parameters for that target. Reason: giving each type its own declared name (`DATETIME`, `JSON`, `BIGINT`) changes the DDL and makes every existing SQLite database report drift.
7. **Mongo data types with several BSON names.** `mongo/json@1` lists eight BSON type names and `mongo/bson@1` lists none (`packages/3-mongo-target/1-mongo-target/src/core/codecs.ts:315, 320`). Recommended: a Mongo data type holds a list of BSON type names, and the validator reads the list. Reason: decision 11 says the validator format must not change.
8. **Resolving an enum column.** The database reports the enum's own type name (`auth.aal_level`). No data type declaration contains that text. Recommended: introspection, which already reads the enum types, passes the set of enum type names to the family resolver, and the resolver returns `pg/enum` with `{typeName}` for them. Reason: the resolver must stay free of target tables, and the enum names are data, not a table.
9. **The id of the new SQLite data type** for `sql/char@1`. Settled Q4 gives its name (`character`) but not its id. Recommended: `sqlite/character`. The upgrade script's table depends on it. `sql/varchar@1` on SQLite stays `sqlite/text` unless a second type is wanted; no committed SQLite contract uses it.

## Statements in `design-notes.md` that the code contradicts

1. Settled Q4: "`sql/char@1` columns were created as `CHARACTER(n)`". SQLite renders `CHARACTER` without a length (`sqlite/src/core/migrations/planner-ddl-builders.ts:52-57`).
2. Settled Q4 and "Resolving a reported type": one data type per reported text. SQLite has three data types stored as `text` and two as `integer` (DECISION NEEDED 6).
3. Decision 11: "the eleven Mongo data types". There are twelve (`packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:9-20`).
4. Decision 7 names `normalizeFormattedType` and `FORMAT_TYPE_DISPLAY` only. A second normalising table, `normalizeSchemaNativeType` (`postgres/src/core/native-type-normalizer.ts:14-49`), does the same job and is exported from two packages.
5. Decision 7 names pack metadata `types.storage[].nativeType` as deleted. That metadata is also copied into every emitted `contract.json` under `extensions.<pack>.types.storage[]` (`packages/1-framework/3-tooling/cli/src/control-api/contract-enrichment.ts:30-57`), so the contract format changes in a second place. It is outside every hash.
6. Decision 3: "the contract validator's junction-column check compares `dataType` and parameters" without a stack. The new load-time check "each column's codec represents its `dataType`" needs a codec lookup, which `validators.ts` does not take today.
7. `research.md` section 7 places the Postgres scalar constructors only in the adapter. The Postgres target's `authoring.ts` now also holds field presets with 21 hard-coded names (lines 751-883).
