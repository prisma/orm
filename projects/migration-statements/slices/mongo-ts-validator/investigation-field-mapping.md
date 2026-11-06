# Investigation: MongoDB domain field names and `model.storage.fields`

Branch `tml-3553-ts-validator-pr2`, 2026-10-19. Read-only; every claim comes from reading code. Context: ADR 172 and ADR 182 separate a model's domain fields from its storage bridge. SQL records `model.storage.fields: { <field>: { column } }`. MongoDB keys `model.fields` by the stored key instead (TML-3247). Will decided on 2026-10-19 that MongoDB follows the design: domain fields keep their own names, and `model.storage.fields: { <field>: { field: <stored key> } }` records the stored key.

## Summary

- Today a MongoDB contract keys `model.fields` by the stored key: the PSL interpreter, the Prisma 6 reader, and the TypeScript builder (where the field name simply is the stored key).
- Every reader assumes domain name equals stored key: the ORM, the pipeline builder, runtime decoding, validator derivation, the refusals, relation checks and the statement planner.
- The storage hash covers only `contract.storage`, not `model.storage` (`packages/1-framework/0-foundation/contract/src/hashing.ts:51-75`). Validators, indexes and PSL execution default refs already use stored keys. So moving PSL domain keys from `_id` to `id` changes no storage hash and no execution hash, and needs no database migration. It still breaks app code: every PSL MongoDB app from the `prisma init` template reads `user._id` today (`packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts:126,209,218`).
- Biggest risks: the ORM read path (decoding copies keys verbatim and passes unknown keys through), and the pipeline builder (shape typed from domain fields, but `$<name>` paths emitted verbatim).

## 1. Contract shape

### Today

- `MongoModelStorage`: `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts:37-40`, `{ collection?: string; relations?: Record<string, { field: string }> }`. No `fields`.
- Arktype `ModelStorageSchema`: `mongo-contract/src/contract-schema.ts:232-236`, `'+': 'reject'`, so a `fields` key is refused today.
- `StorageRelationEntrySchema` (`contract-schema.ts:96-99`) is `{ field: string }`, the existing MongoDB bridge vocabulary for embed relations (ADR 177; `docs/architecture docs/subsystems/10. MongoDB Family.md:74,108`). `storage.fields.<f>.field` matches it.
- Value objects have no storage block (`contract-schema.ts:449-451`).
- `contract.d.ts` model storage type: `mongoEmission.generateModelStorageType` (`packages/2-mongo-family/3-tooling/emitter/src/index.ts:67-87`) emits `collection` and `relations` only.
- `resolveFieldValueSet` (`emitter/src/index.ts:89-108`) reads `model.fields[fieldName]`, a domain key; correct after the change.

### SQL to mirror

- Types: `packages/2-sql/1-core/contract/src/types.ts:73-83`, `SqlModelFieldStorage = { column; codecId?; nullable? }`, `SqlModelStorage = { table; namespaceId; fields }`.
- Schema: `packages/2-sql/1-core/contract/src/validators.ts:429-439`.
- Consistency check: `validateModelStorageReferences` (`validators.ts:817-866`): every domain field has a `storage.fields` entry (total), every `column` exists. MongoDB's equivalent goes in `validateMongoStorage` (`mongo-contract/src/validate-storage.ts:54`).
- Emitter: `packages/2-sql/3-tooling/emitter/src/index.ts:149-169`, `readonly fields: { <f>: { readonly column: "<c>" } }`.

### Schema version

- `schemaVersion` is the constant `'1'` (`packages/1-framework/3-tooling/emitter/src/emit.ts:11`, `hashing.ts:14`) and has never been bumped. Shape changes ship as re-emission plus upgrade instructions (for example `upgrade-instructions/releases/8.0.0-rc.14-to-8.0.0-rc.15`, `data-type-in-contract`).

### Total or sparse

- Total mirrors SQL: every field has an entry; readers need no fallback. Changes every MongoDB `contract.json` (67 tracked) and `contract.d.ts`; rc contracts lack the entries.
- Sparse: only mapped fields; readers default to the field's own name.

## 2. Authoring

### PSL interpreter (`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`)

- `@map` resolved in `resolvePhysicalNames` (`:250-292`), accessor `physicalName` (`:295`); spec at `mongo-attribute-specs.ts:174-177`.
- Domain fields keyed by stored name at `:1607-1609`.
- Index keys use stored names (`:774`, `:777`, `:996`); storage, so this stays.
- Relation `on.localFields`/`targetFields` mapped to stored names at `:1569-1584` (and swapped at `pair-back-relations.ts:105`); should become domain names.
- Discriminator field mapped to the stored name at `:459-460`, stored at `:499`; should become the domain name. Variant index scoping (`:559-565`) needs the stored key.
- Execution default refs use `storedField: mappedName` (`:1614`, ref at `:1126`); stay stored, as SQL refs name the column.
- Refusal-to-diagnostic lookup (`:1258-1311`) uses `fieldKey(owner, storedName)` and a literal `'_id'` (`:1309`).
- Value-object fields keyed by `field.name` (`:1662-1677`); `@map` there appears silently ignored (binder `packages/1-framework/2-authoring/psl-parser/src/binder.ts:470-492`). The Prisma 6 reader refuses it (`contract-prisma6/src/interpreter.ts:803-807`).
- PSL MongoDB has no embedded models.

