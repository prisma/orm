# Inventory: every data type, its names, parameters and codecs

Made on 2026-09-29 from branch `data-types-completion` at `bf96e11eec`. It lists what the code and a real database do today, so the design document can state each data type's declaration without further research. Paths are relative to the repository root.

## How the facts were gathered

- **Code.** Every row cites the file and line it was read from.
- **Committed contracts.** `wip/data-types-inventory/scan-contracts.mjs` walks every committed `contract.json` and `expected-contract.json` and lists each distinct combination of target, codec id, `nativeType`, `many` and parameter keys. Output: `wip/data-types-inventory/contract-native-types.txt`.
- **Postgres.** A temporary integration test (deleted afterwards) started the repository's dev database with `createTestDatabase()`, created one table per type text, and recorded `format_type(atttypid, atttypmod)`, `information_schema.columns.data_type`, `udt_name`, and the `nativeType`, `many` and `resolvedNativeType` that `familyInstance.introspect()` returns. It also tried each out-of-range parameter. Raw output: `wip/data-types-inventory/postgres-raw.json`. The same data as one line per type: `wip/data-types-inventory/postgres-summary.txt`. The database was PostgreSQL 17.5 (PGlite).
- **SQLite.** `wip/data-types-inventory/sqlite-probe.mjs` used `node:sqlite` (SQLite 3.50.4), the same library the SQLite driver uses (`packages/3-targets/7-drivers/sqlite/src/core/control-driver.ts:2`). Raw output: `wip/data-types-inventory/sqlite-raw.json`.
- **Not verified on a database.** The dev database has no PostGIS (`CREATE EXTENSION postgis` fails with `extension "postgis" is not available`, `postgres-raw.json` key `setup`). Every PostGIS statement below about what the database reports comes from code and committed migrations, and is marked "not verified". pgvector was available and was verified.

Terms used in the tables:

- **Name**: the string contracts store today as `nativeType`.
- **Reported text**: what `format_type` prints. This is the text today's introspection starts from (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:783, 1052-1056`).
- **Adapter today**: the `nativeType` that today's introspection returns after `normalizeFormattedType` (`control-adapter.ts:1482-1532`).
- **Flag Fn**: a disagreement, listed in section G. **DECISION NEEDED Dn**: an open fact, listed in section H.

## Counts

47 data types are registered today: Postgres 26, SQLite 7, pgvector 1, postgis 1, Mongo 12. `design-notes.md` and `research.md` say Mongo has eleven; `mongo/bson` was added since (`packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:20`).

## 1. Postgres target

Data types are declared in `packages/3-targets/3-targets/postgres/src/core/data-types.ts:56-118`. Codec descriptors are in `packages/3-targets/3-targets/postgres/src/core/codecs.ts`, `temporal-codecs.ts`, `temporal-string-codecs.ts` and `date-codecs.ts` in the same directory. Rendering hooks are in `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts:66-141`, registered per codec at `:201-223`.

Shared cast values used below (`data-types.ts`): `unchanged` returns the value (`:17`); `asNumeralText` turns a JSON number into digit text (`:31-32`); `asFloat` turns digit text into a number, keeps `NaN`, `Infinity`, `-Infinity` as text, and refuses a magnitude no double holds (`:40-54`); `asFloat4` is `asFloat` plus a refusal past single precision (`:79-90`); `fromText` is `{pg/text: unchanged}` (`:104`). No Postgres data type declares a `listCast`.

### 1.1 Identity, names, codecs and casts

