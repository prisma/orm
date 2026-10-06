# Research: what ADR 254's unbuilt half touches on `main`

Survey of `main` at `80ed61cb97` (2026-09-27), made before the spec. Every claim cites the file it came from. Paths are relative to the repository root.

## 1. What a data type is today

`DataType` has three fields: `id`, `casts`, and an optional `listCast` (`packages/1-framework/1-core/framework-components/src/shared/data-type.ts:40-50`). It has no database type name, no aliases, no parameters, and no rendering. `dataType()` only validates the `owner/name` id (`:58-86`). Assembly collects data types and refuses duplicates (`control/control-stack.ts:336-363`), then checks them against codecs and authoring entries in `enforceDataTypeInvariants` (`:418-498`).

Registered data types:

| Pack | Ids | Registered by |
| --- | --- | --- |
| Postgres | 26: `pg/text`, `text-array`, `enum`, `int2`, `bool`, `json`, `tsquery`, `int4`, `int8`, `numeric`, `float4`, `float8`, `jsonb`, `char`, `varchar`, `uuid`, `inet`, `bit`, `varbit`, `timetz`, `interval`, `bytea`, `date`, `time`, `timestamp`, `timestamptz` (`packages/3-targets/3-targets/postgres/src/core/data-types.ts:56-147`) | the **adapter** (`packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts:171`), although the codecs live in the target |
| SQLite | 7: `sqlite/text`, `json`, `integer`, `datetime`, `blob`, `bigint`, `real` (`packages/3-targets/3-targets/sqlite/src/core/data-types.ts:52-81`) | the adapter (`packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts:33`) |
| pgvector | `pgvector/vector`, list cast from `pg/int2`, `int4`, `int8`, `numeric` (`packages/3-extensions/pgvector/src/core/data-types.ts:31-38`) | the extension |
| postgis | `postgis/geometry`, cast from `pg/text` (`packages/3-extensions/postgis/src/core/data-types.ts:6-10`) | the extension |
| Mongo | 11, each `dataType(id, {})` with no casts: `mongo/objectid`, `string`, `double`, `int32`, `bool`, `date`, `vector`, `int64`, `decimal128`, `binary`, `json` (`packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:9-33`) | the target |

The shared `sql/*` codecs (`sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`) are templates that name no data type; each target adapts them (Postgres `packages/3-targets/3-targets/postgres/src/core/codecs.ts:324-352`, SQLite `packages/3-targets/3-targets/sqlite/src/core/codecs.ts:236-254`). `arktype/json@1` names `pg/jsonb` (`packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:220`).

## 2. The same database-type fact lives in several places

For a Postgres column, the name of its database type is written or computed in all of these places, and they do not agree on the name:

1. **Codec `targetTypes`** (`packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts:28-56`). Only `pg/numeric@1` has two entries (`['numeric','decimal']`, `postgres/src/core/codecs.ts:1005`); the second is never read in production. Several are empty: `pg/int8number@1` (`:799`), `pg/unboundedint@1` (`:1066`), the four temporal-string codecs, `pg/timestamptz-date@1`, `sqlite/bigintnumber@1`, `mongo/json@1`. Production readers: SQL and Mongo enum blocks take the enum's type name from `targetTypes[0]` (`packages/2-sql/9-family/src/core/authoring-entity-types.ts:31`), and Mongo's collection validator takes each field's BSON type from it (`packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts:19-21`). `byTargetType` in the codec registry is read only by tests (`packages/2-sql/4-lanes/relational-core/src/codec-descriptor-registry.ts:24-60`).
2. **Postgres codec `nativeType(params)`** hook (`postgres/src/core/codec-descriptor.ts:39-105`). It uses different names: `integer`, `smallint`, `bigint`, `real`, `double precision`, `boolean` (`codecs.ts:162-175`), and ignores parameters for every codec except enum. Its only production reader is the SQL renderer's parameter casts (`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts:60-123`). SQLite descriptors have no such hook.
3. **Rendering hooks** `controlPlaneHooks[codecId].expandNativeType` (ADR 171): Postgres `expandLength`, `expandPrecision`, `expandNumeric` (`postgres adapter descriptor-meta.ts:66-141`, registered `:201-223`), pgvector `vector(n)` (`pgvector/src/exports/control.ts:64-73`), postgis `geometry(Geometry,srid)` (`postgis/src/exports/control.ts:51-61`), arktype-json identity. SQLite has none.
4. **Type constructors' `output.nativeType`**, hard-coded strings (Postgres adapter `control-mutation-defaults.ts:148-360`; Postgres target `authoring.ts:105-133`; SQL family `authoring-type-constructors.ts:3-18`; SQLite adapter `control-mutation-defaults.ts:152-193`; pgvector and postgis `authoring.ts`). A comment at `postgres adapter control-mutation-defaults.ts:141-147` says they are "pinned to" `targetTypesFor`; they are literals.
5. **Pack metadata `types.storage[].nativeType`** (`postgres adapter descriptor-meta.ts:225-326`), turned into `typeMetadataRegistry` (`packages/2-sql/9-family/src/core/control-instance.ts:356-386`), which is passed only to SQLite's diff and never read there (`sqlite/src/core/migrations/diff-database-schema.ts:29`).
6. **The stored column** in `contract.json` (section 3).
7. **Hand-written inverse tables** in `contract infer`: `postgres-type-map.ts` (`POSTGRES_TO_PSL`, `PRESERVED_NATIVE_TYPES`, `PARAMETERIZED_NATIVE_TYPES`, `:3-54`) and `infer-default-codec.ts` (`CODEC_ID_BY_PRINTED_TYPE`, `:22-43`), which restates the adapter's constructor table; drift between them is caught only by `postgres adapter test/printed-type-codecs.test.ts:13-35`.
8. **Alias tables** in introspection: `normalizeFormattedType` maps `integer`→`int4`, `varchar`→`character varying`, `... with time zone`→`timestamptz`, and so on (`postgres adapter control-adapter.ts:1481-1531`); `FORMAT_TYPE_DISPLAY` maps the other way for the ALTER TYPE postcheck (`postgres/src/core/migrations/planner-sql-checks.ts:22-33, 146-169`).

Dead code found: `ControlAdapter.normalizeNativeType` is declared (`packages/2-sql/9-family/src/core/control-adapter.ts:187-192`) and set by both adapters but never called; `typeMetadataRegistry` is never read; `deriveAnnotations`' `storageTypes` (`contract-to-schema-ir.ts:579-596`) has no production reader; `contract-to-schema-ir.ts:101` cites a function that no longer exists.

## 3. The stored column and its hash

Shape: `StorageColumnInput` requires `nativeType: string`, `codecId`, `nullable`; optional `many`, `typeParams`, `typeRef`, `default`, `control`, `valueSet`, `noCheck` (`packages/2-sql/1-core/contract/src/ir/storage-column.ts:16-28`). The validator rejects unknown keys and refuses `typeParams` together with `typeRef` (`ir/storage-entry-schemas.ts:37-70`). Named `storage.types` entries are `{kind:'codec-instance', codecId, nativeType, typeParams}` (`ir/storage-type-instance.ts:20-25`).

`nativeType` always holds the bare name; parameters live only in `typeParams` (no committed `contract.json` has `(` or `[]` in `nativeType`). Examples:

- Parameterised: `{"codecId":"pg/numeric@1","nativeType":"numeric","typeParams":{"precision":10,"scale":2}}` (`test/e2e/framework/test/fixtures/generated/contract.json:951-957`).
- Enum: `codecId "pg/enum@1"`, `nativeType "storage.buckettype"`, `typeParams {"typeName":"storage.buckettype"}` (`packages/3-extensions/supabase/src/contract/contract.json:7896-7911`); the name is stored twice.
- List: `{"codecId":"pg/text@1","many":true,"nativeType":"text"}` (supabase `contract.json:7834-7842`).
- Two codecs of one type: `pg/int8@1` and `pg/int8number@1` both store `int8`; `pg/unboundedint@1` stores `numeric` (`examples/prisma-8-demo/src/prisma/contract.json:808-847`).

**Hash.** `computeStorageHash` hashes the whole storage subtree, so `nativeType` and `typeParams` are covered (`packages/1-framework/0-foundation/contract/src/hashing.ts:51-86`). The storage hash is:

- each migration's `from` and `to` in `migration.json`, and therefore its `migrationHash` (`packages/1-framework/3-tooling/migration/src/hash.ts:89-100`);
- the name of each `migrations/snapshots/<hash>/` directory;
- the database marker's `core_hash` and each ledger row's `origin_core_hash` and `destination_core_hash`, next to its `migration_hash` (`postgres adapter control-adapter.ts:143-145, 294, 360-379, 406, 434`).

Removing or changing `nativeType` in any column therefore changes the storage hash of that contract, every migration hash that touches it, snapshot directory names, and the hashes already written into users' databases.

**Counts.** 325 committed `contract.json` files, 281 with `nativeType`; 336 JSON files and 3047 occurrences in all, including 33 Prisma 7 `expected-contract.json` and 16 parity fixtures. 60 hash-named snapshot directories and 82 `migration.json` files. 283 committed `contract.d.ts` files carry `nativeType`. 853 TypeScript files mention it, 708 of them tests or fixtures.

**Old-format test.** `test/integration/test/contract-format/supabase-before-dbgenerated-removal.test.ts` loads a contract that carries `nativeType`; because the validator rejects unknown keys, removing the field from the schema fails it unless old contracts are accepted. Precedent for rewriting on-disk contracts: the `0.9-to-0.10` `stamp-storage-types-kind.ts` upgrade scripts in `packages/9-public/@prisma/orm-*/skills/`.

## 4. Who writes and who reads `nativeType`