### Prisma 6 reader (`packages/2-mongo-family/2-authoring/contract-prisma6/src/interpreter.ts`)

- `storedName` from `@map` at `:988-996`, recorded at `:1027`; fields keyed by it at `:1057`, `:1098`; execution defaults `:1099`; relations `:1341-1342`; indexes `:1401`, `:1420`; `_id` check `:1039-1046`. 14 expected fixtures, all with `"_id"`.

### TypeScript builder (`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts`)

- No mapping option; `buildFields` keys by record key (`:1938-1946`).
- `storageRelations` (`:1735`) copied to `storage.relations` (`:2065`).
- Index fields checked against field names (`findMissingIndexField`, `:2184-2198`) and copied verbatim (`toStorageIndex`, `:2145`); need translating to stored keys.
- Discriminator copied verbatim (`:1811-1816`), used for index scope (`resolveVariantScope`, `:2200-2211`).
- Relation `from`/`to` verbatim (`:1476-1514`, `:1593`).
- Execution default ref `field: fieldName` (`:2491`) must become the stored key.

### SQL TypeScript option to mirror

- `ScalarFieldBuilder.column(name)` (`packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts:357-410`) and `.sql({ column })` (`contract-dsl.ts:149`, `:571-600`) set `state.columnName`. Lowering builds `fieldToColumn` (`contract-lowering.ts:1078-1094`, `describe-model.ts:55-60`), maps index/unique/FK lists with `mapFieldNamesToColumnNames`, and refuses two fields on one column (`CONTRACT.NAME_DUPLICATE`, `contract-lowering.ts:1083-1090`).

## 3. Readers that must translate domain name to stored key

### ORM (`packages/2-mongo-family/5-query-builders/orm/src`)

- `where({...})`: `collection.ts:891-901`.
- Raw `MongoFilterExpr`: `collection.ts:319-326`; `#fieldAtPath` (`:934-944`).
- `select`: `collection.ts:337-341`; projection `compile.ts:95-107` adds `_id: 0` unless `_id` is selected.
- `orderBy`: `collection.ts:403-408`.
- `include` / `$lookup`: `collection.ts:368-393`, `compile.ts:41-60`.
- Writes: `#toDocument` (`:1087-1096`), `#toSetFields` (`:1098-1111`), `#wrapValueObject` (`:1072-1085`), field-accessor ops (`field-accessor.ts:269-310`, `:328`), upsert pipeline (`upsert-pipeline.ts:18-20`, `:46-143`).
- Discriminator: `variant()` (`collection.ts:315`), `#injectDiscriminator` (`:1279-1280`).
- `_id` paths: immutability checks (`:671-675`, `:1102-1105`, `:1173-1177`) must compare the stored key; id prefetch and `$in` re-read (`:577`, `:762`, `:780`) stay stored; `#idFieldShape` (`:851-856`) reads `model.fields['_id']`.
- `create()` results: `#insertOneResultShape`, `#documentShape` (`:858-887`) decode a stored-keyed document through the domain shape.
- Execution defaults: `#appliedDefaults` (`:1113-1127`). SQL applies defaults to the storage row after mapping (`packages/3-extensions/sql-orm-client/src/mutation-executor.ts:358-369`, `collection.ts:207-238`).
- Row types (`types.ts`) are domain-keyed; correct after the change.

### Query builder (`packages/2-mongo-family/5-query-builders/query-builder/src`)

- `ModelNestedShape` / `ModelToDocShape` (`resolve-path.ts:177-185`) typed from `model.fields`; field accessor (`field-accessor.ts:276-301`) emits `$<property>` verbatim; `_id` special cases at `builder.ts:334`, `pipeline-result-shape.ts:51-53`.
- `contractModelToMongoResultShape` (`result-shape.ts:72-97`), used by the ORM (`compile.ts:113`) and `builder.ts:841`.
- The pipeline builder works on raw documents (`group`, `project`, `$lookup`, `lookup-builder.ts`).

### Runtime decoding

- `decodeMongoRow` (`packages/2-mongo-family/7-runtime/src/codecs/decoding.ts:208-224`) reads and writes the same key and copies unshaped keys through.

### Validator derivation and refusals (`mongo-contract/src`)

- `propertiesOf` keys `properties`/`required` by field name (`derive-json-schema.ts:177-200`), keys embeds by relation name (`:194-197`) and ignores `storage.relations.<rel>.field`.
- `_id` auto-add (`:202-221`); discriminator in polymorphic schemas (`:243-268`, `:295-304`).
- `documentIdRefusals` reads `model.fields['_id']` (`contract-refusals.ts:137-146`); `fieldRefusals` reports by field name (`:121-131`).
- `resolveMongoToOneRelationFields` (`relation-fields.ts:15-33`) treats a local field named `_id` as the id; called from `validate-storage.ts:162` and `9-family/src/core/ir/mongo-contract-serializer-base.ts:51`.
- `validate-storage.ts:105-116` checks join fields against `model.fields` (domain); `:8-35` checks `_id` in validators (storage).