| Data type id | Name | Other names the database reports or accepts | Codecs (`targetTypes` today) | Casts today |
| --- | --- | --- | --- | --- |
| `pg/text` | `text` | none. Reported: `text`; `data_type` `text`; `udt_name` `text` | `pg/text@1` (`['text']`, `codecs.ts:386`); `sql/text@1` (`['text']`, `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts:75`, adapted at `codecs.ts:348-352`) | none (`data-types.ts:56`) |
| `pg/text-array` | none stored; no column uses it (section D) | the codec's `targetTypes` is `['text[]']` | `pg/text-array@1` (`['text[]']`, `codecs.ts:591`) | none (`:57`) |
| `pg/enum` | the enum's own type name, per column (section B) | per column (section B) | `pg/enum@1` (`['text']`, `codecs.ts:476`). Flag F9 | none (`:58`) |
| `pg/int2` | `int2` | `smallint` (reported by `format_type` and `data_type`; accepted as input). `udt_name` `int2`. `smallserial` is accepted as input and is not a type; it reports `smallint` | `pg/int2@1` (`['int2']`, `codecs.ts:682`) | none (`:59`) |
| `pg/bool` | `bool` | `boolean` (reported and accepted). `udt_name` `bool` | `pg/bool@1` (`['bool']`, `codecs.ts:943`) | none (`:60`) |
| `pg/json` | `json` | none | `pg/json@1` (`['json']`, `codecs.ts:1537`) | none (`:61`) |
| `pg/tsquery` | none stored; no column uses it (section D). The database's name is `tsquery` | none. Reported: `tsquery` | `pg/tsquery@1` (`['tsquery']`, `codecs.ts:1427`) | none (`:62`) |
| `pg/int4` | `int4` | `integer` (reported and accepted), `int` (accepted). `udt_name` `int4`. `serial` is accepted and reports `integer` | `pg/int4@1` (`['int4']`, `codecs.ts:632`); `pg/int@1` (`['int4']`, `codecs.ts:1695`); `sql/int@1` (`['int']`, `sql-codecs.ts:113`, adapted at `codecs.ts:336-340`). Flag F9 | `pg/int2`: `unchanged` (`:64`) |
| `pg/int8` | `int8` | `bigint` (reported and accepted). `udt_name` `int8`. `bigserial` is accepted and reports `bigint` | `pg/int8@1` (`['int8']`, `codecs.ts:743`); `pg/int8number@1` (**empty**, `codecs.ts:799`) | `pg/int2`: `asNumeralText`; `pg/int4`: `asNumeralText` (`:66-68`) |
| `pg/numeric` | `numeric` | `decimal`, `dec` (accepted only; the database never reports them). Reported: `numeric`, `numeric(p,s)` | `pg/numeric@1` (`['numeric','decimal']`, `codecs.ts:1005`); `pg/unboundedint@1` (**empty**, `codecs.ts:1066`) | `pg/int2`: `asNumeralText`; `pg/int4`: `asNumeralText`; `pg/int8`: `unchanged` (`:70-76`) |
| `pg/float4` | `float4` | `real` (reported and accepted), `float(1)` to `float(24)` (accepted). `udt_name` `float4` | `pg/float4@1` (`['float4']`, `codecs.ts:847`) | `pg/int2`, `pg/int4`, `pg/int8`, `pg/numeric`: `asFloat4` (`:92-99`) |
| `pg/float8` | `float8` | `double precision` (reported and accepted), `float`, `float(25)` to `float(53)` (accepted). `udt_name` `float8` | `pg/float8@1` (`['float8']`, `codecs.ts:895`); `pg/float@1` (`['float8']`, `codecs.ts:1722`); `sql/float@1` (`['float']`, `sql-codecs.ts:151`, adapted at `codecs.ts:342-346`). Flag F9 | `pg/int2`, `pg/int4`, `pg/int8`, `pg/numeric`: `asFloat` (`:92-100`) |
| `pg/jsonb` | `jsonb` | none | `pg/jsonb@1` (`['jsonb']`, `codecs.ts:1582`); `arktype/json@1` (`['jsonb']`, `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:220-223`) | `pg/json`: `unchanged` (`:102`) |
| `pg/char` | `character` | `char` (accepted), `bpchar` (accepted; reported by `format_type` only for a column declared as bare `bpchar`). `udt_name` `bpchar`; `data_type` `character` | `pg/char@1` (`['character']`, `codecs.ts:1630`); `sql/char@1` (`['char']`, `sql-codecs.ts:189`, adapted at `codecs.ts:324-328`). Flag F9 | `fromText` (`:106`) |
| `pg/varchar` | `character varying` | `varchar` (accepted). `udt_name` `varchar`. Reported: `character varying` | `pg/varchar@1` (`['character varying']`, `codecs.ts:1660`); `sql/varchar@1` (`['varchar']`, `sql-codecs.ts:230`, adapted at `codecs.ts:330-334`). Flag F9 | `fromText` (`:107`) |
| `pg/uuid` | `uuid` | none | `pg/uuid@1` (`['uuid']`, `codecs.ts:1317`) | `fromText` (`:108`) |
| `pg/inet` | `inet` | none | `pg/inet@1` (`['inet']`, `codecs.ts:1364`) | `fromText` (`:109`) |
| `pg/bit` | `bit` | none. `udt_name` `bit` | `pg/bit@1` (`['bit']`, `codecs.ts:1172`) | `fromText` (`:110`) |
| `pg/varbit` | `bit varying` | `varbit` (accepted). `udt_name` `varbit`. Reported: `bit varying` | `pg/varbit@1` (`['bit varying']`, `codecs.ts:1222`) | `fromText` (`:111`) |
| `pg/timetz` | `timetz` | `time with time zone` (reported and accepted). `udt_name` `timetz` | `pg/timetz@1` (`['timetz']`, `codecs.ts:1121`) | `fromText` (`:112`) |
| `pg/interval` | `interval` | none for the plain form. Forms with fields (`interval year to month`) are in section F | `pg/interval@1` (`['interval']`, `codecs.ts:1488`) | `fromText` (`:113`) |
| `pg/bytea` | `bytea` | none | `pg/bytea@1` (`['bytea']`, `codecs.ts:1270`) | `fromText` (`:114`) |
| `pg/date` | `date` | none | `pg/date-temporal@1` (`['date']`, `temporal-codecs.ts:69`); `pg/date-string@1` (**empty**, `temporal-string-codecs.ts:61`) | `fromText` (`:115`) |
| `pg/time` | `time` | `time without time zone` (reported and accepted). `udt_name` `time` | `pg/time-temporal@1` (`['time']`, `temporal-codecs.ts:230`); `pg/time-string@1` (**empty**, `temporal-string-codecs.ts:226`) | `fromText` (`:116`) |
| `pg/timestamp` | `timestamp` | `timestamp without time zone` (reported and accepted). `udt_name` `timestamp` | `pg/timestamp-temporal@1` (`['timestamp']`, `temporal-codecs.ts:118`); `pg/timestamp-string@1` (**empty**, `temporal-string-codecs.ts:109`) | `fromText` (`:117`) |
| `pg/timestamptz` | `timestamptz` | `timestamp with time zone` (reported and accepted). `udt_name` `timestamptz` | `pg/timestamptz-temporal@1` (`['timestamptz']`, `temporal-codecs.ts:175`); `pg/timestamptz-string@1` (**empty**, `temporal-string-codecs.ts:168`); `pg/timestamptz-date@1` (**empty**, `date-codecs.ts:130`) | `fromText` (`:118`) |

Every stored name above was checked against committed contracts (`wip/data-types-inventory/contract-native-types.txt`) and against the constructors' `output.nativeType` (`packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:148-355`, `packages/3-targets/3-targets/postgres/src/core/authoring.ts:111-130`, `packages/2-sql/9-family/src/core/authoring-type-constructors.ts:9-15`) and the TypeScript column helpers (`packages/3-targets/6-adapters/postgres/src/exports/column-types.ts:38-237`). On Postgres no two codecs of one data type store different names. `pg/char@1`, `pg/varchar@1` occur in one committed contract each; `pg/int@1` and `pg/float@1` occur in none.

The Postgres codec hook `nativeType(params)` uses these names, which differ from the stored names and are deleted by engineering decision 2: `integer`, `smallint`, `bigint`, `real`, `double precision`, `boolean` (`codecs.ts:162-175`). For the other types the hook returns the stored name.

### 1.2 Parameters

Three places check parameters today: the codec's parameter schema, the PSL type constructor's argument descriptor, and the rendering hook. "Database" is what PostgreSQL 17.5 accepted (`postgres-summary.txt`, section `BOUNDS`).

| Data type | Parameter | Codec schema | PSL constructor | Rendering hook | Database | Bound to keep |
| --- | --- | --- | --- | --- | --- | --- |
| `pg/numeric` | `precision`, integer, optional | 1 to 1000 (`codecs.ts:157-160`) | `Numeric(precision?, scale?)`: minimum 1, no maximum (`control-mutation-defaults.ts:227`) | integer greater than 0, no maximum (`descriptor-meta.ts:112-120`) | 1 to 1000: `numeric(0)` and `numeric(1001)` fail with "NUMERIC precision … must be between 1 and 1000" | 1 to 1000. Flag F1 |
| `pg/numeric` | `scale`, integer, optional, needs `precision` | 0 or more, no maximum, does not require `precision` (`codecs.ts:159`) | minimum 0, no maximum (`control-mutation-defaults.ts:228`) | 0 or more; refuses `scale` without `precision` (`descriptor-meta.ts:104-110, 121-130`) | -1000 to 1000: `numeric(10,1001)` and `numeric(10,-1001)` fail; `numeric(10,-1)` and `numeric(10,11)` are accepted | DECISION NEEDED D4. Flag F2 |
| `pg/char`, `pg/varchar` | `length`, integer, optional | greater than 0, no maximum (`sql-codecs.ts:48-50`, reused at `codecs.ts:1632, 1662`) | `Char(length?)`, `VarChar(length?)`: minimum 1, no maximum (`control-mutation-defaults.ts:206, 216`); `sql.String(length)`: 1 to 10485760, required (`authoring-type-constructors.ts:8`) | integer greater than 0 (`descriptor-meta.ts:66-79`) | 1 to 10485760: `varchar(0)`, `char(0)` fail with "must be at least 1"; `varchar(10485761)`, `char(10485761)` fail with "cannot exceed 10485760" | 1 to 10485760. Flag F3 |
| `pg/bit`, `pg/varbit` | `length`, integer, optional | greater than 0, no maximum (`codecs.ts:153-155`) | no constructor exists | integer greater than 0 (`descriptor-meta.ts:66-79`) | 1 to 83886080: `bit(0)`, `varbit(0)` fail; `bit(83886081)`, `varbit(83886081)` fail with "cannot exceed 83886080" | 1 to 83886080. Flag F4 |
| `pg/timestamp`, `pg/timestamptz`, `pg/time`, `pg/timetz` | `precision`, integer, optional | 0 to 6 (`packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts:19-21`) | `Timestamp`, `Timestamptz`, `Time`, `Timetz` and the `*String`, `*JsDate` variants: minimum 0, no maximum (`control-mutation-defaults.ts:242-348`) | any non-negative integer (`descriptor-meta.ts:81-94`) | accepts any non-negative integer and stores 6 for anything larger: `timestamp(7)` creates `timestamp(6) without time zone`. `timestamp(-1)` is a syntax error | 0 to 6. A larger value would be stored as 6 and then fail exact comparison. Flag F5 |
| `pg/interval` | `precision`, integer, optional | 0 to 6 (`codec-helpers.ts:19-21`, used at `codecs.ts:1489`) | no constructor exists | any non-negative integer (`descriptor-meta.ts:217`) | same as above: `interval(7)` creates `interval(6)` | 0 to 6. Flag F5 |
| `pg/date` | none | `pg/date-temporal@1` and `pg/date-string@1` have no schema (`temporal-codecs.ts:70`, `temporal-string-codecs.ts:62`) | `Date`, `DateString` take no arguments | none | | |
| `pg/enum` | `typeName`, string, required | `{typeName: string}` (`codecs.ts:462-464`) | `pg.enum(Ref)` (`authoring.ts:132-140`) | none registered; the planner quotes the name (section B) | | section B |
| `pg/jsonb` | none owned by the data type | `arktype/json@1` declares `expression` and `jsonIr`, which are codec parameters (`arktype-json-codec.ts:207-210`) | TypeScript only | identity (`packages/3-extensions/arktype-json/src/exports/control.ts:24`) | | engineering decision 4 covers this |

