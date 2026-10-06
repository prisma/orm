# Inventory: everything that names a column type

Made on 2026-09-29 for planning pull request #30518; the raw outputs were not kept. Every row gives `file:line`. Paths are relative to the repository root. Short path prefixes used in tables:

| Prefix | Full path |
| --- | --- |
| `pg-adapter/` | `packages/3-targets/6-adapters/postgres/src/` |
| `pg-target/` | `packages/3-targets/3-targets/postgres/src/` |
| `sqlite-adapter/` | `packages/3-targets/6-adapters/sqlite/src/` |
| `sqlite-target/` | `packages/3-targets/3-targets/sqlite/src/` |
| `sql-family/` | `packages/2-sql/9-family/src/` |
| `fw-components/` | `packages/1-framework/1-core/framework-components/src/` |
| `contract-psl/` | `packages/2-sql/2-authoring/contract-psl/src/` |
| `contract-ts/` | `packages/2-sql/2-authoring/contract-ts/src/` |
| `ls/` | `packages/1-framework/3-tooling/language-server/src/` |

Two paths in the brief differ from the code. The Postgres type map is `pg-target/core/psl-build/postgres-type-map.ts`, not `psl-infer/`. The codec table is named `CODEC_ID_BY_INFERRED_TYPE`, not `CODEC_ID_BY_PRINTED_TYPE`.

The items that need a decision are numbered DN-1 to DN-16 and listed together in the last section.

## 0. Reference: codec to data type today

Sections 1 to 4 use this table. "Codec names" is the codec descriptor's `targetTypes`, which the decisions delete.

| Codec id | Data type | Codec names (`targetTypes`) | Parameter schema today | file:line |
| --- | --- | --- | --- | --- |
| `pg/text@1` | `pg/text` | `text` | none | `pg-target/core/codecs.ts:383-387` |
| `pg/enum@1` | `pg/enum` | `text` | `typeName: string`, required | `pg-target/core/codecs.ts:462-477` |
| `pg/text-array@1` | `pg/text-array` | `text[]` | none | `pg-target/core/codecs.ts:588-592` |
| `pg/int4@1` | `pg/int4` | `int4` | none | `pg-target/core/codecs.ts:629-633` |
| `pg/int2@1` | `pg/int2` | `int2` | none | `pg-target/core/codecs.ts:679-683` |
| `pg/int8@1` | `pg/int8` | `int8` | none | `pg-target/core/codecs.ts:740-744` |
| `pg/int8number@1` | `pg/int8` | empty | none | `pg-target/core/codecs.ts:796-800` |
| `pg/float4@1` | `pg/float4` | `float4` | none | `pg-target/core/codecs.ts:844-848` |
| `pg/float8@1` | `pg/float8` | `float8` | none | `pg-target/core/codecs.ts:892-896` |
| `pg/bool@1` | `pg/bool` | `bool` | none | `pg-target/core/codecs.ts:940-944` |
| `pg/numeric@1` | `pg/numeric` | `numeric`, `decimal` | `precision?` integer 1 to 1000, `scale?` integer 0 or more (`codecs.ts:157-160`) | `pg-target/core/codecs.ts:1002-1006` |
| `pg/unboundedint@1` | `pg/numeric` | empty | none | `pg-target/core/codecs.ts:1063-1067` |
| `pg/timetz@1` | `pg/timetz` | `timetz` | `precision?` integer 0 to 6 (`codec-helpers.ts:19-21`) | `pg-target/core/codecs.ts:1118-1122` |
| `pg/bit@1` | `pg/bit` | `bit` | `length?` integer above 0 (`codecs.ts:153-155`) | `pg-target/core/codecs.ts:1169-1173` |
| `pg/varbit@1` | `pg/varbit` | `bit varying` | `length?` integer above 0 | `pg-target/core/codecs.ts:1219-1223` |
| `pg/bytea@1` | `pg/bytea` | `bytea` | none | `pg-target/core/codecs.ts:1267-1271` |
| `pg/uuid@1` | `pg/uuid` | `uuid` | none | `pg-target/core/codecs.ts:1314-1318` |
| `pg/inet@1` | `pg/inet` | `inet` | none | `pg-target/core/codecs.ts:1361-1365` |
| `pg/tsquery@1` | `pg/tsquery` | `tsquery` | none | `pg-target/core/codecs.ts:1424-1428` |
| `pg/interval@1` | `pg/interval` | `interval` | `precision?` integer 0 to 6 | `pg-target/core/codecs.ts:1485-1489` |
| `pg/json@1` | `pg/json` | `json` | none | `pg-target/core/codecs.ts:1534-1538` |
| `pg/jsonb@1` | `pg/jsonb` | `jsonb` | none | `pg-target/core/codecs.ts:1579-1583` |
| `pg/char@1` | `pg/char` | `character` | `length?` integer above 0 | `pg-target/core/codecs.ts:1628-1632` |
| `pg/varchar@1` | `pg/varchar` | `character varying` | `length?` integer above 0 | `pg-target/core/codecs.ts:1658-1662` |
| `pg/int@1` | `pg/int4` | `int4` | none | `pg-target/core/codecs.ts:1693-1697` |
| `pg/float@1` | `pg/float8` | `float8` | none | `pg-target/core/codecs.ts:1720-1724` |
| `pg/date-temporal@1` | `pg/date` | `date` | none | `pg-target/core/temporal-codecs.ts:66-70` |
| `pg/timestamp-temporal@1` | `pg/timestamp` | `timestamp` | `precision?` 0 to 6 | `pg-target/core/temporal-codecs.ts:115-119` |
| `pg/timestamptz-temporal@1` | `pg/timestamptz` | `timestamptz` | `precision?` 0 to 6 | `pg-target/core/temporal-codecs.ts:172-176` |
| `pg/time-temporal@1` | `pg/time` | `time` | `precision?` 0 to 6 | `pg-target/core/temporal-codecs.ts:227-231` |
| `pg/date-string@1` | `pg/date` | empty | none | `pg-target/core/temporal-string-codecs.ts:58-62` |
| `pg/timestamp-string@1` | `pg/timestamp` | empty | `precision?` 0 to 6 | `pg-target/core/temporal-string-codecs.ts:106-110` |
| `pg/timestamptz-string@1` | `pg/timestamptz` | empty | `precision?` 0 to 6 | `pg-target/core/temporal-string-codecs.ts:165-169` |
| `pg/time-string@1` | `pg/time` | empty | `precision?` 0 to 6 | `pg-target/core/temporal-string-codecs.ts:223-227` |
| `pg/timestamptz-date@1` | `pg/timestamptz` | empty | `precision?` 0 to 6 | `pg-target/core/date-codecs.ts:127-131` |
| `sql/char@1` on Postgres | `pg/char` | from the shared template | `length?` integer above 0 (`packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts:48-50`) | `pg-target/core/codecs.ts:324-328` |
| `sql/varchar@1` on Postgres | `pg/varchar` | from the shared template | `length?` integer above 0 | `pg-target/core/codecs.ts:330-334` |
| `sql/int@1` on Postgres | `pg/int4` | from the shared template | none | `pg-target/core/codecs.ts:336-340` |
| `sql/float@1` on Postgres | `pg/float8` | from the shared template | none | `pg-target/core/codecs.ts:342-346` |
| `sql/text@1` on Postgres | `pg/text` | from the shared template | none | `pg-target/core/codecs.ts:348-352` |
| `arktype/json@1` | `pg/jsonb` | `jsonb` | the codec's own keys `expression`, `jsonIr` | `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:220-224` |
| `pg/vector@1` | `pgvector/vector` | `vector` | `length` integer 1 to 16000, required (`codecs.ts:39-50`) | `packages/3-extensions/pgvector/src/core/codecs.ts:182-186` |
| `pg/geometry@1` | `postgis/geometry` | `geometry` | `srid?` integer 0 or more (`codecs.ts:59-73`) | `packages/3-extensions/postgis/src/core/codecs.ts:155-159` |
| `sqlite/text@1` | `sqlite/text` | `text` | none | `sqlite-target/core/codecs.ts:280-283` |
| `sqlite/integer@1` | `sqlite/integer` | `integer` | none | `sqlite-target/core/codecs.ts:336-339` |
| `sqlite/real@1` | `sqlite/real` | `real` | none | `sqlite-target/core/codecs.ts:387-390` |
| `sqlite/blob@1` | `sqlite/blob` | `blob` | none | `sqlite-target/core/codecs.ts:436-439` |
| `sqlite/datetime@1` | `sqlite/datetime` | `text` | none | `sqlite-target/core/codecs.ts:497-500` |
| `sqlite/json@1` | `sqlite/json` | `text` | none | `sqlite-target/core/codecs.ts:539-542` |
| `sqlite/bigint@1` | `sqlite/bigint` | `integer` | none | `sqlite-target/core/codecs.ts:611-614` |
| `sqlite/bigintnumber@1` | `sqlite/bigint` | empty | none | `sqlite-target/core/codecs.ts:682-685` |
| `sql/char@1` on SQLite | `sqlite/text` | from the shared template | `length?` | `sqlite-target/core/codecs.ts:236-239` |
| `sql/varchar@1` on SQLite | `sqlite/text` | from the shared template | `length?` | `sqlite-target/core/codecs.ts:241-244` |
| `sql/int@1` on SQLite | `sqlite/integer` | from the shared template | none | `sqlite-target/core/codecs.ts:246-249` |
| `sql/float@1` on SQLite | `sqlite/real` | from the shared template | none | `sqlite-target/core/codecs.ts:251-254` |
| Mongo, 12 codecs | `mongo/objectid`, `string`, `double`, `int32`, `bool`, `date`, `vector`, `int64`, `decimal128`, `binary`, `json`, `bson` | `objectId`, `string`, `double`, `int`, `bool`, `date`, `vector`, `long`, `decimal`, `binData`, eight names for `json`, none for `bson` | not read here | `packages/3-mongo-target/1-mongo-target/src/core/codecs.ts:257-320` |

Who registers data types today: the Postgres data types are declared in the target (`pg-target/core/data-types.ts:56-148`) but contributed to the stack by the adapter (`pg-adapter/core/descriptor-meta.ts:171`). SQLite is the same (`sqlite-target/core/data-types.ts:52-80`, `sqlite-adapter/core/descriptor-meta.ts:33`). pgvector and postgis register their own (`packages/3-extensions/pgvector/src/core/descriptor-meta.ts:73`, `packages/3-extensions/postgis/src/core/descriptor-meta.ts:149`).

## 1. PSL type constructors

57 constructors in production code. "Bare" means a top-level constructor with no entity reference whose arguments are all optional, which is the rule in `collectScalarTypeConstructors` (`fw-components/shared/framework-authoring.ts:1035-1046`). Argument notation: `name: kind, integer, min..max, optional`. "Data type" is the data type of the constructor's codec from section 0.

### 1.1 Postgres adapter, `pg-adapter/core/control-mutation-defaults.ts`

Contributed by the adapter descriptor at `pg-adapter/exports/control.ts:17`. None has `entityRefArg` or `deprecated`. All have documentation.