### Schema IR, verify, introspection

- `contractToMongoSchemaIR`, `schema-diff.ts`, `schema-verify/*`, `schema-to-view.ts`, `packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts` read only storage or the live database; no change while validators keep stored keys.

### Migration planner (`packages/3-mongo-target/1-mongo-target/src/core/migrations/mongo-statement-planning.ts`)

- Statements name contract keys; `docs/architecture docs/subsystems/7. Migration System.md:212` says `id @map("_id")` is `User._id` in a statement.
- `variantFilter` (`:66-78`) needs the stored discriminator key; `storedField` (`:106-113`); `otherRootModelsStoring` (`:160-176`) must compare stored keys.
- `planFieldRename` (`:386-468`) uses statement fields as stored keys; mirror SQL `fieldRenameStorageEffect`.
- `storedFieldsOf` (`:557-567`), `rootDocumentsLosing` (`:574-594`), `planFieldRemovals` (`:602-640`) use domain keys as stored keys; the data-loss subject (`:634`) stays the domain field.
- `planValidatorFieldRemovals` (`:646-668`), dry-run labels (`mongo-planner.ts:83-100`), `operation-storage-name.ts`, `field-rewrite.ts` are storage-only.

### Other readers

- Runtime `applyMutationDefaults` (`packages/1-framework/1-core/framework-components/src/execution/mutation-defaults.ts:151`) matches `ref.field` to value keys.
- Enums and value sets are keyed by enum name; unaffected. MongoDB has no `contract infer`.
- Language server rename (`packages/1-framework/3-tooling/language-server/src/rename.ts:125-163`) adds `@map("<old>")`; becomes correct for MongoDB after the change.

## 4. How SQL translates

- Contract accessors in `packages/3-extensions/sql-orm-client/src/collection-contract.ts`: `getOwnFieldColumns` (`:176-189`), `getModelFields` (`:194-216`), `getModelFieldColumns` (`:219-231`), variant maps (`:237-291`), inverse maps (`:296-315`), `columnOfCallerField` (`:324-336`, `ORM.FIELD_UNKNOWN`), `callerFieldUnknown` (`:341-369`), `columnOfContractField` (`:408-420`), `fieldOfColumn` (`:425-435`).
- Row mapping: `mapStorageRowToModelFields`, `createStorageRowMapper` (`collection-runtime.ts:59-75`), `mapModelDataToStorageRow` (`:228-243`).
- Migrations: `fieldColumn`, `fieldRenameStorageEffect` (`packages/2-sql/9-family/src/core/migrations/statement-planning.ts:119-145`), `fieldOfColumn` (`field-of-column.ts:9-37`).
- Authoring: `fieldToColumn`, `mapFieldNamesToColumnNames` (`contract-lowering.ts`).

## 5. Users affected

- Every PSL MongoDB app from `prisma init` (`id ObjectId @id @map("_id")`): ORM code reading or filtering `_id` switches to `id`. No migration needed; an app upgrade fragment is.
- 87 MongoDB `.prisma` files use field `@map` (191 of them `@map("_id")`): `examples/mongo-demo`, `examples/retail-store`, `examples/mongo-blog-leaderboard`, `test/integration/test/mongo/*`, side-by-side, LSP parity, enum-member fixtures, about 30 Prisma port fixtures, CLI journey fixtures, 41 Prisma 6 reader fixtures.
- 67 tracked MongoDB `contract.json` and about 50 `contract.d.ts`.
- About 140 `_id` uses in `examples/` app code; up to 69 MongoDB test files touch `_id`.
- Docs and skills teaching `_id`: `skills/prisma-8/references/queries-mongo.md` and its copy in `packages/9-public/@prisma/orm-mongo/skills/`, `packages/1-framework/3-tooling/cli/src/commands/init/templates/quick-reference-mongo.md:25`, `7. Migration System.md:212`, `10. MongoDB Family.md:186,261`, ADR 172 (`:5,134,157,174`, "MongoDB has no field indirection"), ADR 182 (`:130-142`), `contract-ts/README.md`, the pending TypeScript validator upgrade note.

## 6. Size and risks

- About 11 packages: `mongo-contract`, `contract-psl`, `contract-prisma6`, `contract-ts`, the MongoDB emitter, `mongo-query-ast`, `query-builder`, `orm`, `7-runtime`, `9-family`, `1-mongo-target`. About 25–30 source files, 100+ test files, re-emitted fixtures, about 10 docs.
- Risky: the ORM read path; the pipeline builder's shape; execution defaults against encoding in writes and upserts; rc contracts without `storage.fields`; embed relation storage names, which are written but never read.
- Open: total or sparse; raw filter paths; `@map` on value-object fields; whether an `@map`-only change plans a rename; the TypeScript option name; whether `discriminator.field` and `on.*Fields` hold domain names (SQL does).