All other Postgres data types have no parameters: their codecs set `paramsSchema = undefined`.

### 1.3 How the name is written, and what the database reports back

"Written" is the output of today's hook for that parameter object. "Reported" is `format_type`. "Reads as" is the data type id and parameters the reported text must yield.

| Data type | Parameters | Written today | Reported by the database | Adapter today | Reads as |
| --- | --- | --- | --- | --- | --- |
| `pg/text` | none | `text` | `text` | `text` | `pg/text` `{}` |
| `pg/int2` | none | `int2` | `smallint` | `int2` | `pg/int2` `{}` |
| `pg/int4` | none | `int4` | `integer` | `int4` | `pg/int4` `{}` |
| `pg/int8` | none | `int8` | `bigint` | `int8` | `pg/int8` `{}` |
| `pg/float4` | none | `float4` | `real` | `float4` | `pg/float4` `{}` |
| `pg/float8` | none | `float8` | `double precision` | `float8` | `pg/float8` `{}` |
| `pg/bool` | none | `bool` | `boolean` | `bool` | `pg/bool` `{}` |
| `pg/json`, `pg/jsonb`, `pg/uuid`, `pg/inet`, `pg/bytea`, `pg/date`, `pg/tsquery` | none | the name | the name | the name | the type, `{}` |
| `pg/numeric` | `{}` | `numeric` | `numeric` | `numeric` | `pg/numeric` `{}` |
| `pg/numeric` | `{precision: 10}` | `numeric(10)` | `numeric(10,0)` | `numeric(10,0)` | DECISION NEEDED D2. Flag F6 |
| `pg/numeric` | `{precision: 10, scale: 2}` | `numeric(10,2)` (no space) | `numeric(10,2)` | `numeric(10,2)` | `pg/numeric` `{precision: 10, scale: 2}` |
| `pg/numeric` | `{scale: 2}` | refused: "scale requires precision" (`descriptor-meta.ts:104-110`) | | | |
| `pg/char` | `{}` | `character` | `character(1)` | `character(1)` | DECISION NEEDED D3. Flag F7 |
| `pg/char` | `{length: 5}` | `character(5)` | `character(5)` | `character(5)` | `pg/char` `{length: 5}` |
| `pg/char` | column declared by hand as `bpchar` | not written by Prisma | `bpchar` | `character` | DECISION NEEDED D3 |
| `pg/varchar` | `{}` | `character varying` | `character varying` | `character varying` | `pg/varchar` `{}` |
| `pg/varchar` | `{length: 255}` | `character varying(255)` | `character varying(255)` | `character varying(255)` | `pg/varchar` `{length: 255}` |
| `pg/bit` | `{}` | `bit` | `bit(1)` | `bit(1)` | DECISION NEEDED D3. Flag F7 |
| `pg/bit` | `{length: 8}` | `bit(8)` | `bit(8)` | `bit(8)` | `pg/bit` `{length: 8}` |
| `pg/varbit` | `{}` | `bit varying` | `bit varying` | `bit varying` | `pg/varbit` `{}` |
| `pg/varbit` | `{length: 8}` | `bit varying(8)` | `bit varying(8)` | `bit varying(8)` | `pg/varbit` `{length: 8}` |
| `pg/time` | `{}` | `time` | `time without time zone` | `time` | `pg/time` `{}` |
| `pg/time` | `{precision: 3}` | `time(3)` | `time(3) without time zone` | `time(3)` | `pg/time` `{precision: 3}` |
| `pg/timetz` | `{}` | `timetz` | `time with time zone` | `timetz` | `pg/timetz` `{}` |
| `pg/timetz` | `{precision: 3}` | `timetz(3)` | `time(3) with time zone` | `timetz(3)` | `pg/timetz` `{precision: 3}` |
| `pg/timestamp` | `{}` | `timestamp` | `timestamp without time zone` | `timestamp` | `pg/timestamp` `{}` |
| `pg/timestamp` | `{precision: 3}` | `timestamp(3)` | `timestamp(3) without time zone` | `timestamp(3)` | `pg/timestamp` `{precision: 3}` |
| `pg/timestamp` | `{precision: 0}` | `timestamp(0)` | `timestamp(0) without time zone` | `timestamp(0)` | `pg/timestamp` `{precision: 0}` |
| `pg/timestamptz` | `{}` | `timestamptz` | `timestamp with time zone` | `timestamptz` | `pg/timestamptz` `{}` |
| `pg/timestamptz` | `{precision: 3}` | `timestamptz(3)` | `timestamp(3) with time zone` | `timestamptz(3)` | `pg/timestamptz` `{precision: 3}` |
| `pg/interval` | `{}` | `interval` | `interval` | `interval` | `pg/interval` `{}` |
| `pg/interval` | `{precision: 3}` | `interval(3)` | `interval(3)` | `interval(3)` | `pg/interval` `{precision: 3}` |

A parameter that is absent and a parameter at its default are different to the database's report: `timestamp` reports no precision although the stored precision is 6, and `timestamp(6)` reports `timestamp(6) without time zone`. So `{}` and `{precision: 6}` stay distinct under exact comparison, and each reads back as itself.

The text in the middle of a temporal name moves: the parameter sits after the first word (`timestamp(3) with time zone`), not at the end. A declaration that only says "name, then parameters in brackets" cannot read these four types; each needs its reported form stated.