**One write point.** Every SQL contract source goes through `buildSqlContractFromDefinition` (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:956`): PSL (`contract-psl/src/interpreter.ts:2756`), the TypeScript builder, and the Prisma 7 source (`contract-prisma7/src/interpreter.ts:439`). `buildStorageColumn` copies `descriptor.nativeType` (`build-contract.ts:710-756`); value objects are hard-coded to `jsonb` (`:610, 722`); `qualifyColumnDescriptor` schema-qualifies enum names (`:509-534`, `postgres/src/core/codecs.ts:538-551`). The strings come from type-constructor templates, the enum descriptor's `columnFromEntity` hook (`codecs.ts:501-506`), `targetTypes[0]` for enum blocks, and the TypeScript column helpers' descriptors (`packages/1-framework/1-core/framework-components/src/shared/column-spec.ts:20-78`; per-pack `column-types.ts`).

**Readers** (production):

| Reader | What it does | Could be derived from data type and parameters |
| --- | --- | --- |
| Contract validation (`packages/2-sql/1-core/contract/src/validators.ts:711-724, 948-959`) | value-object column must be `json`/`jsonb`; junction columns compare `nativeType` + `typeParams` | yes, but these validators take no codec lookup today |
| `convertColumn` (`packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:88-181`) | builds the schema IR the planner and verify use: expands parameters through the hook, appends `[]` | yes; this is the rendering ADR 254 assigns to the data type |
| `sameStorageColumn` (`field-event-planner.ts:197-205`) | decides whether a codec lifecycle event fires | yes |
| Postgres `buildColumnTypeSql` (`postgres/src/core/migrations/planner-ddl-builders.ts:52-140`) | `SERIAL`/`BIGSERIAL`/`SMALLSERIAL` by name, quoted enum names, parameter expansion, `typeRef` | yes |
| Postgres `renderDefaultLiteral` (`:166-209`), identity values (`planner-identity-values.ts:10-130`), ALTER TYPE postcheck (`planner-sql-checks.ts:146-169`) | branch on the type name | yes |
| SQLite `buildColumnTypeSql` (`sqlite/src/core/migrations/planner-ddl-builders.ts:52-58`) | upper-cases the stored name; ignores parameters | yes, with one catch below |
| Emitter (`packages/2-sql/3-tooling/emitter/src/index.ts:657-748`) | writes `readonly nativeType` into `contract.d.ts` | nothing reads it at the type level |
| Prisma 7 binding (`postgres/src/core/prisma7-binding.ts:59-87`) | branches on the resolved name for `literalDefaultForm` | yes |
| Runtime, ORM client, query lanes | **never read the stored `nativeType`**; parameter casts use the codec hook | n/a |
| `contract infer` | reads the introspected name, not the contract | unaffected by storage; its inverse tables should come from data types |

**SQLite catch.** `sql/char@1` on SQLite represents `sqlite/text` (`sqlite/src/core/codecs.ts:236-244`), but `examples/prisma-8-demo-sqlite/src/prisma/contract.json` stores `character`. A name derived from the data type renders `TEXT`, so live SQLite databases created with `CHARACTER` would show drift unless verify accepts `character` as a name for `sqlite/text`.

## 5. Parameters

| Type | Parameter schema | Rendering | PSL constructor |
| --- | --- | --- | --- |
| numeric | `{precision?: 1..1000, scale?: ≥0}` (`postgres codecs.ts:151-160`) | `numeric(p,s)`, refuses scale without precision (`postgres adapter descriptor-meta.ts:96-136`) | `Numeric(p, s)` |
| char, varchar, bit, varbit | `length?: int > 0` (`relational-core/src/ast/sql-codecs.ts:47-50`) | `expandLength` | `Char`, `VarChar`, `sql.String`; **none for bit, varbit** |
| timestamp, timestamptz, time, timetz, interval | `precision?: 0..6` (`postgres codec-helpers.ts:17-21`) | `expandPrecision`, which accepts any non-negative integer | yes; **none for interval** |
| vector | `length`: 1..16000, required (`pgvector/src/core/codecs.ts:37-50`) | `vector(N)` | `pgvector.Vector(N)` |
| geometry | `srid?` (`postgis/src/core/codecs.ts:58-70`) | `geometry(Geometry,srid)`; subtype hard-coded | `postgis.Geometry(srid)` |
| enum | `{typeName}` (`postgres codecs.ts:447-481`) | quoted, schema-qualified name | `pg.enum(Ref)` |
| arktype/json | `{expression, jsonIr}` (`arktype-json-codec.ts:207-210`): **a codec parameter, not a database one**; the column is plain `jsonb` | identity | TypeScript only |
| mongo/vector | `length`, TypeScript only; read only for the TypeScript output type (`mongo codecs.ts:206-222`) | none | none |

Parameters are validated in three places with different bounds: `validateCodecTypeParams` via `materializeCodec` (`framework-components/src/shared/resolve-codec.ts:49-101`), the PSL constructor argument checks (`framework-authoring.ts:1659-1770`), and the `expand*` hooks. Introspection keeps parameters inside the type string; only `contract infer` parses them back, with a regex that covers varchar, char, numeric, decimal and four temporal types (`postgres/src/core/psl-infer/postgres-type-map.ts:42-96`).

## 6. Verify and introspection compare strings

Postgres introspection normalises `format_type` output to one name per type (`control-adapter.ts:1481-1531`, `postgres/src/core/native-type-normalizer.ts:14-49`); SQLite only trims and lower-cases (`sqlite adapter control-adapter.ts:516-541`). The expected side is `expandNativeType(nativeType, typeParams)` plus `[]` with no normalisation (`contract-to-schema-ir.ts:88-150`), and the comparison is **exact string equality** (`packages/2-sql/1-core/schema-ir/src/ir/sql-column-ir.ts:182-195`; also `postgres issue-planner.ts:371-372`, `sqlite issue-planner.ts:117-118`, `sqlite operations/tables.ts:225-226`). A contract that says `decimal`, `integer` or `varchar` would report drift. Read from the code, not run: the ALTER TYPE postcheck would compare `timestamptz(3)` with `format_type`'s `timestamp(3) with time zone` and fail.

## 7. Type constructors

Shape: `{kind:'typeConstructor', documentation?, args?, output: {codecId, nativeType?, typeParams?}, entityRefArg?, deprecated?}` (`framework-authoring.ts:90-135`). **A constructor names a codec and a type name, never a data type.** `instantiateAuthoringTypeConstructor` (`:1909-1918`) fills the template.

Contributors: the Postgres adapter owns the main table (`String`, `Boolean`, `Int`, `BigInt`, `Float`, `Decimal`, `DateTime`, `Json`, `Jsonb`, `Bytes`, and `VarChar`, `Char`, `Numeric`, `Timestamp`, `Timestamptz`, `Time`, `Timetz`, `Uuid`, `Inet`, `SmallInt`, `Real`, `Date` with `*String`/`*JsDate` variants; `control-mutation-defaults.ts:148-360`); the Postgres target adds `BigIntNumber`, `UnboundedInt`, `pg.enum` (`authoring.ts:105-133`); the SQL family adds `sql.String(length)`; pgvector `pgvector.Vector(length)`; postgis `postgis.Geometry(srid)`; SQLite adapter scalars and target `BigIntNumber`; Mongo adapter ten zero-argument constructors plus deprecated `Int`, `Float`, `Boolean`, `DateTime` (`packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts:33-111`). No `pg.timestamp(3)` or `sql.char(32)` exists. Bare scalars are derived: every top-level constructor with only optional arguments (`collectScalarTypeConstructors`, `framework-authoring.ts:1078-1089`).

Resolution (`packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts:403-549`): a field preset wins over a constructor of the same call; entity-ref constructors go through the codec's `columnFromEntity`; bare names look in named types, then enums, then scalars. Enum blocks take their codec from `@@type` and their type name from `targetTypes[0]`; no constructor is involved.

**Assembly does not check constructors against data types or codecs.** ADR 254 rule 1 ("a codec or a type constructor names a data type that is not registered") has only its codec half built: constructors carry no data type, `enforceDataTypeInvariants` receives none (`control-stack.ts:821-838`), and `validateScalarTypeCodecIds` (`:686-699`) is called only from tests.

`types { X = ... }` aliases resolve in `psl-named-type-resolution.ts:81-205` and lower to `storage.types[X] = {kind:'codec-instance', codecId, nativeType, typeParams}`, with columns carrying `typeRef` (`build-contract.ts:746-756`). Field presets (`temporal.*`, `id.*`, `uuidString`, …) hard-code codec and type name per preset and do not reference constructors (`postgres/src/core/authoring.ts:857-1005`, `packages/2-sql/9-family/src/core/authoring-field-presets.ts`, `framework-components/src/shared/temporal-presets.ts:37-114`). TypeScript column helpers are hand-written per codec (`postgres adapter src/exports/column-types.ts`, `sqlite adapter src/core/column-types.ts`, pgvector, postgis), and the composed `type.*` helpers cannot reach adapter-owned constructors (`contract-ts/src/composed-authoring-helpers.ts:243-251`).

`contract infer` maps an introspected name to a PSL name through the hand tables in section 2 item 7: `numeric` always prints `Numeric`, `timestamptz` always `Timestamptz`, and `vector`/`geometry` fall to `Unsupported("…")` (`infer-model-blocks.ts:235-249`). The Prisma 7 source maps Prisma 7 names onto Prisma 8 constructors (`postgres/src/core/prisma7-type-map.ts:10-44`) and resolves them through the same constructor registry. The language server offers bare scalar names in type position only; no namespaced or required-argument constructors, and no hover provider (`packages/1-framework/3-tooling/language-server/src/completion-provider.ts:551-581`).

## 8. Function arguments and other value positions

**No function argument goes through a data type or a cast.** Default functions (identical copies in `postgres adapter control-mutation-defaults.ts:37-138` and `sqlite adapter control-mutation-defaults.ts:88-142`):

| Function | Parameters today | Check |
| --- | --- | --- |
| `autoincrement`, `now`, `ulid` | none | — |
| `uuid` | `version: optional(oneOf(num(4), num(7)))` | strict equality |
| `cuid` | `version: num(2)`, required | strict equality; lowering ignores it |
| `nanoid` | `size: optional(int({min:2, max:255}))` | `Number(...)` then integer and range |

The range 2..255 is written three times: the PSL signature, the TypeScript helper (`packages/1-framework/2-authoring/ids/src/index.ts:28-41`), and the field preset (`authoring-field-presets.ts:27-39`). Every leaf failure is `PSL_INVALID_ATTRIBUTE_SYNTAX`, and the outer `oneOf` of `@default` replaces the specific message with "Expected one of: …" (`psl-parser/src/attribute-spec/combinators/one-of.ts:31-39`). The Prisma 7 source bypasses the signatures entirely: it maps positional arguments by hand and calls `entry.lower` directly, so `nanoid(1000)` and `uuid(5)` pass (`contract-prisma7/src/defaults.ts:67-75, 330-395`).

Three argument systems exist:

1. Attribute-spec combinators (ADR 231, `psl-parser/src/attribute-spec/`): value leaves `str`, `num`, `numLiteral`, `int`, `bool`, `taggedLiteral`, `json`; structural `identifier`, `fieldRef`, `referencedFieldRef`, `entityRef`, `list`, `record`, `oneOf`, `funcCall`, `optional`. No combinator names a data type; there is no `dataTypeValue` on `main`.
2. `AuthoringArgumentDescriptor` for type-constructor and field-preset arguments (`framework-authoring.ts:67-88`), parsed from raw text (`psl-parser/src/authoring-arguments.ts:316-470`) and checked by `validateAuthoringArgument` (`framework-authoring.ts:1659-1773`).
3. `PslBlockParam` for extension blocks (`framework-components/src/shared/psl-extension-block.ts:154-185`), whose codec-based validator is reached only from tests.

Other value positions that hold database values but are not typed: `@@base(Model, "value")` discriminator values (`sql-attribute-specs.ts:641-657`, only a duplicate check); enum block member values, read by `JSON.parse` then `codec.decodeJson` (`packages/2-sql/9-family/src/core/authoring-entity-types.ts:57-100`, same in Mongo), which is the "codec reads schema text" pattern ADR 254 retires; policy `permissive`, declared `pg/bool@1` but checked by hand (`postgres/src/core/authoring.ts:291-297, 553-558`).

The binder from #30349 (`packages/1-framework/2-authoring/psl-parser/src/binder.ts:156-405`) binds declarations, field types, attribute names and reference-kind arguments only; it does not descend into `funcCall` signatures, does not validate values, and the language server does not use it. #30381 (block specs sharing a typed expression grammar) is open.

## 9. Mongo

Mongo fields store only `codecId` (and `typeParams`), never a type name (`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts:7-62`). The BSON type name comes from `targetTypes[0]` and is copied into the collection validator's `$jsonSchema` (`derive-json-schema.ts:15-56`), which the planner and verify compare as opaque JSON (`mongo-planner.ts:62-130`, `9-family/src/core/schema-diff.ts:231-235`). The ten constructors are zero-argument and map one-to-one onto data types; each requires a `nativeType` string that is thrown away (`framework-authoring.ts:1144-1147`; `contract-psl/src/interpreter.ts:1092-1095`). Mongo has no `@default`, no default functions and no function arguments. The Prisma 6 source maps scalar names straight to codec ids (`packages/3-mongo-target/1-mongo-target/src/core/prisma6-binding.ts:22-38`). `vector` is probably not a valid `$jsonSchema` `bsonType` (from MongoDB's documentation, not this repository); it never reaches a validator today.

## 10. Related work in flight

- **SQL expression literals** (Linear project P-TML-1144). TML-3296 gives the `sql` tag the data type `sql/expression` and removes the "lowering entry" kind and `pg.sql`/`sqlite.sql`. TML-3288 adds a `dataTypeValue` argument building block that applies the cast rule when an attribute argument is parsed, for index, CHECK and policy positions. On hold until #30381 merges. Its design lives in another worktree and is not on `main`.
- **TML-3055** (PSL mixins; retire field presets and `types {}` aliases; "type constructors carry storage"). Not started.
- **TML-3283** (should a data type write its values into migration SQL). Backlog.
- **ADR 171** is today's rendering mechanism (`expandNativeType` hooks keyed by codec id). ADR 186 covers TypeScript output types only. ADR 208 moved parameters and `factory(params)` onto codec descriptors. The codec authoring guide says the descriptor is "the only place" a target declares codec behaviour (`docs/reference/codec-authoring-guide.md:383-385`), which the parallel tables in section 2 contradict.
- The repository forbids family vocabulary (`nativeType`, `table`, `column`, dialect names) in `packages/1-framework` (`.agents/rules/no-family-vocabulary-in-framework.mdc`, ratchet `pnpm lint:framework-vocabulary`). A data type's SQL name, aliases and rendering therefore cannot be fields of the framework `DataType`.