| PSL name | Arguments | Codec id | `nativeType` | `typeParams` template | Bare | Data type | Line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `String` | none | `pg/text@1` | `text` | none | yes | `pg/text` | 149 |
| `Boolean` | none | `pg/bool@1` | `bool` | none | yes | `pg/bool` | 154 |
| `Int` | none | `pg/int4@1` | `int4` | none | yes | `pg/int4` | 159 |
| `BigInt` | none | `pg/int8@1` | `int8` | none | yes | `pg/int8` | 164 |
| `Float` | none | `pg/float8@1` | `float8` | none | yes | `pg/float8` | 169 |
| `Decimal` | none | `pg/numeric@1` | `numeric` | none | yes | `pg/numeric` | 174 |
| `DateTime` | none | `pg/timestamptz-temporal@1` | `timestamptz` | none | yes | `pg/timestamptz` | 179 |
| `Json` | none | `pg/json@1` | `json` | none | yes | `pg/json` | 185 |
| `Jsonb` | none | `pg/jsonb@1` | `jsonb` | none | yes | `pg/jsonb` | 190 |
| `Bytes` | none | `pg/bytea@1` | `bytea` | none | yes | `pg/bytea` | 195 |
| `VarChar` | `length: number, integer, min 1, optional` | `sql/varchar@1` | `character varying` | `length: arg 0` | yes | `pg/varchar` | 203 |
| `Char` | `length: number, integer, min 1, optional` | `sql/char@1` | `character` | `length: arg 0` | yes | `pg/char` | 213 |
| `Numeric` | `precision: number, integer, min 1, optional`; `scale: number, integer, min 0, optional` | `pg/numeric@1` | `numeric` | `precision: arg 0`, `scale: arg 1` | yes | `pg/numeric` | 223 |
| `Timestamp` | `precision: number, integer, min 0, optional` | `pg/timestamp-temporal@1` | `timestamp` | `precision: arg 0` | yes | `pg/timestamp` | 239 |
| `Timestamptz` | `precision`, same | `pg/timestamptz-temporal@1` | `timestamptz` | `precision: arg 0` | yes | `pg/timestamptz` | 249 |
| `Time` | `precision`, same | `pg/time-temporal@1` | `time` | `precision: arg 0` | yes | `pg/time` | 260 |
| `Timetz` | `precision`, same | `pg/timetz@1` | `timetz` | `precision: arg 0` | yes | `pg/timetz` | 270 |
| `Uuid` | none | `pg/uuid@1` | `uuid` | none | yes | `pg/uuid` | 280 |
| `Inet` | none | `pg/inet@1` | `inet` | none | yes | `pg/inet` | 285 |
| `SmallInt` | none | `pg/int2@1` | `int2` | none | yes | `pg/int2` | 290 |
| `Real` | none | `pg/float4@1` | `float4` | none | yes | `pg/float4` | 295 |
| `Date` | none | `pg/date-temporal@1` | `date` | none | yes | `pg/date` | 300 |
| `DateString` | none | `pg/date-string@1` | `date` | none | yes | `pg/date` | 309 |
| `TimestampString` | `precision`, same | `pg/timestamp-string@1` | `timestamp` | `precision: arg 0` | yes | `pg/timestamp` | 314 |
| `TimestamptzJsDate` | `precision`, same | `pg/timestamptz-date@1` | `timestamptz` | `precision: arg 0` | yes | `pg/timestamptz` | 324 |
| `TimestamptzString` | `precision`, same | `pg/timestamptz-string@1` | `timestamptz` | `precision: arg 0` | yes | `pg/timestamptz` | 335 |
| `TimeString` | `precision`, same | `pg/time-string@1` | `time` | `precision: arg 0` | yes | `pg/time` | 345 |

The two tables are merged into one export named `postgresAuthoringTypes` at line 357. The Postgres target exports a different object under the same name (section 1.2). When the constructors move to the target (decision 6), the two objects become one.

### 1.2 Postgres target, `pg-target/core/authoring.ts`

Contributed at `pg-target/core/descriptor-meta.ts:23`.

| PSL name | Arguments | Codec id | `nativeType` | `typeParams` | `entityRefArg` | Documentation | Bare | Data type | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BigIntNumber` | none | `pg/int8number@1` | `int8` | none | no | yes | yes | `pg/int8` | 112 |
| `UnboundedInt` | none | `pg/unboundedint@1` | `numeric` | none | no | yes | yes | `pg/numeric` | 121 |
| `pg.enum` | one positional entity name | `pg/enum@1` | absent | absent; the codec's `columnFromEntity` gives `{typeName}` (`pg-target/core/codecs.ts:501-506`) | `{index: 0, entityKind: 'native_enum'}` | no | no | `pg/enum` | 131 |

### 1.3 SQL family, `sql-family/core/authoring-type-constructors.ts`

Contributed at `sql-family/core/control-descriptor.ts:18`, so it is present in every SQL stack, SQLite included.

| PSL name | Arguments | Codec id | `nativeType` | `typeParams` | Documentation | Bare | Data type | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sql.String` | `length: number, integer, min 1, max 10485760`, required | `sql/varchar@1` | `character varying` | `length: arg 0` | yes | no | `pg/varchar` on Postgres, `sqlite/text` on SQLite | 5 |

### 1.4 SQLite adapter, `sqlite-adapter/core/control-mutation-defaults.ts`

Contributed at `sqlite-adapter/exports/control.ts:16`. No arguments, no `typeParams`, no `entityRefArg`, none deprecated, all documented, all bare.

| PSL name | Codec id | `nativeType` | Data type | Line |
| --- | --- | --- | --- | --- |
| `String` | `sqlite/text@1` | `text` | `sqlite/text` | 153 |
| `Int` | `sqlite/integer@1` | `integer` | `sqlite/integer` | 158 |
| `BigInt` | `sqlite/bigint@1` | `integer` | `sqlite/bigint` | 163 |
| `Float` | `sqlite/real@1` | `real` | `sqlite/real` | 168 |
| `Decimal` | `sqlite/text@1` | `text` | `sqlite/text` | 173 |
| `DateTime` | `sqlite/datetime@1` | `text` | `sqlite/datetime` | 178 |
| `Json` | `sqlite/json@1` | `text` | `sqlite/json` | 183 |
| `Bytes` | `sqlite/blob@1` | `blob` | `sqlite/blob` | 188 |

### 1.5 SQLite target, `sqlite-target/core/authoring.ts`

| PSL name | Codec id | `nativeType` | Documentation | Bare | Data type | Line |
| --- | --- | --- | --- | --- | --- | --- |
| `BigIntNumber` | `sqlite/bigintnumber@1` | `integer` | yes | yes | `sqlite/bigint` | 11 |

### 1.6 Extensions