## 2. SQLite target

Data types are declared in `packages/3-targets/3-targets/sqlite/src/core/data-types.ts:52-70`. SQLite has no rendering hooks. The planner writes the stored name in upper case and ignores parameters (`packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts:51-58`). Introspection returns `PRAGMA table_info`'s `type` in lower case as `nativeType`, and trimmed and lower-cased as `resolvedNativeType` (`packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:518, 535-543`; `packages/3-targets/3-targets/sqlite/src/core/native-type-normalizer.ts:7-9`).

| Data type id | Name | Written in DDL today | `PRAGMA table_info` reports | Adapter today | Parameters | Codecs (`targetTypes` today) | Casts today |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sqlite/text` | `text`. **`sql/char@1` stores `character`** (Flag F8, section A) | `TEXT` | `TEXT` | `text` | none | `sqlite/text@1` (`['text']`, `codecs.ts:283`); `sql/char@1` (`['char']`, adapted at `codecs.ts:236-239`); `sql/varchar@1` (`['varchar']`, adapted at `codecs.ts:241-244`) | none (`data-types.ts:52`) |
| `sqlite/json` | `text` | `TEXT` | `TEXT` | `text` | none | `sqlite/json@1` (`['text']`, `codecs.ts:542`) | none (`:53`) |
| `sqlite/integer` | `integer` | `INTEGER` | `INTEGER` | `integer` | none | `sqlite/integer@1` (`['integer']`, `codecs.ts:339`); `sql/int@1` (`['int']`, adapted at `codecs.ts:246-249`) | none (`:54`) |
| `sqlite/datetime` | `text` | `TEXT` | `TEXT` | `text` | none | `sqlite/datetime@1` (`['text']`, `codecs.ts:500`) | `sqlite/text`: `unchanged` (`:56-58`) |
| `sqlite/blob` | `blob` | `BLOB` | `BLOB` | `blob` | none | `sqlite/blob@1` (`['blob']`, `codecs.ts:439`) | `sqlite/text`: `unchanged` (`:60-62`) |
| `sqlite/bigint` | `integer` | `INTEGER` | `INTEGER` | `integer` | none | `sqlite/bigint@1` (`['integer']`, `codecs.ts:614`); `sqlite/bigintnumber@1` (**empty**, `codecs.ts:685`) | `sqlite/integer`: `asNumeralText` (`:64-66`) |
| `sqlite/real` | `real` | `REAL` | `REAL` | `real` | none | `sqlite/real@1` (`['real']`, `codecs.ts:390`); `sql/float@1` (`['float']`, adapted at `codecs.ts:251-254`) | `sqlite/integer`: `asReal`; `sqlite/bigint`: `asReal` (`:68-70`) |

All codec line numbers in this table are in `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`. Stored names were checked against committed contracts (`contract-native-types.txt`, rows starting `sqlite`), the constructors (`packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts:152-193`, `packages/3-targets/3-targets/sqlite/src/core/authoring.ts:11-19`) and the column helpers (`packages/3-targets/6-adapters/sqlite/src/core/column-types.ts:12-43`). `sql/text@1` is not adapted for SQLite.

**Three SQLite data types store the name `text` and two store `integer`.** This conflicts with the settled rule that exactly one data type may claim a text. See DECISION NEEDED D1.

SQLite accepts any type text and reports it back exactly as declared, including brackets (`sqlite-raw.json`): `CHARACTER(36)` reports `CHARACTER(36)`, `VARCHAR(10)` reports `VARCHAR(10)`. SQLite has no aliases of its own.

## 3. pgvector

| Item | Today |
| --- | --- |
| Data type id | `pgvector/vector` (`packages/3-extensions/pgvector/src/core/data-types.ts:31`) |
| Name | `vector` (constructor `packages/3-extensions/pgvector/src/core/authoring.ts:13`; helper `src/exports/column-types.ts:40`; committed contracts) |
| Other names | none. Reported: `vector`, `vector(3)`; `data_type` `USER-DEFINED`; `udt_name` `vector`; `udt_schema` `public` |
| Parameter | `length`, integer, **required**. Codec: 1 to 16000 (`src/core/codecs.ts:39-50`, `src/core/constants.ts:9`). Constructor `pgvector.Vector(length)`: 1 to 16000, required (`authoring.ts:9`). Hook: integer greater than 0, no maximum; when `length` is absent or invalid it writes bare `vector` instead of refusing (`src/exports/control.ts:65-71`). Database: 1 to 16000 (`vector(0)` fails "must be at least 1", `vector(16001)` fails "cannot exceed 16000"); bare `vector` is accepted. Bound to keep: 1 to 16000, required. Flag F10 |
| Written | `{length: 1536}` gives `vector(1536)` |
| Reported | `vector(1536)`; adapter today `vector(1536)`. Reads as `pgvector/vector` `{length: 1536}` |
| Bare `vector` column | reported `vector`. The codec schema refuses `{}`, so a column declared by hand as bare `vector` has no valid parameter object. Recommendation: it is unclaimed (section F) |
| Codec | `pg/vector@1` (`['vector']`, `src/core/codecs.ts:182-185`) |
| Casts | none. `listCast`: `of: [pg/int2, pg/int4, pg/int8, pg/numeric]`, `cast: (elements) => elements.map(elementNumber)`, where `elementNumber` returns a JSON number, converts digit text, and refuses `NaN`, the infinities and anything that is not finite (`data-types.ts:15-36`) |

The 12 committed `pg/vector@1` columns with no `typeParams` all carry `typeRef` to a `storage.types` entry that has `length` (for example `examples/prisma-8-demo/src/prisma/contract.json:788-793, 1157-1163`). No committed column is a bare `vector`.

pgvector also creates `halfvec` and `sparsevec`; no data type covers them (section F).

## 4. postgis

| Item | Today |
| --- | --- |
| Data type id | `postgis/geometry` (`packages/3-extensions/postgis/src/core/data-types.ts:6`) |
| Name | `geometry` (constructor `packages/3-extensions/postgis/src/core/authoring.ts:11`; helper `src/exports/column-types.ts:15, 43`; committed contracts) |
| Other names | none known. Not verified on a database |
| Parameter | `srid`, integer, optional. Codec: 0 or more, no maximum (`src/core/codecs.ts:59-70`). Constructor `postgis.Geometry(srid)`: minimum 0, no maximum, and the argument is **required** (`authoring.ts:8` has no `optional`). Hook: integer 0 or more (`src/exports/control.ts:52-61`). Database: not verified. Flag F11 |
| Written | `{}` gives `geometry`. `{srid: 4326}` gives `geometry(Geometry,4326)`, with no space after the comma and the subtype fixed to `Geometry` (`src/exports/control.ts:52-61`; committed DDL `examples/prisma-8-postgis-demo/migrations/app/20260512T1309_migration/ops.json:25`) |
| Reported | The hook's comment says PostGIS prints `geometry(Geometry,4326)` (`src/exports/control.ts:55-57`). Not verified. Reads as `postgis/geometry` `{srid: 4326}` |
| Other subtypes | A column created by hand as `geometry(Point,4326)` is expected to report that text. The data type has no subtype parameter, so it is unclaimed (section F). Not verified |
| Codec | `pg/geometry@1` (`['geometry']`, `src/core/codecs.ts:155-158`) |
| Casts | `pg/text`: `(value) => value` (`data-types.ts:6-8`). No `listCast` |

## 5. Mongo target

Data types are declared in `packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:9-20`, each as `dataType(id, {})`: no casts, no `listCast`. Mongo fields store no type name. Details of where the BSON names are read are in section E.

| Data type id | Codec | `targetTypes` today (`packages/3-mongo-target/1-mongo-target/src/core/codecs.ts`) | Parameters |
| --- | --- | --- | --- |
| `mongo/objectid` | `mongo/objectId@1` | `['objectId']` (`:259`) | none |
| `mongo/string` | `mongo/string@1` | `['string']` (`:264`) | none |
| `mongo/double` | `mongo/double@1` | `['double']` (`:270`) | none |
| `mongo/int32` | `mongo/int32@1` | `['int']` (`:276`) | none |
| `mongo/bool` | `mongo/bool@1` | `['bool']` (`:282`) | none |
| `mongo/date` | `mongo/date@1` | `['date']` (`:288`) | none |
| `mongo/vector` | `mongo/vector@1` | `['vector']` (`:293`) | `length`, read only to render the TypeScript type `Vector<n>`; positive integer (`:230-250`) |
| `mongo/int64` | `mongo/int64@1` | `['long']` (`:299`) | none |
| `mongo/decimal128` | `mongo/decimal128@1` | `['decimal']` (`:305`) | none |
| `mongo/binary` | `mongo/binary@1` | `['binData']` (`:310`) | none |
| `mongo/json` | `mongo/json@1` | `['object','array','string','double','int','long','bool','null']` (`:315`) | none |
| `mongo/bson` | `mongo/bson@1` | **empty** (`:320`) | none |

## A. Types that need a new data type

The rule from the decisions: a column's name is derived from its codec's data type, and the name must not change for any existing column. So wherever two codecs of one data type store different names today, one of them needs its own data type.

The scan of committed contracts and of every constructor, preset and column helper found exactly one such data type: `sqlite/text`.

| Codec on SQLite | Name stored today | Source of the name | Committed SQLite columns |
| --- | --- | --- | --- |
| `sqlite/text@1` | `text` | `control-mutation-defaults.ts:156, 176` | 21 |
| `sql/char@1` | `character` | field presets `packages/2-sql/9-family/src/core/authoring-field-presets.ts:24-25` | 6 (`examples/prisma-8-demo-sqlite/src/prisma/contract.json`) |
| `sql/varchar@1` | `character varying` | `sql.String(length)`, `packages/2-sql/9-family/src/core/authoring-type-constructors.ts:10-11` | 0 |

### A.1 `sqlite/character` (for `sql/char@1`)

| Item | Proposal |
| --- | --- |
| Id | `sqlite/character` |
| Name | `character` |
| Codec | `sql/char@1` on SQLite names `sqlite/character` instead of `sqlite/text` |
| Casts | `sqlite/text`: `unchanged`, so a written string is still admitted |
| Parameter | `length`, integer, optional, 1 or more. It is stored in `typeParams` today (all 6 committed columns have `{length: 36}`) |
| Written | `character`, for every parameter object. Today's DDL is `CHARACTER` with no length, because the SQLite planner ignores parameters (`planner-ddl-builders.ts:55-57`) |
| Reported | `CHARACTER`; adapter today `character` |
| Other names | none |

**This contradicts `design-notes.md`**, which says these columns "were created as `CHARACTER(n)`". They were created as `CHARACTER`. The length is in the contract and not in the database. See DECISION NEEDED D5.

### A.2 `sqlite/character-varying` (for `sql/varchar@1`)

`sql/varchar@1` on SQLite needs one too, for the same reason: `sql.String(255)` on SQLite stores `character varying`, and the planner writes `CHARACTER VARYING`. The planner's safe-name pattern allows the space (`planner-ddl-builders.ts:24-32`), and SQLite reports `CHARACTER VARYING` (`sqlite-raw.json`).

| Item | Proposal |
| --- | --- |
| Id | `sqlite/character-varying` |
| Name | `character varying` |
| Codec | `sql/varchar@1` on SQLite |
| Casts | `sqlite/text`: `unchanged` |
| Parameter | `length`, integer, optional, 1 or more; not written, as in A.1 |
| Written | `character varying` |
| Reported | `CHARACTER VARYING`; adapter today `character varying` |

No committed SQLite contract uses this codec, so no existing hash depends on it. DECISION NEEDED D6 asks whether to add the type or to make `sql.String` on SQLite store `text`.

### A.3 Nothing else

On Postgres every codec of a data type stores the same name (section 1.1). On SQLite, `sqlite/bigint@1` and `sqlite/bigintnumber@1` both store `integer`.

## B. Enum

**How the name is stored.** A `pg/enum@1` column stores the enum type's name twice: as `nativeType` and as `typeParams.typeName`. Example: `nativeType "storage.buckettype"`, `typeParams {"typeName": "storage.buckettype"}` (`packages/3-extensions/supabase/src/contract/contract.json`, 6 columns). Committed forms (`contract-native-types.txt`): bare lower case (`user_role`), bare mixed case (`Role`, `TestEnum`), schema-qualified (`auth.aal_level`), schema-qualified mixed case (`audit.AuditAction`). The name is never quoted in the contract.

**How the stored name is built.**

1. `pg.enum(Ref)` resolves the reference to a `native_enum` entity, and `columnFromEntity` returns `{typeParams: {typeName}, nativeType: typeName}` with the bare name (`codecs.ts:501-506`).
2. When the contract is built, `postgresQualifyColumnType` rewrites both fields for the column's namespace (`codecs.ts:538-551`). `qualifyNativeType` returns the bare name for the default namespace (`public`) and the unbound namespace, and `namespace.typeName` otherwise (`codecs.ts:517-521`).

**How the name is written in DDL.** `buildColumnTypeSql` sees `typeParams.typeName` and returns `quoteQualifiedName(nativeType)`, plus `[]` for a list (`packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts:83-86`). `quoteQualifiedName` splits on every dot and double-quotes each part: `auth.aal_level` gives `"auth"."aal_level"`, `Role` gives `"Role"` (`packages/3-targets/3-targets/postgres/src/core/sql-utils.ts:91-96`). It cannot write a type name that itself contains a dot. The runtime cast uses the codec hook, which returns `typeName` (`codecs.ts:467-469`); this hook is deleted by engineering decision 2.

**What the database reports** (`postgres-summary.txt`):

| Declared | `format_type` | `data_type` | `udt_schema` | `udt_name` | `pg_type.typtype` | Adapter today |
| --- | --- | --- | --- | --- | --- | --- |
| `inv_status` (in `public`) | `inv_status` | `USER-DEFINED` | `public` | `inv_status` | `e` | `inv_status` |
| `"MixedStatus"` (in `public`) | `"MixedStatus"` | `USER-DEFINED` | `public` | `MixedStatus` | `e` | `MixedStatus` |
| `inv_other.other_status` | `inv_other.other_status` | `USER-DEFINED` | `inv_other` | `other_status` | `e` | `inv_other.other_status` |
| `inv_other."OtherMixed"` | `inv_other."OtherMixed"` | `USER-DEFINED` | `inv_other` | `OtherMixed` | `e` | `inv_other.OtherMixed` |
| `inv_status[]` | `inv_status[]` | `ARRAY` | `public` | `_inv_status` | `b` | `inv_status`, `many: true` |

`format_type` leaves out the schema when the type's schema is on the connection's `search_path`, and adds it otherwise. It quotes a part that needs quoting. Today's adapter removes the quotes part by part (`control-adapter.ts:1525-1531`).

**How a reported enum type resolves to `pg/enum` with `{typeName}`.**

The reported text alone is not enough. `inv_status` (an enum), `inv_domain` (a domain), `inv_composite` (a composite type) and `money` (a built-in type) all arrive as one bare word with `data_type` `USER-DEFINED` or their own name. Only `pg_type.typtype = 'e'` says the type is an enum. Today's introspection does not read `typtype` for columns; `contract infer` passes a separate set of enum names (`packages/3-targets/3-targets/postgres/src/core/psl-build/postgres-type-map.ts:79-84`).

The precise rule that matches today's stored names:

1. Introspection reads, for each column, the type's `typtype`, its schema (`udt_schema`) and its unquoted name (`udt_name`, without the leading `_` for a list).
2. When `typtype` is `e`, the column resolves to `pg/enum` with `typeName` equal to the bare `udt_name` if `udt_schema` is `public`, and `udt_schema.udt_name` otherwise. This is the same rule as `qualifyNativeType` (`codecs.ts:517-521`), so both sides are equal for an unchanged column.
3. `pg/enum` claims no fixed text. It claims a column by the kind of its type.

This rule does not depend on `search_path`, unlike `format_type`. Two facts remain open: how `pg/enum` takes part in a resolver that reads only declared texts (DECISION NEEDED D7), and the unbound namespace, whose columns store the bare name whatever schema the type is in (`codecs.ts:518`), so a type in a schema other than `public` stores `typeName` without the schema and resolves with it (DECISION NEEDED D8).

**Enum blocks.** A PSL `enum` block with `@@type` takes its column's name from the codec's `targetTypes[0]` (`packages/2-sql/9-family/src/core/authoring-entity-types.ts:42`). These columns are ordinary columns of that codec (for example `pg/text@1`, name `text`) with a value set; they are not `pg/enum` columns. When `targetTypes` is deleted, this line reads the name from the codec's data type. A codec whose `targetTypes` is empty today (for example `pg/int8number@1`) is refused by this line today and would start to work.

## C. Lists

**How a list column is reported** (`postgres-summary.txt`):

| Declared | `format_type` | `data_type` | `udt_name` | Adapter today `nativeType`, `many`, `resolvedNativeType` |
| --- | --- | --- | --- | --- |
| `int4[]`, `integer[]` | `integer[]` | `ARRAY` | `_int4` | `int4`, `true`, `int4[]` |
| `int8[]` | `bigint[]` | `ARRAY` | `_int8` | `int8`, `true`, `int8[]` |
| `text[]` | `text[]` | `ARRAY` | `_text` | `text`, `true`, `text[]` |
| `text[][]` | `text[]` | `ARRAY` | `_text` | `text`, `true`, `text[]` |
| `numeric(10,2)[]` | `numeric(10,2)[]` | `ARRAY` | `_numeric` | `numeric(10,2)`, `true`, `numeric(10,2)[]` |
| `varchar(10)[]` | `character varying(10)[]` | `ARRAY` | `_varchar` | `character varying(10)`, `true`, `character varying(10)[]` |
| `char(3)[]` | `character(3)[]` | `ARRAY` | `_bpchar` | `character(3)`, `true`, `character(3)[]` |
| `timestamptz(3)[]` | `timestamp(3) with time zone[]` | `ARRAY` | `_timestamptz` | `timestamptz(3)`, `true`, `timestamptz(3)[]` |
| `timetz(3)[]` | `time(3) with time zone[]` | `ARRAY` | `_timetz` | `timetz(3)`, `true`, `timetz(3)[]` |
| `bit(4)[]` | `bit(4)[]` | `ARRAY` | `_bit` | `bit(4)`, `true`, `bit(4)[]` |
| `vector(3)[]` | `vector(3)[]` | `ARRAY` | `_vector` | `vector(3)`, `true`, `vector(3)[]` |
| `inv_status[]` | `inv_status[]` | `ARRAY` | `_inv_status` | `inv_status`, `true`, `inv_status[]` |

The database does not record the number of dimensions: `text[][]` reports `text[]`. The `[]` is always the last two characters of `format_type`, after any `with time zone`. The element's parameters are kept.

**How `many` is set today.**

- In a contract: the field is a list in the source (`Type[]` in PSL, `.many()` in TypeScript), and the contract builder copies it to the column as `many: true` (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:879, 897, 908`). The column's `nativeType` and `typeParams` are the element's.
- In DDL: the planner appends `[]` to the written element type (`planner-ddl-builders.ts:85, 90, 95, 99`).
- In introspection: `normalizeFormattedType` handles the element text and puts `[]` back (`control-adapter.ts:1483-1485`); the caller then sets `many: true` when the text ends in `[]`, removes it, and normalises the element (`control-adapter.ts:1081-1084`).
- On the expected side of verify: `convertColumn` keeps the element text in `nativeType` and appends `[]` to `resolvedNativeType` (`packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:123-124`).

So the reading rule is: remove one trailing `[]` from the reported text, set `many`, and resolve the rest as the element. SQLite has no list columns (`sql.scalarList` is a Postgres capability, `descriptor-meta.ts:165`).

## D. `pg/text-array` and `pg/tsquery`

Neither is the type of any contract column. No committed contract stores a column with `pg/text-array@1` or `pg/tsquery@1` (`contract-native-types.txt`), no type constructor names them, and neither has a column helper in `column-types.ts`.

| Data type | What it is for | Evidence |
| --- | --- | --- |
| `pg/text-array` | The Prisma control tables. The `invariants` column of the ledger is declared with the contract-free helper `textArray()`, which names `pg/text-array@1` so the driver sends a JavaScript `string[]` under a `::text[]` cast. It is also listed as a codec whose `min` and `max` return the input type | `packages/3-targets/3-targets/postgres/src/contract-free/columns.ts:29`; `packages/3-targets/6-adapters/postgres/src/core/marker-ledger.ts:30`; `packages/3-targets/3-targets/postgres/src/core/aggregates.ts:133`; codec comment `codecs.ts:553-560` |
| `pg/tsquery` | The type of a query expression. Full-text parser functions return it and the full-text match operations take it as an argument. A value is only ever produced by Postgres inside a query | `packages/3-targets/3-targets/postgres/src/core/full-text-parsers.ts:41`; `query-operations.ts:28`; `src/types/operation-types.ts:27`; codec comment `codecs.ts:1378-1387` |