| PSL name | Arguments | Codec id | `nativeType` | `typeParams` | Documentation | Bare | Data type | file:line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pgvector.Vector` | `length: number, integer, min 1, max 16000`, required | `pg/vector@1` | `vector` | `length: arg 0` | no | no | `pgvector/vector` | `packages/3-extensions/pgvector/src/core/authoring.ts:6` |
| `postgis.Geometry` | `srid: number, integer, min 0`, required | `pg/geometry@1` | `geometry` | `srid: arg 0` | no | no | `postgis/geometry` | `packages/3-extensions/postgis/src/core/authoring.ts:6` |

arktype-json, paradedb and supabase contribute no type constructor.

### 1.7 Mongo adapter, `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts`

No arguments, no `typeParams`, no `entityRefArg`, all documented, all bare. Contributed at line 123. Decision 11 deletes the `nativeType` column here.

| PSL name | Codec constant | `nativeType` | Deprecated, replacement | Line |
| --- | --- | --- | --- | --- |
| `String` | `MONGO_STRING_CODEC_ID` | `string` | no | 31 |
| `Int32` | `MONGO_INT32_CODEC_ID` | `int` | no | 36 |
| `Bool` | `MONGO_BOOLEAN_CODEC_ID` | `bool` | no | 41 |
| `Date` | `MONGO_DATE_CODEC_ID` | `date` | no | 46 |
| `ObjectId` | `MONGO_OBJECTID_CODEC_ID` | `objectId` | no | 51 |
| `Double` | `MONGO_DOUBLE_CODEC_ID` | `double` | no | 56 |
| `Int64` | `MONGO_INT64_CODEC_ID` | `long` | no | 61 |
| `Decimal128` | `MONGO_DECIMAL128_CODEC_ID` | `decimal` | no | 66 |
| `Binary` | `MONGO_BINARY_CODEC_ID` | `binData` | no | 72 |
| `Json` | `MONGO_JSON_CODEC_ID` | `json`, which is not a BSON type name | no | 77 |
| `Bson` | `MONGO_BSON_CODEC_ID` | `bson`, which is not a BSON type name | no | 83 |
| `Int` | `MONGO_INT32_CODEC_ID` | `int` | yes, `Int32` | 89 |
| `Float` | `MONGO_DOUBLE_CODEC_ID` | `double` | yes, `Double` | 95 |
| `Boolean` | `MONGO_BOOLEAN_CODEC_ID` | `bool` | yes, `Bool` | 102 |
| `DateTime` | `MONGO_DATE_CODEC_ID` | `date` | yes, `Date` | 108 |

No constructor exists for the `mongo/vector` codec.

### 1.8 Other matches of `kind: 'typeConstructor'`

These are not constructor declarations.

| File | What it is |
| --- | --- |
| `fw-components/control/psl-ast.ts` (1 match), `fw-components/shared/framework-authoring.ts:127` | type definitions |
| `contract-psl/sql-attribute-specs.ts` (2), `packages/2-mongo-family/2-authoring/contract-psl/src/mongo-attribute-specs.ts` (1) | PSL syntax node of a constructor call |
| `pg-target/core/psl-infer/infer-model-blocks.ts:258, 268`; `pg-target/core/psl-print/column-types.ts:51, 101`; `pg-target/core/psl-print/scalar-fields.ts:181` | printers that build a constructor call node |
| `packages/2-sql/2-authoring/contract-psl/test/fixtures.ts` (32), `packages/3-targets/3-targets/postgres/test/psl-print/build-context.ts` (7) | test copies of the constructor tables; they restate `nativeType` and must change with the template |
| ADR 241 (2), four upgrade instruction files under `skills/prisma-8/upgrading/` (1 each) | documentation showing the old template with `nativeType` |

### 1.9 Bounds: constructor against codec parameter schema

Decision 5 deletes the per-constructor bounds and validates arguments with the data type's parameter schema. Today the two disagree in these places.

| Parameter | Constructor bounds | Codec schema bounds | Difference |
| --- | --- | --- | --- |
| `length` of `VarChar`, `Char` | min 1, no max | above 0, no max | none |
| `length` of `sql.String` | min 1, max 10485760 | above 0, no max | only the constructor has the maximum |
| `precision` of `Numeric` | min 1, no max | 1 to 1000 | only the codec has the maximum |
| `scale` of `Numeric` | min 0 | 0 or more | none |
| `precision` of the seven temporal constructors | min 0, no max | 0 to 6 | only the codec has the maximum |
| `length` of `pgvector.Vector` | 1 to 16000 | 1 to 16000 | none |
| `srid` of `postgis.Geometry` | min 0, required | 0 or more, optional | the constructor requires it, the codec does not |

See DN-10 for the bounds each data type should declare.

## 2. Field presets

40 presets. None sets `default`, `unique` or `nullable`. "Non-type output" lists everything the preset sets besides codec, `nativeType` and `typeParams`.

### 2.1 Postgres target, `pg-target/core/authoring.ts`

| Name | Arguments | Codec id | `nativeType` | `typeParams` | Non-type output | Line |
| --- | --- | --- | --- | --- | --- | --- |
| `text` | none | `pg/text@1` | `text` | none | none | 747 |
| `int` | none | `pg/int4@1` | `int4` | none | none | 754 |
| `bigint` | none | `pg/int8@1` | `int8` | none | none | 761 |
| `float` | none | `pg/float8@1` | `float8` | none | none | 768 |
| `decimal` | none | `pg/numeric@1` | `numeric` | none | none | 775 |
| `boolean` | none | `pg/bool@1` | `bool` | none | none | 782 |
| `json` | none | `pg/jsonb@1` | `jsonb` | none | none | 789 |
| `bytes` | none | `pg/bytea@1` | `bytea` | none | none | 796 |
| `dateTime` | none | `pg/timestamptz-temporal@1` | `timestamptz` | none | none | 803 |
| `temporal.createdAtJsDate` | none | `pg/timestamptz-date@1` | `timestamptz` | none | `onCreate: timestampNow` | 811 |
| `temporal.updatedAtJsDate` | none | `pg/timestamptz-date@1` | `timestamptz` | none | `onCreate` and `onUpdate: timestampNow` | 816 |
| `temporal.timestamptzJsDate` | `precision: number, integer, min 0, optional`; `onCreate: option [now], optional`; `onUpdate: option [now], optional` | `pg/timestamptz-date@1` | `timestamptz` | `precision: arg 0` | each phase selected by its argument, generator `timestampNow` | 821 |
| `temporal.createdAt` | none | `pg/timestamptz-temporal@1` | `timestamptz` | none | `onCreate: instantNow` | 826 |
| `temporal.updatedAt` | none | `pg/timestamptz-temporal@1` | `timestamptz` | none | `onCreate` and `onUpdate: instantNow` | 826 |
| `temporal.createdAtString` | none | `pg/timestamptz-string@1` | `timestamptz` | none | `onCreate: timestampNow` | 831 |
| `temporal.updatedAtString` | none | `pg/timestamptz-string@1` | `timestamptz` | none | `onCreate` and `onUpdate: timestampNow` | 831 |
| `temporal.timestamp` | `precision`, `onCreate`, `onUpdate` as above | `pg/timestamp-temporal@1` | `timestamp` | `precision: arg 0` | phases by argument, generator `plainDateTimeNow` | 836 |
| `temporal.timestamptz` | same | `pg/timestamptz-temporal@1` | `timestamptz` | `precision: arg 0` | phases by argument, generator `instantNow` | 841 |
| `temporal.timestampString` | same | `pg/timestamp-string@1` | `timestamp` | `precision: arg 0` | phases by argument, generator `timestampNow` | 846 |
| `temporal.timestamptzString` | same | `pg/timestamptz-string@1` | `timestamptz` | `precision: arg 0` | phases by argument, generator `timestampNow` | 851 |
| `uuidNative` | none | `pg/uuid@1` | `uuid` | none | none | 857 |
| `id.uuidv4Native` | none | `pg/uuid@1` | `uuid` | none | `onCreate: uuidv4`, `id: true` | 865 |
| `id.uuidv7Native` | none | `pg/uuid@1` | `uuid` | none | `onCreate: uuidv7`, `id: true` | 879 |

The generator per codec comes from `postgresNowGeneratorIds` (`pg-target/core/now-generators.ts:13-19`). The precision argument of the temporal presets is declared once at `sql-family/core/timestamp-now-generator.ts:22-28` with min 0 and no max, a third copy of the precision bound.

### 2.2 SQL family, `sql-family/core/authoring-field-presets.ts`

All use codec `sql/char@1` and `nativeType` `character` from the constants at lines 24-25.

| Name | Arguments | `typeParams` | Non-type output | Line |
| --- | --- | --- | --- | --- |
| `uuidString` | none | `length: 36` | none | 42 |
| `ulid` | none | `length: 26` | none | 52 |
| `nanoid` | object `{size: number, integer, 2..255, optional}`, optional (lines 27-39) | `length: arg 0 path size, default 21` | none | 62 |
| `cuid2` | none | `length: 24` | none | 78 |
| `ksuid` | none | `length: 27` | none | 88 |
| `id.uuidv4String` | none | `length: 36` | `onCreate: uuidv4`, `id: true` | 99 |
| `id.uuidv7String` | none | `length: 36` | `onCreate: uuidv7`, `id: true` | 116 |
| `id.ulid` | none | `length: 26` | `onCreate: ulid`, `id: true` | 133 |
| `id.nanoid` | same object as `nanoid` | `length: arg 0 path size, default 21` | `onCreate: nanoid` with `params.size: arg 0 path size`, `id: true` | 150 |
| `id.cuid2` | none | `length: 24` | `onCreate: cuid2`, `id: true` | 180 |
| `id.ksuid` | none | `length: 27` | `onCreate: ksuid`, `id: true` | 197 |

### 2.3 SQLite target, `sqlite-target/core/authoring.ts`

All use codec `sqlite/datetime@1`, `nativeType` `text`, no `typeParams`.

| Name | Arguments | Non-type output | Line |
| --- | --- | --- | --- |
| `temporal.createdAt` | none | `onCreate: timestampNow` | 24 |
| `temporal.updatedAt` | none | `onCreate` and `onUpdate: timestampNow` | 24 |
| `temporal.datetime` | `onCreate: option [now], optional`; `onUpdate: option [now], optional` | phases by argument, `timestampNow` | 28 |

### 2.4 Mongo target, `packages/3-mongo-target/1-mongo-target/src/core/authoring.ts`

All use `MONGO_DATE_CODEC_ID`, `nativeType` `date` (line 8), no `typeParams`.

| Name | Arguments | Non-type output | Line |
| --- | --- | --- | --- |
| `temporal.createdAt` | none | `onCreate: timestampNow` | 12 |
| `temporal.updatedAt` | none | `onCreate` and `onUpdate: timestampNow` | 12 |
| `temporal.timestamp` | `onCreate`, `onUpdate` options | phases by argument, `timestampNow` | 13 |

### 2.5 Preset builders that take `nativeType` as input

| Builder | What changes | file:line |
| --- | --- | --- |
| `PresetStorageTemplate` type | is `ScalarTypeConstructorOutput & AuthoringStorageTypeTemplate`, both carry `nativeType` | `fw-components/shared/temporal-presets.ts:11` |
| `temporalAuthoringPresets` | spreads the storage template through | `fw-components/shared/temporal-presets.ts:37-64` |
| `temporalCodecPreset` | same | `fw-components/shared/temporal-presets.ts:98-110` |
| `temporalStringAuthoringPresets` | same | `sql-family/core/timestamp-now-generator.ts:11-20` |
| `temporalCodecPresetWithPrecision` | input has `nativeType`, output copies it (lines 46, 55) | `sql-family/core/timestamp-now-generator.ts:40-63` |

## 3. TypeScript column helpers and descriptors

### 3.1 `ColumnTypeDescriptor`

Defined at `fw-components/shared/column-spec.ts:20-35`, exported from `@internal/framework-components/codec` (`fw-components/exports/codec.ts:31`).

```ts
export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown> | undefined;
  readonly typeRef?: string;
  readonly valueSet?: ValueSetRef;
  readonly entityRef?: EntityRef;
};
```

`ColumnSpec` extends it (`column-spec.ts:55-59`), and the packager `column(codecFactory, codecId, typeParams, nativeType)` takes the name as its fourth argument (`column-spec.ts:66-78`).

### 3.2 Postgres adapter helpers, `pg-adapter/exports/column-types.ts`

Public import paths: `@prisma/orm-postgres/adapter/column-types` and `@prisma/orm-target-postgres/adapter/column-types` (`packages/9-public/@prisma/orm-postgres/package.json:47`, `packages/9-public/@prisma/orm-target-postgres/package.json:51`). Internal: `@internal/adapter-postgres/column-types`.

| Export | Codec id | `nativeType` | `typeParams` | Line |
| --- | --- | --- | --- | --- |
| `textColumn` | `pg/text@1` | `text` | none | 37 |
| `charColumn(length)` | `sql/char@1` | `character` | `{length}` | 42 |
| `varcharColumn(length)` | `sql/varchar@1` | `character varying` | `{length}` | 52 |
| `int4Column` | `pg/int4@1` | `int4` | none | 62 |
| `int2Column` | `pg/int2@1` | `int2` | none | 67 |
| `int8Column` | `pg/int8@1` | `int8` | none | 72 |
| `float4Column` | `pg/float4@1` | `float4` | none | 77 |
| `float8Column` | `pg/float8@1` | `float8` | none | 82 |
| `numericColumn(precision, scale?)` | `pg/numeric@1` | `numeric` | `{precision}` or `{precision, scale}` | 87 |
| `dateTemporalColumn` | `pg/date-temporal@1` | `date` | none | 104 |
| `dateStringColumn` | `pg/date-string@1` | `date` | none | 109 |
| `timestampTemporalColumn` | `pg/timestamp-temporal@1` | `timestamp` | none | 114 |
| `timestampStringColumn` | `pg/timestamp-string@1` | `timestamp` | none | 119 |
| `timestamptzTemporalColumn` | `pg/timestamptz-temporal@1` | `timestamptz` | none | 124 |
| `timestamptzJsDateColumn` | `pg/timestamptz-date@1` | `timestamptz` | none | 129 |
| `timestamptzStringColumn` | `pg/timestamptz-string@1` | `timestamptz` | none | 134 |
| `timeTemporalColumn(precision?)` | `pg/time-temporal@1` | `time` | `{precision}` when given | 139 |
| `timeStringColumn(precision?)` | `pg/time-string@1` | `time` | `{precision}` when given | 151 |
| `timetzColumn(precision?)` | `pg/timetz@1` | `timetz` | `{precision}` when given | 163 |
| `boolColumn` | `pg/bool@1` | `bool` | none | 175 |
| `bitColumn(length)` | `pg/bit@1` | `bit` | `{length}` | 180 |
| `varbitColumn(length)` | `pg/varbit@1` | `bit varying` | `{length}` | 190 |
| `byteaColumn` | `pg/bytea@1` | `bytea` | none | 205 |
| `intervalColumn(precision?)` | `pg/interval@1` | `interval` | `{precision}` when given | 210 |
| `jsonColumn` | `pg/json@1` | `json` | none | 227 |
| `jsonbColumn` | `pg/jsonb@1` | `jsonb` | none | 235 |

Facts: no helper exists here for `pg/uuid@1`, `pg/inet@1`, `pg/tsquery@1`, `pg/int8number@1` or `pg/unboundedint@1`. The timestamp helpers take no precision although their codecs do. None of the helpers validates its argument.

### 3.3 SQLite adapter helpers, `sqlite-adapter/core/column-types.ts`

Public import paths: `@prisma/orm-sqlite/adapter/column-types`, `@prisma/orm-target-sqlite/adapter/column-types` (`package.json:45` in both). Re-exported at `sqlite-adapter/exports/column-types.ts:1-9`. They do not use `satisfies ColumnTypeDescriptor`.

| Export | Codec id | `nativeType` | Line |
| --- | --- | --- | --- |
| `textColumn` | `sqlite/text@1` | `text` | 11 |
| `integerColumn` | `sqlite/integer@1` | `integer` | 16 |
| `realColumn` | `sqlite/real@1` | `real` | 21 |
| `blobColumn` | `sqlite/blob@1` | `blob` | 26 |
| `datetimeColumn` | `sqlite/datetime@1` | `text` | 31 |
| `jsonColumn` | `sqlite/json@1` | `text` | 36 |
| `bigintColumn` | `sqlite/bigint@1` | `integer` | 41 |

### 3.4 Extension helpers

| Export | Public import path | Codec id | `nativeType` | `typeParams` | file:line |
| --- | --- | --- | --- | --- | --- |
| `vector(length)` | `@prisma/orm-extension-pgvector/column-types` | `pg/vector@1` | `vector` | `{length}`, checked 1 to 16000 at line 24 | `packages/3-extensions/pgvector/src/exports/column-types.ts:21` |
| `geometryColumn` | `@prisma/orm-extension-postgis/column-types` | `pg/geometry@1` | `geometry` | none | `packages/3-extensions/postgis/src/exports/column-types.ts:13` |
| `geometry({srid})` | same | `pg/geometry@1` | `geometry` | `{srid}`, checked 0 or more at line 34 | `packages/3-extensions/postgis/src/exports/column-types.ts:28` |
| `arktypeJson(schema)` | `@prisma/orm-extension-arktype-json/column-types` | `arktype/json@1` | `jsonb` (constant at `arktype-json-codec.ts:37`) | `{expression, jsonIr}` | `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:257-285`, exported at `src/exports/column-types.ts:2` |

### 3.5 Generator helpers, `packages/1-framework/2-authoring/ids/src/index.ts`

Public import path: `@prisma/orm-framework/ids`. Internal: `@internal/ids`. All return `{codecId: 'sql/char@1', nativeType: 'character'}` from the constant at line 10, with `typeParams.length` from the table at lines 49-74.

| Export | Length | Line |
| --- | --- | --- |
| `ulid(options?)` | 26 | 109 |
| `nanoid(options?)` | `size`, default 21, checked 2 to 255 at line 33 | 111 |
| `uuidv7(options?)` | 36 | 113 |
| `uuidv4(options?)` | 36 | 115 |
| `cuid2(options?)` | 24 | 117 |
| `ksuid(options?)` | 27 | 119 |

### 3.6 Enums

| Export | Public import path | What it takes and returns | file:line |
| --- | --- | --- | --- |
| `enumType(name, codec, ...members)` | `@prisma/orm-framework/contract-authoring`; bound copies from `@prisma/orm-postgres/contract-builder` (`packages/3-extensions/postgres/src/exports/contract-builder.ts:30`) | `codec` is `Pick<ColumnTypeDescriptor, 'codecId' \| 'nativeType'>` written by the user; the handle stores `nativeType: codec.nativeType` | `packages/1-framework/2-authoring/contract/src/enum-type.ts:153-238`, handle field at 76-77, copy at 229 |
| `pg.enum(handle)` | `@prisma/orm-postgres/contract-builder` (`contract-builder.ts:32`) | codec `pg/enum@1`; `nativeType` and `typeParams` from `pgEnumDescriptor.columnFromEntity(handle.entity)` | `packages/3-extensions/postgres/src/contract/native-enum.ts:155-181` |

### 3.7 Per-codec column packagers

These call `column(...)` and pass the name as the fourth argument. Served by `@internal/target-postgres/codecs` (`pg-target/exports/codecs.ts:38-65`), `@internal/target-sqlite/codecs` (`sqlite-target/exports/codecs.ts:20-27`), and the public `/target/codecs` paths of the same packages.

| Export | Codec id | Name passed | file:line |
| --- | --- | --- | --- |
| `sqlTextColumn` | `sql/text@1` | `text` | `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts:84-85` |
| `sqlIntColumn` | `sql/int@1` | `int` | `sql-codecs.ts:122-123` |
| `sqlFloatColumn` | `sql/float@1` | `float` | `sql-codecs.ts:160-161` |
| `sqlCharColumn(params)` | `sql/char@1` | `char` | `sql-codecs.ts:201-202` |
| `sqlVarcharColumn(params)` | `sql/varchar@1` | `varchar` | `sql-codecs.ts:242-243` |
| `pgTextColumn` | `pg/text@1` | `text` | `pg-target/core/codecs.ts:398-399` |
| `pgInt4Column` | `pg/int4@1` | `int4` | `codecs.ts:644-645` |
| `pgInt2Column` | `pg/int2@1` | `int2` | `codecs.ts:694-695` |
| `pgInt8Column` | `pg/int8@1` | `int8` | `codecs.ts:755-756` |
| `pgInt8NumberColumn` | `pg/int8number@1` | `int8` | `codecs.ts:811-812` |
| `pgFloat4Column` | `pg/float4@1` | `float4` | `codecs.ts:859-860` |
| `pgFloat8Column` | `pg/float8@1` | `float8` | `codecs.ts:907-908` |
| `pgBoolColumn` | `pg/bool@1` | `bool` | `codecs.ts:955-956` |
| `pgNumericColumn(params)` | `pg/numeric@1` | `numeric` | `codecs.ts:1017-1018` |
| `pgUnboundedIntColumn` | `pg/unboundedint@1` | `numeric` | `codecs.ts:1078-1079` |
| `pgTimetzColumn(params)` | `pg/timetz@1` | `timetz` | `codecs.ts:1134-1135` |
| `pgBitColumn(params)` | `pg/bit@1` | `bit` | `codecs.ts:1184-1185` |
| `pgVarbitColumn(params)` | `pg/varbit@1` | `bit varying` | `codecs.ts:1234-1235` |
| `pgByteaColumn` | `pg/bytea@1` | `bytea` | `codecs.ts:1279-1280` |
| `pgUuidColumn` | `pg/uuid@1` | `uuid` | `codecs.ts:1326-1327` |
| `pgInetColumn` | `pg/inet@1` | `inet` | `codecs.ts:1373-1374` |
| `pgIntervalColumn(params)` | `pg/interval@1` | `interval` | `codecs.ts:1501-1502` |
| `pgJsonColumn` | `pg/json@1` | `json` | `codecs.ts:1546-1547` |
| `pgJsonbColumn` | `pg/jsonb@1` | `jsonb` | `codecs.ts:1591-1592` |
| `pgCharColumn(params)` | `pg/char@1` | `character` | `codecs.ts:1646-1647` |
| `pgVarcharColumn(params)` | `pg/varchar@1` | `character varying` | `codecs.ts:1676-1677` |
| `pgIntColumn` | `pg/int@1` | `int4` | `codecs.ts:1708-1709` |
| `pgFloatColumn` | `pg/float@1` | `float8` | `codecs.ts:1735-1736` |
| `pgTimestamptzDateColumn(params)` | `pg/timestamptz-date@1` | `timestamptz` | `pg-target/core/date-codecs.ts:145-146` |
| `pgDateTemporalColumn` | `pg/date-temporal@1` | `date` | `pg-target/core/temporal-codecs.ts:78-79` |
| `pgTimestampTemporalColumn(params)` | `pg/timestamp-temporal@1` | `timestamp` | `temporal-codecs.ts:130-131` |
| `pgTimestamptzTemporalColumn(params)` | `pg/timestamptz-temporal@1` | `timestamptz` | `temporal-codecs.ts:187-188` |
| `pgTimeTemporalColumn(params)` | `pg/time-temporal@1` | `time` | `temporal-codecs.ts:240-241` |
| `pgDateStringColumn` | `pg/date-string@1` | `date` | `pg-target/core/temporal-string-codecs.ts:70-71` |
| `pgTimestampStringColumn(params)` | `pg/timestamp-string@1` | `timestamp` | `temporal-string-codecs.ts:124-125` |
| `pgTimestamptzStringColumn(params)` | `pg/timestamptz-string@1` | `timestamptz` | `temporal-string-codecs.ts:183-184` |
| `pgTimeStringColumn(params)` | `pg/time-string@1` | `time` | `temporal-string-codecs.ts:239-240` |
| `sqliteTextColumn` | `sqlite/text@1` | `text` | `sqlite-target/core/codecs.ts:292-293` |
| `sqliteIntegerColumn` | `sqlite/integer@1` | `integer` | `codecs.ts:348-349` |
| `sqliteRealColumn` | `sqlite/real@1` | `real` | `codecs.ts:399-400` |
| `sqliteBlobColumn` | `sqlite/blob@1` | `blob` | `codecs.ts:448-449` |
| `sqliteDatetimeColumn` | `sqlite/datetime@1` | `text` | `codecs.ts:509-510` |
| `sqliteJsonColumn` | `sqlite/json@1` | `text` | `codecs.ts:551-552` |
| `sqliteBigintColumn` | `sqlite/bigint@1` | `integer` | `codecs.ts:623-624` |
| `sqliteBigintNumberColumn` | `sqlite/bigintnumber@1` | `integer` | `codecs.ts:697-698` |
| `pgVectorColumn(length)` | `pg/vector@1` | `vector` | `packages/3-extensions/pgvector/src/core/codecs.ts:202-203` |
| `pgGeometryColumn` | `pg/geometry@1` | `geometry` | `packages/3-extensions/postgis/src/core/codecs.ts:205-210` |

For a call written over several lines, the line given is where `column(` starts. The five shared `sql*Column` helpers pass names that no database uses as stored today (`int`, `float`, `char`, `varchar`), which differ from what the Postgres adaptations render.

The control-table helpers in `pg-target/contract-free/columns.ts:25-33` and `sqlite-target/contract-free/columns.ts:22-25` name a codec only and carry no type name. They do not change.

### 3.8 Composed helpers built from the constructor and preset tables

| Place | What it reads | file:line |
| --- | --- | --- |
| `type.*` helpers | `instantiateAuthoringTypeConstructor`, then copies `triple.nativeType` into a storage type instance | `contract-ts/authoring-helper-runtime.ts:32-60`, copy at 49 |
| Type of the helper's result | `Descriptor['output']['nativeType']` | `contract-ts/composed-authoring-helpers.ts:82` |
| Preset helper result type | `ColumnTypeDescriptor<PresetCodecId<...>>` | `contract-ts/authoring-type-utils.ts:52` |
| Contract type extraction | matches on `nativeType: infer NativeType` | `contract-ts/contract-types.ts:306, 363-365, 485` |

### 3.9 Every place that builds a column descriptor by hand

Production and example code. Each writes `codecId` and `nativeType` as literals or copies `nativeType` from another object.

| What | file:line |
| --- | --- |
| Supabase handle constants `pgText`, `pgTimestamptz` | `packages/3-extensions/supabase/src/contract/handles.ts:15, 19-22` |
| Supabase role enum, `enumType(..., {codecId: 'pg/text@1', nativeType: 'text'}, ...)` | `packages/3-extensions/supabase/src/contract/roles.ts:15` |
| pgvector contract, `storage.types.vector` entry with `nativeType` | `packages/3-extensions/pgvector/src/contract.ts:49-54` |
| postgis contract, `storage.types.geometry` entry with `nativeType` | `packages/3-extensions/postgis/src/contract.ts:44-49` |
| Example contract | `examples/prisma-8-demo/prisma/contract.ts:12, 16` |
| Generator storage constant | `packages/1-framework/2-authoring/ids/src/index.ts:10` |
| Mongo preset storage constant | `packages/3-mongo-target/1-mongo-target/src/core/authoring.ts:8` |
| SQL enum block factory | `sql-family/core/authoring-entity-types.ts:127-131` |
| Mongo enum block factory | `packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:137-141` |
| Enum block descriptor map in the PSL interpreter | `contract-psl/interpreter.ts:553-556` |
| Entity reference constructor result | `contract-psl/psl-column-resolution.ts:375-380` |
| Descriptor copy helper | `contract-psl/psl-column-resolution.ts:94-98` |
| Named type resolution | `contract-psl/psl-named-type-resolution.ts:150, 198` |
| TS lowering of an enum handle and of a named type | `contract-ts/contract-lowering.ts:106-109, 134-138` |
| TS storage column build | `contract-ts/build-contract.ts:847-852, 875-885` |
| TS enum qualification | `contract-ts/build-contract.ts:630-655` |
| TS named storage types | `contract-ts/build-contract.ts:1638` |
| `pg.enum` TS helper | `packages/3-extensions/postgres/src/contract/native-enum.ts:166-175` |
| Value object field printed as a column | `pg-target/core/psl-print/domain-types.ts:62-67` |
| Named type printed as a column | `pg-target/core/psl-print/domain-types.ts:127` |
| Junction table fixture columns with `nativeType: 'int4'` | `pg-target/core/psl-infer/junction-relation-field-names.ts:18, 41` |
| Pack metadata `types.storage[]`, 35 entries | `pg-adapter/core/descriptor-meta.ts:225-326` |
| Pack metadata, extensions | `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:104-105`, `packages/3-extensions/postgis/src/core/descriptor-meta.ts:173-174`, `packages/3-extensions/arktype-json/src/core/pack-meta.ts:29-34` |

Tests, examples and fixtures hold 2933 literal `nativeType: '...'` lines in 428 files (`git grep -n "nativeType: ['\"]" -- 'packages/**/test/**' 'test/**' 'examples/**'`, generated files and JSON excluded). They are not listed row by row.

## 4. `contract infer` today

### 4.1 What introspection hands to infer

The Postgres adapter reads `format_type` and normalises it (`pg-adapter/core/control-adapter.ts:1052-1084`, `normalizeFormattedType` at 1482-1532, `normalizeSchemaNativeType` at `pg-target/core/native-type-normalizer.ts:26-49`). A trailing `[]` is removed and recorded as `many: true` (line 1081-1084). So infer receives `int4`, never `integer`; `character varying(255)`, never `varchar(255)`; `timestamptz(3)`, never `timestamp(3) with time zone`.

### 4.2 The type map, `pg-target/core/psl-build/postgres-type-map.ts`

Resolution order (lines 81-116): enum type name, then a parenthesised name whose base is in `PARAMETERIZED_NATIVE_TYPES`, then `PRESERVED_NATIVE_TYPES`, then `POSTGRES_TO_PSL`, else unsupported. Codec from `CODEC_ID_BY_INFERRED_TYPE` (`pg-target/core/psl-infer/infer-default-codec.ts:24-45`).

| Native type name in the tables | Table, line | PSL type printed | With parameters | Codec assigned |
| --- | --- | --- | --- | --- |
| `text` | `POSTGRES_TO_PSL`, 4 | `String` | none | `pg/text@1` |
| `bool` | 5 | `Boolean` | none | `pg/bool@1` |
| `boolean` | 6 | `Boolean` | none | `pg/bool@1` |
| `int4` | 7 | `Int` | none | `pg/int4@1` |
| `integer` | 8 | `Int` | none | `pg/int4@1` |
| `int8` | 9 | `BigInt` | none | `pg/int8@1` |
| `bigint` | 10 | `BigInt` | none | `pg/int8@1` |
| `float8` | 11 | `Float` | none | `pg/float8@1` |
| `double precision` | 12 | `Float` | none | `pg/float8@1` |
| `jsonb` | 13 | `Jsonb` | none | `pg/jsonb@1` |
| `bytea` | 14 | `Bytes` | none | `pg/bytea@1` |
| `character varying` | `PRESERVED`, 18; `PARAMETERIZED`, 43 | `VarChar` | `character varying(255)` prints `VarChar(255)` | `sql/varchar@1` |
| `varchar` | 21; 46 | `VarChar` | `VarChar(n)` | `sql/varchar@1` |
| `character` | 19; 44 | `Char` | `Char(n)` | `sql/char@1` |
| `char` | 20; 45 | `Char` | `Char(n)` | `sql/char@1` |
| `uuid` | 22 | `Uuid` | none | `pg/uuid@1` |
| `inet` | 23 | `Inet` | none | `pg/inet@1` |
| `int2` | 24 | `SmallInt` | none | `pg/int2@1` |
| `smallint` | 25 | `SmallInt` | none | `pg/int2@1` |
| `float4` | 26 | `Real` | none | `pg/float4@1` |
| `real` | 27 | `Real` | none | `pg/float4@1` |
| `numeric` | 28; 47 | `Numeric` | `numeric(10,2)` prints `Numeric(10, 2)`; `numeric(10)` prints `Numeric(10)` | `pg/numeric@1` |
| `decimal` | 29; 48 | `Numeric` | same | `pg/numeric@1` |
| `timestamp` | 30; 49 | `Timestamp` | `timestamp(3)` prints `Timestamp(3)` | `pg/timestamp-temporal@1` |
| `timestamp without time zone` | 31 | `Timestamp` | none; the parenthesised form of this text is not matched | `pg/timestamp-temporal@1` |
| `timestamptz` | 32; 50 | `Timestamptz` | `Timestamptz(3)` | `pg/timestamptz-temporal@1` |
| `timestamp with time zone` | 33 | `Timestamptz` | none | `pg/timestamptz-temporal@1` |
| `date` | 34 | `Date` | none | `pg/date-temporal@1` |
| `time` | 35; 51 | `Time` | `Time(3)` | `pg/time-temporal@1` |
| `time without time zone` | 36 | `Time` | none | `pg/time-temporal@1` |
| `timetz` | 37; 52 | `Timetz` | `Timetz(3)` | `pg/timetz@1` |
| `time with time zone` | 38 | `Timetz` | none | `pg/timetz@1` |
| `json` | 39 | `Json` | none | `pg/json@1` |
| any name in the schema's native enum list | line 82-84 | `pg.enum(<BlockName>)` (`infer-model-blocks.ts:264-273`) | none | defaults read through `pg/text@1` (`infer-default-codec.ts:56, 65`) |
| anything else | line 115 | `Unsupported("<name>")` (`infer-model-blocks.ts:235-249`) | none | none |

An array column prints the element type with `[]` (`infer-model-blocks.ts:245, 305`).

The same type map is also used by `contract print` (`pg-target/core/psl-print/column-types.ts:64-76`, created at `psl-print/psl-contract.ts:309`). There it picks which constructor to try first; if that one does not produce the column's codec, `findAuthoringTypeConstructorCall` takes the first constructor in the stack that does (`column-types.ts:114-116`). `contract print` also has `TYPE_PARAM_ORDER = ['length', 'precision', 'scale']` at line 23, a hand list of parameter order that the data type's rendering replaces.

### 4.3 The constructor each data type must mark as the one infer prints

| Data type | Constructors that name it today | Marked constructor | Today's infer output for the type |
| --- | --- | --- | --- |
| `pg/text` | `String` | `String` | `String` |
| `pg/text-array` | none | see DN-5 | a `text[]` column prints `String[]` |
| `pg/enum` | `pg.enum` | `pg.enum` | `pg.enum(<BlockName>)` |
| `pg/int2` | `SmallInt` | `SmallInt` | `SmallInt` |
| `pg/bool` | `Boolean` | `Boolean` | `Boolean` |
| `pg/json` | `Json` | `Json` | `Json` |
| `pg/tsquery` | none | DN-4 | `Unsupported("tsquery")` |
| `pg/int4` | `Int` | `Int` | `Int` |
| `pg/int8` | `BigInt`, `BigIntNumber` | `BigInt` | `BigInt` |
| `pg/numeric` | `Decimal`, `Numeric`, `UnboundedInt` | `Numeric` | `Numeric`, `Numeric(p)`, `Numeric(p, s)` |
| `pg/float4` | `Real` | `Real` | `Real` |
| `pg/float8` | `Float` | `Float` | `Float` |
| `pg/jsonb` | `Jsonb` | `Jsonb` | `Jsonb` |
| `pg/char` | `Char` | `Char` | `Char`, `Char(n)` |
| `pg/varchar` | `VarChar`, `sql.String` | `VarChar` | `VarChar`, `VarChar(n)` |
| `pg/uuid` | `Uuid` | `Uuid` | `Uuid` |
| `pg/inet` | `Inet` | `Inet` | `Inet` |
| `pg/bit` | none | DN-1 | `Unsupported("bit(n)")` |
| `pg/varbit` | none | DN-2 | `Unsupported("bit varying(n)")` |
| `pg/timetz` | `Timetz` | `Timetz` | `Timetz`, `Timetz(p)` |
| `pg/interval` | none | DN-3 | `Unsupported("interval")`, `Unsupported("interval(p)")` |
| `pg/bytea` | `Bytes` | `Bytes` | `Bytes` |
| `pg/date` | `Date`, `DateString` | `Date` | `Date` |
| `pg/time` | `Time`, `TimeString` | `Time` | `Time`, `Time(p)` |
| `pg/timestamp` | `Timestamp`, `TimestampString` | `Timestamp` | `Timestamp`, `Timestamp(p)` |
| `pg/timestamptz` | `DateTime`, `Timestamptz`, `TimestamptzJsDate`, `TimestamptzString` | `Timestamptz` | `Timestamptz`, `Timestamptz(p)` |
| `pgvector/vector` | `pgvector.Vector` | `pgvector.Vector` | `Unsupported("vector(n)")`; see DN-6 |
| `postgis/geometry` | `postgis.Geometry` | `postgis.Geometry` | `Unsupported("geometry")` or `Unsupported("geometry(Point,4326)")`; see DN-7 |

`inet` is not in the unsupported list: the map prints `Inet` (line 23). The test `pg-target` `test/psl-infer/inferred-psl/inferred-psl.defaults-and-types.test.ts:298-299` records `Unsupported("geometry")` and `Unsupported("hstore")`, and `test/psl-build/postgres-type-map.test.ts:107-117` records the unsupported resolution.

Types with a data type but no constructor, read from the tables: `pg/bit`, `pg/varbit`, `pg/interval`, `pg/tsquery`, `pg/text-array`. Types with a constructor that infer does not print today because no extension type is in the hand table: `pgvector/vector`, `postgis/geometry`.

After the decisions, a column whose type no data type in the stack claims makes infer fail. With the Postgres target alone this covers every other PostgreSQL type, for example `hstore`, `tsvector`, `cidr`, `macaddr`, `money`, `xml`, `point`.

### 4.4 The infer entry point has no stack

`inferPslContract(schema, describedContracts)` (`sql-family/core/control-target-descriptor.ts:72-75`, wired at `pg-target/exports/control.ts:43`) receives no stack. The comment at `infer-default-codec.ts:5-11` says so and explains why the table restates the binding. `buildPslContract(contract, context)` does receive `SqlPslBuildContext` with the authoring contributions and the codec lookup (`control-target-descriptor.ts:79`). See DN-14.

### 4.5 SQLite

SQLite has no `contract infer`. Evidence: the hook `inferPslContract` is optional on the target descriptor (`sql-family/core/control-target-descriptor.ts:64-75`); only the Postgres target sets it (`pg-target/exports/control.ts:43`); `git grep -n "inferPslContract" -- packages/3-targets/3-targets/sqlite packages/3-targets/6-adapters/sqlite` returns nothing; the family throws "does not support contract infer" when the hook is absent (`sql-family/core/control-instance.ts:1012-1024`). SQLite has no `buildPslContract` either. So on SQLite the resolver from a reported text to a data type serves `db verify` only.

## 5. `Unsupported(...)`

`git grep -n "Unsupported"` gives 243 lines outside this project's folder. 79 contain `Unsupported(`. They fall into four groups.

### 5.1 Prisma 8 prints or handles it: remove

| What | file:line |
| --- | --- |
| Infer prints `Unsupported("<name>")` | `pg-target/core/psl-infer/infer-model-blocks.ts:235-249`, text at 243 |
| Type map returns `{unsupported: true}` | `pg-target/core/psl-build/postgres-type-map.ts:115` |
| Type of that result | `sql-family/core/psl-build/type-map.ts:13-16` |
| `contract print` reads the same flag | `pg-target/core/psl-print/column-types.ts:70` |
| PSL printer sets `isUnsupported` from `typeName.startsWith('Unsupported(')` | `packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts:263, 276` |
| Field `isUnsupported` on the print model; nothing reads it | `packages/1-framework/2-authoring/psl-printer/src/types.ts:16` |

The Prisma 8 PSL interpreter has no case for `Unsupported`. A field typed `Unsupported("x")` is an unknown constructor call, so `contract emit` already refuses what infer prints.

### 5.2 Tests of the Prisma 8 behaviour: change with it

| What | file:line |
| --- | --- |
| Expects `Unsupported("geometry")` and `Unsupported("hstore")` | `packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl/inferred-psl.defaults-and-types.test.ts:298-299` |
| Expects `{unsupported: true}` | `packages/3-targets/3-targets/postgres/test/psl-build/postgres-type-map.test.ts:107, 108, 113, 117` |
| `dataTypeForInferredType('Unsupported', false)` | `packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl/inferred-psl.data-type-defaults.test.ts:220` |
| Asserts output does not contain `Unsupported(` | `packages/3-targets/3-targets/postgres/test/psl-infer/infer-psl-contract.enum-adoption.test.ts:262, 293, 480, 637`; `test/psl-infer/inferred-psl/inferred-psl.enums.test.ts:204, 210`; `test/integration/test/cli-journeys/native-enum-adoption.e2e.test.ts:142` |

Tests that depend on the deleted tables: `packages/3-targets/6-adapters/postgres/test/inferred-type-codecs.test.ts:2-30`, `packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl.round-trip.test.ts:30, 208`, `inferred-psl.data-type-defaults.test.ts:7, 203, 209`.

### 5.3 Prisma 6 and Prisma 7 source readers: stay

`Unsupported("...")` is a type of Prisma 6 and Prisma 7 schemas. These readers take it as input and refuse it with a diagnostic. The decision removes a Prisma 8 output, so these do not change.

| What | file:line |
| --- | --- |
| Prisma 7 reader refuses any constructor call in type position with `PSL.PRISMA7_UNSUPPORTED_TYPE` | `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts:965-975` |
| Prisma 6 reader message | `packages/2-mongo-family/2-authoring/contract-prisma6/src/interpreter.ts:532-537` |
| Fixtures | `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/unsupported-type/schema.prisma:7` and `expected-diagnostics.json:6`; `unsupported-type-model-ignored/schema.prisma:12`; `multi-file-errors/schema/b-models.prisma:3` and `expected-diagnostics.json:12`; `packages/2-mongo-family/2-authoring/contract-prisma6/test/fixtures/unsupported-type/schema.prisma:8` and `expected-diagnostics.json:6`; `unsupported-type-model-ignored/schema.prisma:13`; `test/integration/test/fixtures/prisma7-source/reference/schema.prisma:171` |
| Documentation of those readers | `packages/2-sql/2-authoring/contract-prisma7/README.md:42, 53`; `packages/3-extensions/postgres/README.md:134, 141`; `docs/reference/error-reference.md:160, 682, 766`; `test/integration/test/fixtures/prisma7-source/reference/README.md:46`; `test/integration/test/fixtures/prisma7-source/supported/README.md:8` |

### 5.4 Documentation of the Prisma 8 behaviour: update

| What | file:line |
| --- | --- |
| Scorecard row for `Unsupported("...")` | `scorecard/03-psl-schema-language.md:54` |
| Released upgrade instruction that mentions `Unsupported("inet")`; a released file, leave as is | `skills/prisma-8/upgrading/extension/upgrades/0.14-to-0.15/instructions.md:423` |
| Project notes | `projects/port-all-tests/checklists/engines-sql-migration.md` (12 lines), `projects/port-all-tests/checklists/engines-mongo-schema.md` (1), `projects/prisma7-contract-source/` (5), `projects/mongo-defaults-codecs-prisma6-source/slices/05-prisma6-mongo-source/spec.md` (1) |

### 5.5 The word used for something else: no change

The remaining lines use "Unsupported" in error names and messages that are not about this type: `expectUnsupported(` in `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts` (16 lines), `UnsupportedPslCompletionContext` (`ls/completion-context.ts:235-250, 763, 822`), `UnsupportedAttribute` in the binder (`packages/1-framework/2-authoring/psl-parser/src/binder.ts:89-107`), "Unsupported top-level block" (`psl-parser/src/parse.ts:691-692`, `unclaimed-blocks.ts:26`), `errorInitPrisma7ProviderUnsupported` (`packages/1-framework/3-tooling/cli/src/commands/init/errors.ts:322`), `schemaUnsupported`, `nativeTypeUnsupported`, `defaultUnsupported` in the Prisma 6 reader, and `assertNever` messages in the renderers.

## 6. Prisma 7 and Prisma 6 source maps

### 6.1 Prisma 7, `pg-target/core/prisma7-type-map.ts`

Each entry names a Prisma 8 constructor and default arguments. The reader resolves the name through the stack's constructor registry (`packages/2-sql/2-authoring/contract-prisma7/src/native-types.ts:21-38`). A `@db.X(args)` attribute's own arguments replace the defaults.

| Prisma 7 name | Kind | Constructor | Default arguments | Resolves to codec, data type | Line |
| --- | --- | --- | --- | --- | --- |
| `String` | scalar | `String` | none | `pg/text@1`, `pg/text` | 12 |
| `Boolean` | scalar | `Boolean` | none | `pg/bool@1`, `pg/bool` | 13 |
| `Int` | scalar | `Int` | none | `pg/int4@1`, `pg/int4` | 14 |
| `BigInt` | scalar | `BigInt` | none | `pg/int8@1`, `pg/int8` | 15 |
| `Float` | scalar | `Float` | none | `pg/float8@1`, `pg/float8` | 16 |
| `Decimal` | scalar | `Numeric` | `65`, `30` | `pg/numeric@1`, `pg/numeric`, `{precision: 65, scale: 30}` | 17 |
| `DateTime` | scalar | `Timestamp` | `3` | `pg/timestamp-temporal@1`, `pg/timestamp`, `{precision: 3}` | 18 |
| `Json` | scalar | `Jsonb` | none | `pg/jsonb@1`, `pg/jsonb` | 19 |
| `Bytes` | scalar | `Bytes` | none | `pg/bytea@1`, `pg/bytea` | 20 |
| `@db.Text` | native | `String` | none | `pg/text@1`, `pg/text` | 23 |
| `@db.VarChar` | native | `VarChar` | none | `sql/varchar@1`, `pg/varchar` | 24 |
| `@db.Char` | native | `Char` | `1` | `sql/char@1`, `pg/char`, `{length: 1}` | 25 |
| `@db.Uuid` | native | `Uuid` | none | `pg/uuid@1`, `pg/uuid` | 26 |
| `@db.Inet` | native | `Inet` | none | `pg/inet@1`, `pg/inet` | 27 |
| `@db.Boolean` | native | `Boolean` | none | `pg/bool@1`, `pg/bool` | 28 |
| `@db.Integer` | native | `Int` | none | `pg/int4@1`, `pg/int4` | 29 |
| `@db.SmallInt` | native | `SmallInt` | none | `pg/int2@1`, `pg/int2` | 30 |
| `@db.BigInt` | native | `BigInt` | none | `pg/int8@1`, `pg/int8` | 31 |
| `@db.Real` | native | `Real` | none | `pg/float4@1`, `pg/float4` | 32 |
| `@db.DoublePrecision` | native | `Float` | none | `pg/float8@1`, `pg/float8` | 33 |
| `@db.Decimal` | native | `Numeric` | none | `pg/numeric@1`, `pg/numeric` | 34 |
| `@db.Timestamp` | native | `Timestamp` | none | `pg/timestamp-temporal@1`, `pg/timestamp` | 35 |
| `@db.Timestamptz` | native | `Timestamptz` | none | `pg/timestamptz-temporal@1`, `pg/timestamptz` | 36 |
| `@db.Date` | native | `Date` | none | `pg/date-temporal@1`, `pg/date` | 37 |
| `@db.Time` | native | `Time` | none | `pg/time-temporal@1`, `pg/time` | 38 |
| `@db.Timetz` | native | `Timetz` | none | `pg/timetz@1`, `pg/timetz` | 39 |
| `@db.Json` | native | `Json` | none | `pg/json@1`, `pg/json` | 40 |
| `@db.JsonB` | native | `Jsonb` | none | `pg/jsonb@1`, `pg/jsonb` | 41 |
| `@db.ByteA` | native | `Bytes` | none | `pg/bytea@1`, `pg/bytea` | 42 |

Prisma 7 native types with no entry are refused with "has no Prisma 8 codec" (`contract-prisma7/src/interpreter.ts:843-859, 1021-1045`). These include `@db.Bit`, `@db.VarBit`, `@db.Money`, `@db.Xml`, `@db.Oid`, `@db.Citext`. If DN-1 and DN-2 add `Bit` and `VarBit` constructors, `@db.Bit` and `@db.VarBit` can be added to this map; that is outside this project's decisions.

### 6.2 Prisma 7 binding, `pg-target/core/prisma7-binding.ts`

| Entry | What it names | What it becomes | Line |
| --- | --- | --- | --- |
| `typeMap` | the table above | unchanged | 45 |
| `nativeEnum` | `{entityKind: 'native_enum', typeConstructor: ['pg', 'enum']}` | unchanged | 46 |
| `TEMPORAL_NATIVE_TYPES` | set of names `timestamp`, `timestamptz`, `date`, `time`, `timetz` | a set of data type ids `pg/timestamp`, `pg/timestamptz`, `pg/date`, `pg/time`, `pg/timetz` | 8-14 |
| `literalDefaultForm({nativeType, typeParams})` | branches on `json`, `jsonb`, `bytea` and the temporal names; builds `BYTEA` and `TIMESTAMP(3)` cast text by upper-casing the name | receives the data type id; the cast text is the data type's rendered name | 59-82 |
| `TemporalNativeType` type and `storedTemporalText(text, nativeType)` | branch on the same names | data type ids | `pg-target/core/prisma7-temporal-defaults.ts:1, 46-93` |
| Reader's message `no generator for column type "${resolved.descriptor.nativeType}"` | prints the stored name | prints the rendered name | `contract-prisma7/src/interpreter.ts:1098` |
| `target-binding.ts` type of `literalDefaultForm` | `nativeType: string` | `dataType` | `packages/2-sql/2-authoring/contract-prisma7/src/target-binding.ts:7` |

### 6.3 Prisma 6 Mongo binding, `packages/3-mongo-target/1-mongo-target/src/core/prisma6-binding.ts`

It names codecs directly and no constructor, so it carries no type name and does not change.

| Prisma 6 name | Codec constant | Data type | Line |
| --- | --- | --- | --- |
| `String` | `MONGO_STRING_CODEC_ID` | `mongo/string` | 26 |
| `Int` | `MONGO_INT32_CODEC_ID` | `mongo/int32` | 27 |
| `Float` | `MONGO_DOUBLE_CODEC_ID` | `mongo/double` | 28 |
| `Boolean` | `MONGO_BOOLEAN_CODEC_ID` | `mongo/bool` | 29 |
| `DateTime` | `MONGO_DATE_CODEC_ID` | `mongo/date` | 30 |
| `BigInt` | `MONGO_INT64_CODEC_ID` | `mongo/int64` | 31 |
| `Decimal` | `MONGO_DECIMAL128_CODEC_ID` | `mongo/decimal128` | 32 |
| `Bytes` | `MONGO_BINARY_CODEC_ID` | `mongo/binary` | 33 |
| `Json` | `MONGO_JSON_CODEC_ID` | `mongo/json` | 34 |
| `@db.ObjectId` | `MONGO_OBJECTID_CODEC_ID` | `mongo/objectid` | 36 |
| `now()` and `@updatedAt` | generator `timestampNow` | not a type | 37 |

The Prisma 6 reader also sets the enum inference codecs from this table (`packages/2-mongo-family/2-authoring/contract-prisma6/src/interpreter.ts:470-473`).

## 7. Enum blocks and `pg.enum`

### 7.1 How an `enum` block's column descriptor is built today

| Step | What happens | file:line |
| --- | --- | --- |
| 1 | The codec id comes from `@@type("<codec id>")`, or is inferred from the members as text or integer | `fw-components/shared/framework-authoring.ts:319-343` |
| 2 | The inference codecs per target: Postgres `pg/text@1` and `pg/int@1`; SQLite `sqlite/text@1` and `sqlite/integer@1`; Mongo string and int32 | `packages/3-extensions/postgres/src/config/define-config.ts:39`, `pg-target/core/postgres-contract-serializer.ts:35`, `packages/3-extensions/sqlite/src/config/define-config.ts:45`, `packages/3-extensions/mongo/src/config/define-config.ts:35` |
| 3 | **`targetTypes[0]` is read**: `ctx.codecLookup?.targetTypesFor(codecId)?.[0]` | `sql-family/core/authoring-entity-types.ts:42` |
| 4 | If that is undefined, the diagnostic says the codec is unknown | `authoring-entity-types.ts:43-51` |
| 5 | Members are read with `codec.decodeJson` | `authoring-entity-types.ts:68-113` |
| 6 | `enumType(block.name, {codecId, nativeType}, ...members)` | `authoring-entity-types.ts:127-131` |
| 7 | The handle keeps `nativeType` | `packages/1-framework/2-authoring/contract/src/enum-type.ts:229` |
| 8 | The interpreter builds the column descriptor `{codecId: handle.codecId, nativeType: handle.nativeType}` | `contract-psl/interpreter.ts:553-556` |
| 9 | The TS path does the same from the handle | `contract-ts/contract-lowering.ts:105-110` |

`targetTypesFor` has three production readers: step 3 above, the Mongo enum factory (`packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:42`), and the Mongo validator (`packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts:35`). It is built at `fw-components/control/control-stack.ts:631-633, 678` and declared at `fw-components/shared/codec-types.ts:56`. TML-3253's lookup is not on this branch.

A test copy of the enum factory reads the same value: `packages/2-sql/2-authoring/contract-psl/test/fixtures.ts:58`.

### 7.2 What replaces `targetTypes[0]`

The enum factory stops producing a name. It looks up the codec's descriptor (`codecLookup.descriptorFor(codecId)`), takes `descriptor.dataType`, and the column stores `{codecId, dataType}` under decision 3. The rendered name comes from the data type when DDL is written. `EnumTypeHandle.nativeType` and the `nativeType` key of `enumType`'s `codec` argument are deleted; the handle carries `codecId` and the data type follows from it.

| Written | Codec | Data type stored on the column | `typeParams` | Rendered name | Name today |
| --- | --- | --- | --- | --- | --- |
| `enum X { ... } @@type("pg/text@1")` | `pg/text@1` | `pg/text` | none | `text` | `text` |
| `enum X { ... } @@type("pg/int4@1")` | `pg/int4@1` | `pg/int4` | none | `int4` | `int4` |
| `enum X { a b }` with no `@@type` on Postgres, integer members | `pg/int@1` | `pg/int4` | none | `int4` | `int4` |
| native enum, column `pg.enum(Status)` | `pg/enum@1` | `pg/enum` | `{typeName: "<Postgres type name>"}`, schema-qualified by `qualifyEnumColumnType` (`pg-target/core/codecs.ts:536-551`) | the value of `typeParams.typeName` | the same text, held in both `nativeType` and `typeParams.typeName` |

For the native enum, `columnFromEntity` stops returning `nativeType` and returns `typeParams` only (`pg-target/core/codecs.ts:501-506`); the interface at `contract-psl/psl-column-resolution.ts:258-261` and the TS helper at `native-enum.ts:166-169` drop the field; `qualifyEnumColumnType` returns `typeParams` only.

Two behaviour changes follow from reading the data type in place of `targetTypes[0]`:

1. `@@type` naming a codec whose `targetTypes` is empty (`pg/int8number@1`, `pg/unboundedint@1`, the four temporal text codecs, `pg/timestamptz-date@1`, `sqlite/bigintnumber@1`) is refused today with "references unknown codec". After the change it resolves, because every codec has a data type.
2. `@@type("pg/enum@1")` on an `enum` block gives `nativeType: 'text'` with codec `pg/enum@1` today, because that codec's `targetTypes` is `['text']` (`pg-target/core/codecs.ts:476`). After the change the data type is `pg/enum`, which needs `typeName`. See DN-13.

## 8. Value objects

| Where `jsonb` or the storage type is fixed | What it does today | What it becomes | file:line |
| --- | --- | --- | --- |
| TS build constants | `JSONB_CODEC_ID = 'pg/jsonb@1'`, `JSONB_NATIVE_TYPE = 'jsonb'` | deleted; see below | `contract-ts/build-contract.ts:729-730` |
| TS build, value object column | always `{nativeType: 'jsonb', codecId: 'pg/jsonb@1'}`, on every target, SQLite included | the stack's declared value object storage constructor, instantiated with no arguments, gives the codec; the column stores that codec and its data type | `contract-ts/build-contract.ts:837-853` |
| Stack declaration | Postgres adapter `valueObjectStorageType: 'Jsonb'`; SQLite adapter `'Json'` | unchanged in meaning; moves to the targets with the constructors (decision 6) | `pg-adapter/exports/control.ts:19`, `sqlite-adapter/exports/control.ts:18` |
| Declaration type | `valueObjectStorageType?: string` | unchanged | `fw-components/shared/framework-authoring.ts:661` |
| Assembly check | one declaration per stack; the name must be a bare constructor | unchanged | `fw-components/control/control-stack.ts:225-238, 311-319` |
| PSL path | reads the declared constructor's descriptor from the scalar map | unchanged; the descriptor loses `nativeType` | `contract-psl/psl-field-resolution.ts:440, 508-514` |
| Contract validator | `JSON_NATIVE_TYPES = new Set(['json', 'jsonb'])`, compared with `column.nativeType` | has no stack, so under decision 3 it compares `column.dataType`. See DN-15 for the set of ids | `packages/2-sql/1-core/contract/src/validators.ts:711-725` |
| `contract print` of a value object field | asks the Postgres codec descriptor for `nativeTypeFor({codecId})`, a hook the decisions delete | the codec's data type | `pg-target/core/psl-print/domain-types.ts:29-44, 62-67` |
| Test copies | `valueObjectStorageType: 'Jsonb'` or `'Json'` | unchanged | `packages/2-sql/2-authoring/contract-psl/test/fixtures.ts:522`, `test/interpreter.no-check.test.ts:62`, `test/interpreter.value-objects.test.ts:40, 408`, `test/integration/test/value-objects/value-objects.integration.test.ts:122` |

The TS and PSL paths disagree today on SQLite: PSL uses the declared `Json` constructor (`sqlite/json@1`, `text`), TS writes `pg/jsonb@1` and `jsonb`.

## 9. Language server

| Place | What is offered or shown | Data it reads | file:line |
| --- | --- | --- | --- |
| Stack to pipeline inputs | copies three things from the control stack | `stack.scalarTypes`, `stack.authoringContributions`, `stack.controlMutationDefaults` | `ls/config-resolution.ts:71-80` |
| Source of `scalarTypes` | names of bare constructors | `collectScalarTypeConstructors(authoringContributions.type).keys()` | `fw-components/control/control-stack.ts:856` |
| Completion in field type position | bare scalar names, then model, composite type, named type and namespace names | `source.scalarTypes`, the symbol table | `ls/completion-provider.ts:496-506` |
| Detail text of each scalar item | the constructor's `documentation`, or "Configured scalar type" when absent | `authoringContributions.type[name].documentation` | `ls/completion-provider.ts:549-579`, text at 576 |
| Deprecated scalar item | "Deprecated: use X." and the deprecated tag | `typeConstructor.deprecated.replacement` | `ls/completion-provider.ts:565-572`, tag at 545 |
| Completion after `namespace.` | members of a namespace declared in the document only | `symbolTable.topLevel.namespaces` | `ls/completion-provider.ts:508-523` |
| Named type classification | whether a `types {}` entry refines a scalar | `scalarTypes.includes(symbol.baseType)` | `ls/named-type-classification.ts:10-16` |
| Field name completion inside attribute arguments | whether a field is scalar | `scalarTypes`, and a walk of the constructor namespace by path | `ls/completion-symbols.ts:113-167`, called from `ls/completion-provider.ts:195-208, 226-239` |
| Semantic tokens | marks a scalar name as a library type | `source.scalarTypes` | `ls/semantic-tokens.ts:557-568` |
| Default function completion and signature help | function names, parameter labels and documentation | the `signature` of each registry entry in `controlMutationDefaults`, with `dataTypeEntries` from `authoringContributions.dataTypes` | `ls/attribute-spec-resolution.ts:60-92`, `ls/completion-values.ts:78, 116, 139`, `ls/signature-help.ts:105-126` |
| Server inputs | passes the same three values to diagnostics and completion | as above | `ls/server.ts:457, 489-497, 529-534` |

Not offered today: constructors under a namespace (`pg.enum`, `sql.String`, `pgvector.Vector`, `postgis.Geometry`), constructors with a required argument, and the arguments of any constructor. There is no hover provider; the server registers completion and signature help only (`ls/server.ts:557-558`). Signature help covers attribute arguments, and has no case for a type constructor call.

Nothing in the language server reads `nativeType`, `targetTypes` or a data type's name. The only change the decisions force is in the data it is given: `collectScalarTypeConstructors` returns `ScalarTypeConstructorOutput` with `nativeType` (`fw-components/shared/framework-authoring.ts:1014-1018`), which loses that field.

## 10. Assembly checks

### 10.1 Checks on constructors and presets that exist

| Check | Applies to | Failure | file:line |
| --- | --- | --- | --- |
| A path is contributed by one component only | constructors, presets, entity types, block descriptors | `InternalError` "Duplicate authoring ... helper", names both components | `fw-components/control/control-stack.ts:199-217, 240, 244` |
| The same within the merge | constructors, presets | `CONTRACT.PACK_CONTRIBUTION_INVALID` "Duplicate authoring" | `fw-components/shared/framework-authoring.ts:915-923` |
| Path segments are not `__proto__`, `constructor`, `prototype` | all | `CONTRACT.PACK_CONTRIBUTION_INVALID` | `framework-authoring.ts:884-894` |
| A leaf is a well-formed descriptor: `kind` matches and `output` is an object | constructors, presets | `CONTRACT.PACK_CONTRIBUTION_INVALID` "malformed value" | `framework-authoring.ts:781-790, 925-930` |
| A plain constructor declares `output.nativeType` | constructors without `entityRefArg` | `Error` "declares no storage type template" | `framework-authoring.ts:1101-1105` |
| Every argument reference in `output.typeParams` points at a declared argument | constructors without `entityRefArg` | `Error` "references argument N" | `framework-authoring.ts:1106-1114`, called at `control-stack.ts:245` |
| A path is not both a constructor and a preset, nor an entity type and either | all three | `CONTRACT.PACK_CONTRIBUTION_INVALID` "Ambiguous authoring registry path" | `framework-authoring.ts:1392-1430` |
| Every `select` template targets an option argument and its cases equal the option's values | constructors, presets, entity templates | `CONTRACT.PACK_CONTRIBUTION_INVALID` | `framework-authoring.ts:1482-1570`, called at 1434 |
| One `valueObjectStorageType` per stack, naming a bare constructor | stack | `InternalError` | `control-stack.ts:225-238, 311-319` |
| Every codec names a registered data type | codecs | `CONTRACT.DATA_TYPE_UNREGISTERED` | `control-stack.ts:427-431` |
| One owner per data type id | data types | `CONTRACT.DATA_TYPE_DUPLICATE` | `control-stack.ts:345-360` |
| One owner per codec id | codecs | from `assertUniqueCodecOwner` | `control-stack.ts:622-629` |

Checks at the time a constructor or preset is called, not at assembly:

| Check | Failure | file:line |
| --- | --- | --- |
| Argument count is within the required and declared range | `CONTRACT.ARGUMENT_INVALID` | `framework-authoring.ts:1733-1753` |
| Argument kind, integer, minimum, maximum, option value, object keys | `CONTRACT.ARGUMENT_INVALID` | `framework-authoring.ts:1616-1731`, bounds at 1713-1730 |
| The template has `nativeType` | `CONTRACT.PACK_CONTRIBUTION_INVALID` | `framework-authoring.ts:1763-1769` |
| Resolved `typeParams` is an object | `CONTRACT.PACK_CONTRIBUTION_INVALID` | `framework-authoring.ts:1774-1779` |
| An entity reference constructor's codec has a `columnFromEntity` hook | `CONTRACT.PACK_CONTRIBUTION_INVALID`, thrown when a schema uses the constructor | `contract-psl/psl-column-resolution.ts:338-346` |

Not a check at assembly: `validateScalarTypeCodecIds` (`control-stack.ts:686-699`) is called only from tests. It covers bare constructors only, and it tests `codecLookup.get(codecId)`, which has no entry for a codec whose factory needs parameters (`control-stack.ts:648-663`), so it would wrongly report `pg/vector@1`. No check of any kind looks at a preset's codec.

### 10.2 New checks the decisions require

Each names the contributing component and the id at fault, as ADR 254 "Assembly" requires.

| # | Check | Source decision | Notes for the implementer |
| --- | --- | --- | --- |
| 1 | Every type constructor's `output.codecId` is a codec registered in the stack, including constructors under a namespace, with required arguments, or with `entityRefArg` | Decision 5 | Test with `codecLookup.descriptorFor(codecId)`, not `get`. Replaces `validateScalarTypeCodecIds` |
| 2 | Every field preset's `output.codecId` is a registered codec | Decision 8 with the brief | Same test |
| 3 | A constructor or preset template has no `nativeType` key | Decision 5 | Replaces the check at `framework-authoring.ts:1101-1105` and the run-time check at 1763-1769. A plain constructor then needs only a codec |
| 4 | Every key a constructor or preset writes into `typeParams` is a key of the parameter schema of its codec's data type, or a key the codec declares for itself | Decisions 4 and 5 | Today nothing checks the keys |
| 5 | A constructor or preset argument that feeds a data type parameter declares no bounds of its own; the argument is validated by the data type's parameter schema when the constructor is called | Decision 5 | Deletes `minimum`, `maximum`, `integer` from those arguments. The argument descriptor keeps `name`, `kind`, `optional`. Bounds stay on arguments that do not feed a data type parameter: the `size` of the `nanoid` presets feeds a generator parameter as well as `length` |
| 6 | Every data type that has at least one constructor marks exactly one constructor as the one `contract infer` prints; the marked constructor exists in the stack and its codec represents that data type | "`contract infer` and unknown types" | Zero marks and two marks are both refused. A data type with no constructor needs no mark |
| 7 | No two data types in one stack claim the same reported text, through name or other names | "Resolving a reported type is family code" | See DN-8: SQLite's current data types fail this check |
| 8 | A `valueObjectStorageType` names a bare constructor | exists | unchanged |

Checks the decisions require at contract load, not at assembly: each column's codec represents the column's `dataType` (decision 3), and a column or `storage.types` entry carrying `nativeType` is refused (Q1b).

Data the checks need that does not exist yet: the framework `DataType` has `id`, `casts` and `listCast` only (`fw-components/shared/data-type.ts:40-45`); the parameter schema, the name, the other names, the rendering, the reading of reported texts and the mark of the printed constructor are all new.

## 11. Function registries

### 11.1 Functions

The two files are `pg-adapter/core/control-mutation-defaults.ts` (P) and `sqlite-adapter/core/control-mutation-defaults.ts` (S). The Mongo target registers an empty function registry (`packages/3-mongo-target/1-mongo-target/src/core/descriptor-meta.ts:12-15`).

| Function | Signature today | Lowering | `usageSignatures` | Function documentation | Parameter documentation | Lines P | Lines S |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `autoincrement` | no parameters | storage default, function `autoincrement()` | `autoincrement()` | "Generates an increasing integer value in the database." | none | sig 87-89, lower 37-45, entry 119-126 | sig 91-93, lower 41-49, entry 123-130 |
| `now` | no parameters | storage default, function `now()` | `now()` | "Uses the current database timestamp as the default value." | none | sig 84-86, lower 47-55, entry 127 | sig 88-90, lower 51-59, entry 131 |
| `uuid` | `version: optional(oneOf(num(4), num(7)))` | generator `uuidv7` when `version === 7`, else `uuidv4` | `uuid()`, `uuid(4)`, `uuid(7)` | "Generates a UUID when a value is not supplied." | "The UUID version: `4` or `7`. Defaults to `4`." | sig 91-100, lower 61-68, entry 128-131 | sig 95-104, lower 65-72, entry 132-135 |
| `cuid` | `version: num(2)`, required | generator `cuid2`; the argument is not read | `cuid(2)` | "Generates a CUID2 identifier when a value is not supplied." | "The CUID version. Only `2` is supported." | sig 101-106, lower 70-72, entry 132 | sig 105-110, lower 74-76, entry 136 |
| `ulid` | no parameters | generator `ulid` | `ulid()` | "Generates a ULID when a value is not supplied." | none | sig 90, lower 57-59, entry 133 | sig 94, lower 61-63, entry 137 |
| `nanoid` | `size: optional(int({min: 2, max: 255}))` | generator `nanoid` with `{size}` when `size` is a number, else without parameters | `nanoid()`, `nanoid(<2-255>)` | "Generates a Nano ID when a value is not supplied." | "The identifier length, from `2` through `255`. Omit to use the generator default." | sig 107-117, lower 74-82, entry 134-137 | sig 111-121, lower 78-86, entry 138-141 |

`usageSignatures` is read in one place, to list supported functions in a diagnostic (`contract-psl/default-function-registry.ts:23-33`).

### 11.2 Duplicated parts

| Part | Postgres adapter | SQLite adapter | Identical |
| --- | --- | --- | --- |
| `executionGenerator` helper | 20-35 | 24-39 | yes |
| Six lowering functions | 37-82 | 41-86 | yes |
| Six signatures with documentation | 84-117 | 88-121 | yes |
| Registry entries | 118-138 | 122-142 | yes, apart from the constant's name |
| `create...DefaultFunctionRegistry` | 362-367 | 195-200 | yes |
| `create...MutationDefaultGeneratorDescriptors` | 369-381, adds `instantNow` and `plainDateTimeNow` | 202-212 | differs only in the two extra descriptors |

The Prisma 7 reader holds a third copy of the parameter names: `FUNCTION_ARGUMENT_KEYS` (`packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts:68-75`). It maps positional arguments by hand and calls `entry.lower` without the signature (`defaults.ts:342-375`), so `nanoid(1000)` and `uuid(5)` pass. It also forces `cuid`'s version to 2 (`defaults.ts:366`).

### 11.3 The data type each parameter names under the agreement

Under "Agreement with the SQL expression literals project", each parameter becomes one `dataTypeValue` parameter (the building block of ticket TML-3367) with a further check. The SQL family exports the shared signature builder; each target passes its own data type id.

| Function | Parameter | Optional | Data type on Postgres | Data type on SQLite | Further check the function owns |
| --- | --- | --- | --- | --- | --- |
| `uuid` | `version` | yes | `pg/int4` | `sqlite/integer` | the value is 4 or 7 |
| `cuid` | `version` | no | `pg/int4` | `sqlite/integer` | the value is 2 |
| `nanoid` | `size` | yes | `pg/int4` | `sqlite/integer` | the value is from 2 to 255 |
| `autoincrement`, `now`, `ulid` | none | | | | |

On Postgres a written `4` is classified as the smallest integer type that holds it. `pg/int4` casts from `pg/int2` (`pg-target/core/data-types.ts:64`), so the cast rule admits it. `sqlite/integer` has no casts (`sqlite-target/core/data-types.ts:54`), so the SQLite classifier must give `sqlite/integer` for these values. It does: a written number within the safe integer range is classified as `sqlite/integer` (`sqlite-target/core/data-type-entries.ts:28`).

### 11.4 Generator metadata, `packages/1-framework/2-authoring/ids/src/index.ts`

| Generator | `applicableCodecIds` | Line |
| --- | --- | --- |
| `ulid` | `pg/text@1`, `sql/char@1` | 51 |
| `nanoid` | `pg/text@1`, `sql/char@1` | 55 |
| `uuidv7` | `pg/text@1`, `sql/char@1`, `pg/uuid@1` | 59 |
| `uuidv4` | `pg/text@1`, `sql/char@1`, `pg/uuid@1` | 63 |
| `cuid2` | `pg/text@1`, `sql/char@1` | 67 |
| `ksuid` | `pg/text@1`, `sql/char@1` | 71 |

Both adapters copy the list unchanged into their generator descriptors (`pg-adapter/core/control-mutation-defaults.ts:371-376`, `sqlite-adapter/core/control-mutation-defaults.ts:204-209`). The only reader is the PSL default lowering, which refuses a generator whose list does not include the column's codec (`contract-psl/psl-column-resolution.ts:763-779`). The framework package names Postgres codec ids. No SQLite codec is in any list, so on SQLite `String @default(uuid())`, whose column codec is `sqlite/text@1`, is refused by the check at line 772. `sql/varchar@1` is in no list either. See DN-16.

### 11.5 The copies of the nanoid range

| # | Copy | file:line |
| --- | --- | --- |
| 1 | PSL signature, Postgres adapter | `pg-adapter/core/control-mutation-defaults.ts:112` |
| 1b | PSL signature, SQLite adapter, identical | `sqlite-adapter/core/control-mutation-defaults.ts:116` |
| 2 | TypeScript helper `nanoid()` | `packages/1-framework/2-authoring/ids/src/index.ts:33` |
| 3 | Field presets `nanoid` and `id.nanoid` | `sql-family/core/authoring-field-presets.ts:35-36` |
| text | The range restated in words | `usageSignatures` at P 136 and S 140; parameter documentation at P 113-114 and S 117-118; error message at `ids/src/index.ts:36` |

The default length 21 is written twice in the presets (`authoring-field-presets.ts:73, 161`) and once in the helper (`ids/src/index.ts:31`).

## 12. Every DECISION NEEDED item

| # | Fact | Recommended answer | Reason |
| --- | --- | --- | --- |
| DN-1 | No constructor exists for data type `pg/bit`. Infer prints `Unsupported("bit(n)")`. After the decisions infer cannot print the column | Add `Bit(length?)`, codec `pg/bit@1`, `typeParams.length` from argument 0, marked as printed | The TS helper `bitColumn` exists. The name follows `Char`: the PostgreSQL type name in Pascal case |
| DN-2 | No constructor for `pg/varbit` | Add `VarBit(length?)`, codec `pg/varbit@1`, marked | Follows `VarChar` for `character varying` |
| DN-3 | No constructor for `pg/interval` | Add `Interval(precision?)`, codec `pg/interval@1`, marked | Follows `Time(precision?)` |
| DN-4 | No constructor for `pg/tsquery` | Add `Tsquery`, codec `pg/tsquery@1`, marked | Follows `Timestamptz` and `Timetz`: one capital letter for a one-word PostgreSQL name |
| DN-5 | `pg/text-array` has no constructor, and a `text[]` column is introspected as `text` with `many: true` (`control-adapter.ts:1081-1084`) | Add no constructor. `pg/text-array` claims no reported text. The resolver removes a trailing `[]`, resolves the element, and reports a list | It reproduces today's output `String[]`, and no contract column uses this codec; it types operation results and control tables (`pg-target/contract-free/columns.ts:29`) |
| DN-6 | `pgvector.Vector` requires `length` and the codec requires it, but PostgreSQL allows a `vector` column with no dimension | Keep `length` required. `pgvector/vector` claims `vector(n)` only. Infer fails on a bare `vector` column, naming it | The run-time codec validates the length of every value, so it cannot work without one |
| DN-7 | `postgis.Geometry(srid)` requires `srid`; the codec and the TS helper `geometryColumn` allow none. The database reports `geometry`, `geometry(Geometry,4326)`, and subtypes such as `geometry(Point,4326)`. The rendering writes `geometry(Geometry,<srid>)` only | Make `srid` optional on the constructor, so `postgis.Geometry` prints for `geometry`. The data type claims `geometry` and `geometry(Geometry,<srid>)`. A column with another subtype is claimed by nothing and makes infer fail | The constructor then matches its codec and its TS helper. Dropping the subtype would make the contract differ from the database, and verify compares exactly |
| DN-8 | On SQLite three data types render `text` (`sqlite/text`, `sqlite/datetime`, `sqlite/json`) and two render `integer` (`sqlite/integer`, `sqlite/bigint`). The rule "no two data types claim one reported text" refuses the SQLite stack as it is, and introspection cannot choose an id from the text `text`. `research.md` does not record this | Needs Will. Recommended: a SQL data type may declare that it is stored as another data type of its target. It renders that type's name and claims no text. Introspection reports the stored type, and verify compares the stored type's id and parameters | It keeps DDL unchanged and keeps the comparison exact. The alternative, new names such as `DATETIME` and `JSON`, changes SQLite's type affinity for those columns to NUMERIC and changes every SQLite migration |
| DN-9 | The `character` case has a twin. `sql.String(n)` on SQLite stores `character varying` with codec `sql/varchar@1`, whose data type is `sqlite/text` | The SQLite target declares a data type named `character varying` next to the decided `character`, and the SQLite adaptations of `sql/char@1` and `sql/varchar@1` name them (`sqlite-target/core/codecs.ts:236-244`) | Same reason as the decided case: rendering must not change |
| DN-10 | Bounds differ between constructors and codecs (section 1.9), and the data type's parameter schema becomes the one source | `pg/char`, `pg/varchar`: `length` 1 to 10485760. `pg/bit`, `pg/varbit`: `length` 1 to 83886080. `pg/numeric`: `precision` 1 to 1000, `scale` 0 to 1000. Temporal types and `pg/interval`: `precision` 0 to 6. `pgvector/vector`: `length` 1 to 16000, required. `postgis/geometry`: `srid` 0 or more. The SQLite `character` types: `length` 1 or more, no maximum | These are the limits PostgreSQL enforces, and the codec schemas already hold most of them. `VarChar(20000000)` and `Timestamp(9)`, accepted by the constructor today, are then refused where they are written |
| DN-11 | The temporal presets declare `precision` with `minimum: 0` in a shared constant (`sql-family/core/timestamp-now-generator.ts:22-28`) | Delete the bound there too; the preset argument is validated by the data type's schema | Same rule as constructors, so one source |
| DN-12 | `pg/enum`'s name is the user's type name, which the data type cannot declare. Infer finds enum columns from the list of enum types in the introspected schema (`postgres-type-map.ts:82-84`) | The family resolver receives the introspected schema's user-defined enum type names. A reported text in that list resolves to `pg/enum` with `{typeName}` | The resolver still holds no list of type names in code, and no target-specific branch: the list is data read from the database |
| DN-13 | An `enum` block may name any codec in `@@type`. Some data types need parameters (`pg/enum`, `pgvector/vector`) | Refuse an `enum` block whose codec's data type has a required parameter, naming the parameter | The block has no place to write parameters, and the column would fail the contract's parameter check later |
| DN-14 | `inferPslContract` receives no stack, so it cannot read data types, constructors or marks | Pass it the same `SqlPslBuildContext` that `buildPslContract` receives | The context already carries `authoringContributions` and `codecLookup`, and `contract print` already uses it |
| DN-15 | The contract validator accepts a value object column when `nativeType` is `json` or `jsonb`. It has no stack | Compare `column.dataType` with the set `pg/json`, `pg/jsonb`, `sqlite/json` | Decision 3 says code without a stack compares `dataType`. The set must include the SQLite type once the TS path uses the declared constructor (section 8) |
| DN-16 | `applicableCodecIds` lives in the framework, names Postgres codecs, and contains no SQLite codec | Each target passes the data type ids a generator applies to, the same way it passes the parameter's data type: text generators apply to `pg/text`, `pg/char`, `pg/varchar` on Postgres and to `sqlite/text` and the two character types on SQLite; the UUID generators add `pg/uuid` | It follows constraint 2 of the agreement: a spec shared by targets never names one target's id. It also makes the check independent of which codec represents the type |

## 13. Statements in `design-notes.md` that the code contradicts

| Statement | What the code shows |
| --- | --- |
| "the eleven Mongo data types" (Q11, decision 11) | There are twelve (`packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:9-35`) |
| "the eleven Mongo data types take their BSON type names" | `mongo/json` has eight BSON type names and `mongo/bson` has none (`packages/3-mongo-target/1-mongo-target/src/core/codecs.ts:315, 320`), so a Mongo data type holds a list of names that may be empty |
| "assembly refuses two data types in one stack that claim the same text" | The SQLite stack has three data types named `text` and two named `integer` (DN-8) |
| "The SQLite target declares a data type named `character`" as the only SQLite case | `character varying` is a second case (DN-9) |
| Q8: "`vector` and `geometry` ... start printing `pgvector.Vector(n)` and `postgis.Geometry(srid)`" | True only for columns with a dimension or an SRID and the `Geometry` subtype (DN-6, DN-7) |
| "The resolver, verify and `contract infer` contain no list of type names" | Native enum columns can only be recognised from the list of enum types read from the database (DN-12) |
| Brief: `inet?` among the types infer prints as `Unsupported` | Infer prints `Inet` (`postgres-type-map.ts:23`) |
| Q2: the repository forbids `nativeType` in `packages/1-framework` | The word is in framework code today: `ColumnTypeDescriptor.nativeType` (`column-spec.ts:22`), `AuthoringStorageTypeTemplate.nativeType` (`framework-authoring.ts:100`), `ScalarTypeConstructorOutput.nativeType` (`framework-authoring.ts:1016`). The decisions delete all three |
| Decision 6: TypeScript column helpers keep their public import paths | The paths contain the word `adapter` (`@prisma/orm-postgres/adapter/column-types`), so the helpers stay exported from the adapter packages while the constructors move to the targets |