Consequences for the design:

- `pg/text-array`'s only text is `text[]`, which is also what a list column of `pg/text` reports. If it declared that text, two readings would exist for `text[]`. See DECISION NEEDED D9.
- `pg/tsquery` can declare the name `tsquery` with no conflict. A user column of type `tsquery` would then resolve to it, and `contract infer` needs a constructor to print; none exists. See DECISION NEEDED D9.

## E. Mongo: where the BSON type names are read

The BSON names per data type are in the table in section 5. They are read in two places, and both read the **whole list**, not only the first entry. `research.md` section 9 says `targetTypes[0]`; that is out of date.

1. **Collection validator.** `fieldToBsonSchema` calls `codecLookup.targetTypesFor(field.type.codecId)` (`packages/2-mongo-family/2-authoring/contract-psl/src/derive-json-schema.ts:35`). An unknown codec gives no schema (`:36`). An empty list gives a schema that accepts any value (`:37`, `:24-26`). One entry gives `bsonType: "<name>"`; several give `bsonType: [names]` (`:15-18`, `:38`). A nullable field adds `null` to the list (`:20-22`, `:51-52`).
2. **Enum blocks.** The Mongo enum entity reads `targetTypesFor(codecId)` (`packages/2-mongo-family/9-family/src/core/authoring-entity-types.ts:42`).

`targetTypesFor` is built from codec descriptors at assembly (`packages/1-framework/1-core/framework-components/src/control/control-stack.ts:678`).

The Mongo constructors' `nativeType` is not read for the validator. For `Json` and `Bson` it holds the words `json` and `bson`, which are not BSON type names (`packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts:28, 81, 87`).

Two data types do not fit "a data type takes its BSON type name": `mongo/json` has eight names and `mongo/bson` has none. See DECISION NEEDED D10. `mongo/vector`'s `vector` is not reached by any constructor, so it never reaches a validator.

## F. Ambiguities and unclaimed types

### F.1 Texts that two data types would claim

| Text | Claimed by | Notes |
| --- | --- | --- |
| `numeric` | `pg/numeric` only | `pg/unboundedint@1` is a codec of `pg/numeric` (`codecs.ts:1063`), not a second data type, so this is not a conflict between data types. It is a question of which constructor `contract infer` prints: today `numeric` always prints `Numeric` (`postgres-type-map.ts:28`). The data type's mark must name `Numeric` |
| `int8` | `pg/int8` only | `pg/int8@1` and `pg/int8number@1` are codecs of one type. Today `int8` prints `BigInt` (`postgres-type-map.ts:9-10`) |
| `timestamptz`, `timestamp`, `time`, `date` | one data type each | three, two, two and two codecs. Today they print `Timestamptz`, `Timestamp`, `Time`, `Date`, the Temporal codecs (`infer-default-codec.ts:30-33`) |
| `jsonb` | `pg/jsonb` only | `arktype/json@1` is a codec of `pg/jsonb` |
| `int4`, `float8`, `character`, `character varying`, `text` | one data type each | the `sql/*` and `pg/int@1`, `pg/float@1`, `pg/char@1`, `pg/varchar@1` codecs are further codecs of the same types |
| `text[]` | `pg/text-array` and a list of `pg/text` | DECISION NEEDED D9 |
| `text` on SQLite | `sqlite/text`, `sqlite/json`, `sqlite/datetime` | DECISION NEEDED D1 |
| `integer` on SQLite | `sqlite/integer`, `sqlite/bigint` | DECISION NEEDED D1 |
| any bare user-defined name | `pg/enum`, and nothing else | resolved by `typtype`, not by text (section B) |

No text is claimed by both a Postgres target type and a pgvector or postgis type.

### F.2 Types the adapter introspects today that no data type covers

Today's adapter returns a `nativeType` string for every one of these (`postgres-summary.txt`). Under the decisions each is "unclaimed": verify reports a mismatch and `contract infer` fails naming the column.

| Group | Reported texts |
| --- | --- |
| Money and XML | `money`, `xml` |
| Network | `cidr`, `macaddr`, `macaddr8` |
| Object identifiers and system types | `oid`, `regclass`, `name`, `"char"` (adapter today: `char`), `pg_lsn`, `txid_snapshot`, `jsonpath` |
| Text search | `tsvector` |
| Geometric built-ins | `point`, `line`, `lseg`, `box`, `path`, `polygon`, `circle` |
| Ranges and multiranges | `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`, `int4multirange` and the other multiranges |
| Interval with fields | `interval year to month`, `interval day to second(3)`, `interval second(3)` and the other field forms. `pg/interval` has only `precision`. DECISION NEEDED D11 |
| Domains | reported by the domain's name (`inv_domain`), `typtype` `d`; `data_type` is the base type's (`integer`) |
| Composite types | reported by name (`inv_composite`), `typtype` `c`, `data_type` `USER-DEFINED` |
| pgvector's other types | `halfvec(n)`, `sparsevec(n)`; bare `vector` |
| PostGIS's other types | `geography`, and `geometry` with a subtype other than `Geometry`. Not verified |
| Any type of an extension that is not in the stack | for example `vector(3)` without pgvector (already settled) |

`"char"` needs care: today's adapter removes the quotes and returns `char`, which is also an accepted input name for `pg/char`. The resolver must read the reported text `"char"` with its quotes, so that it does not resolve to `pg/char`.

### F.3 Other facts the design must account for

- **An extension type outside `search_path`.** `format_type` adds the schema when the type's schema is not on `search_path`. `vector` was reported bare because the extension was created in `public`. An extension installed in another schema would report `schema.vector(3)`. Reading `udt_name` and the type modifier avoids this. Not tested.
- **A stale codec id in a committed snapshot.** `apps/telemetry-backend/migrations/snapshots/41700ef5…/contract.json` has two columns with codec id `pg/timestamptz@1`, which is not registered today. The upgrade script that replaces `nativeType` with `dataType` cannot look this codec up.
- **`serial`, `bigserial`, `smallserial`** are not types. They report `integer`, `bigint`, `smallint`. The planner writes them for an `autoincrement()` default (`planner-ddl-builders.ts:63-75`); that branch tests the stored name and must test the data type id instead.

## G. Flagged disagreements

| Flag | Disagreement | Bound or form to keep |
| --- | --- | --- |
| F1 | `numeric` precision: the codec allows 1 to 1000; the constructor and the hook have no maximum | 1 to 1000, which the database enforces |
| F2 | `numeric` scale: codec, constructor and hook all allow 0 or more with no maximum; the database allows -1000 to 1000. Only the hook refuses scale without precision | D4 |
| F3 | `char`, `varchar` length: codec, `Char`, `VarChar` and the hook have no maximum; `sql.String` has 10485760 | 1 to 10485760, which the database enforces |
| F4 | `bit`, `varbit` length: no maximum anywhere | 1 to 83886080, which the database enforces |
| F5 | Temporal and interval precision: the codec allows 0 to 6; the constructors and the hook have no maximum; the database stores 6 for anything larger | 0 to 6 |
| F6 | `numeric(10)` is written without a scale and reported as `numeric(10,0)` | D2 |
| F7 | `character` and `bit` without a length are reported as `character(1)` and `bit(1)` | D3 |
| F8 | On SQLite, `sql/char@1` stores `character` and `sql/varchar@1` stores `character varying`, while their data type `sqlite/text` is named `text` | new data types, section A |
| F9 | Codec `targetTypes` that differ from the stored name: `sql/int@1` `int`, `sql/float@1` `float`, `sql/char@1` `char`, `sql/varchar@1` `varchar`, `pg/enum@1` `text` | none kept; `targetTypes` is deleted |
| F10 | `vector` length: the codec and constructor require it; the hook writes bare `vector` when it is missing | required, 1 to 16000 |
| F11 | `geometry` srid: optional in the codec and hook, required in `postgis.Geometry(srid)`; no maximum anywhere; the database's bound is not verified | optional, integer 0 or more, until verified on PostGIS |
| F12 | The design notes say SQLite `sql/char@1` columns were created as `CHARACTER(n)`; they were created as `CHARACTER` | D5 |

## H. Decisions needed

**D1. SQLite: several data types share one name.** `sqlite/text`, `sqlite/json` and `sqlite/datetime` are all named `text`; `sqlite/integer` and `sqlite/bigint` are both named `integer`. SQLite reports only `TEXT` or `INTEGER`, so introspection cannot tell them apart. The settled rules say that exactly one data type may claim a text, that assembly refuses two that claim the same text, and that verify compares data type ids exactly. Applied as written, the SQLite stack fails assembly. Renaming the types in DDL is not possible without changing behaviour: a column declared `JSON` or `DATETIME` gets numeric affinity, and an inserted `'12'` is stored as an integer (`sqlite-raw.json`). Recommended answer: a data type may declare that it is stored as another data type of the same pack (`sqlite/json` and `sqlite/datetime` as `sqlite/text`; `sqlite/bigint` as `sqlite/integer`). Only the type it is stored as claims the text. Verify compares the contract column's stored-as type with the introspected type. `contract infer` prints the constructor of the type that claims the text (`String`, `Int`), as it would today. Reason: it keeps one claimant per text and exact comparison, and it changes no DDL.

**D2. `numeric(p)` reads back with a scale.** The contract stores `{precision: 10}` and the database reports `numeric(10,0)`, which reads as `{precision: 10, scale: 0}`. Exact comparison of parameters then fails for every `Numeric(10)` column. Today's string comparison has the same fault: `numeric(10)` against `numeric(10,0)`. Recommended answer: the data type declares a normal form for its parameters, applied to both sides before comparison, in which `scale: 0` with a precision is the same as no scale. Reason: it changes no stored contract and no hash, and it keeps the comparison exact after one declared step.

**D3. `character` and `bit` without a length.** The contract stores `{}`, the DDL is `character`, and the database creates and reports `character(1)`. The same holds for `bit`. `Char` with no argument is a bare scalar today (`control-mutation-defaults.ts:213-222`). Recommended answer: the same normal form as D2: for `pg/char` and `pg/bit`, no length is the same as `length: 1`. A column declared by hand as `bpchar` (unlimited length, reported `bpchar`) is unclaimed. Reason: it matches what the database does and changes no stored contract.

**D4. `numeric` scale bound.** The database (PostgreSQL 15 and later) accepts -1000 to 1000. Earlier versions accept 0 to the precision. Every check in the repository today requires 0 or more. Recommended answer: 0 to 1000, and `scale` requires `precision`. Reason: a negative scale fails on PostgreSQL 14 and earlier, nothing can author one today, and the upper bound is the database's.

**D5. Does `sqlite/character` write its length?** Today the length is stored in the contract and left out of the DDL. Recommended answer: keep it out of the DDL; the parameter is accepted and not written, and a column created by hand as `CHARACTER(36)` is unclaimed. Reason: writing `CHARACTER(36)` would make every existing database column (`CHARACTER`) a mismatch. The consequence is that verify cannot check the length on SQLite, as it cannot today.

**D6. `sql/varchar@1` on SQLite.** Recommended answer: add `sqlite/character-varying` (section A.2). Reason: it keeps the name `sql.String` stores and writes today, and the rule "one name per data type" then holds with no special case. The alternative, storing `text`, changes DDL for any SQLite user of `sql.String`.

**D7. How `pg/enum` claims a column.** The settled resolver "reads only what the stack's SQL data types declare: each type's name, its other names, and how its name is written with parameters". An enum's text is a user's type name, which no declaration can list. Recommended answer: introspection hands the resolver the kind of the reported type along with its text, and a SQL data type may declare that it claims every type of one kind; `pg/enum` claims the kind "enum" and builds `typeName` by the rule in section B. Reason: `typtype` is the only fact that separates an enum from a domain, a composite type or an unknown built-in, and the rule stays a declaration on the data type with no enum branch in the resolver.

**D8. Enum in the unbound namespace.** A column in the unbound namespace stores the bare `typeName` whatever schema the type lives in (`codecs.ts:518`). Resolving by `udt_schema` gives `schema.name` for a type outside `public`. Recommended answer: compare by the rule in section B and accept that an unbound-namespace column whose enum is outside `public` is a mismatch; record it as a known limit. Reason: the unbound namespace means "resolved by `search_path` at run time", so the contract does not say which schema is meant, and guessing would make the comparison inexact.

**D9. `pg/text-array` and `pg/tsquery`.** Recommended answer: a SQL data type's name is optional. `pg/text-array` declares no name and claims no text, so `text[]` always reads as a list of `pg/text`. `pg/tsquery` declares the name `tsquery`, because runtime casts need it, and is marked as having no constructor for `contract infer`, so a user column of type `tsquery` makes infer fail like an unclaimed type. Reason: neither is ever a contract column, and giving `pg/text-array` the text `text[]` would create the only conflict between two Postgres types.

**D10. Mongo `mongo/json` and `mongo/bson`.** Engineering decision 11 says the Mongo data types "take their BSON type names", and counts eleven. There are twelve; `mongo/json` needs a list of eight names and `mongo/bson` needs none, meaning "any value". Recommended answer: a Mongo data type declares a list of BSON type names, which may be empty, and the validator keeps today's three cases. Reason: it moves `targetTypes` as it is and changes no validator.

**D11. Interval with fields.** Recommended answer: unclaimed. Reason: `pg/interval` has no parameter for fields today and nothing can author one.

## I. Statements in `design-notes.md` that this inventory contradicts

1. "`sql/char@1` columns were created as `CHARACTER(n)`" (section "Verify compares identifiers exactly"). They were created as `CHARACTER` (F12, D5).
2. "exactly one may claim a text, and assembly refuses two data types in one stack that claim the same text". The SQLite target's own seven types break this today (D1).
3. "the eleven Mongo data types take their BSON type names" (engineering decision 11). There are twelve, one with eight names and one with none (D10).
4. "Verify compares the contract's data type id and parameters with the database's by exact equality." The database reports parameters the contract does not store for `numeric(p)`, `character` and `bit` (D2, D3).
5. "It reads only what the stack's SQL data types declare: each type's name, its other names, and how its name is written with parameters." An enum column cannot be recognised from text (D7).
6. Q1 (unsettled text, kept for the record) says the only SQLite exception is `sql/char@1`. `sql/varchar@1` is a second one (D6).
