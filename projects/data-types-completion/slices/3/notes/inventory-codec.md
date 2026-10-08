## Codec value-method inventory (worktree `data-types-value-ownership-7ec585` at `93b49ceffb`, read-only)

All paths below are under `/Users/will/Projects/prisma/orm/.claude/worktrees/data-types-value-ownership-7ec585/`. "pg-codecs" means `packages/3-targets/3-targets/postgres/src/core/codecs.ts` and "sq-codecs" means `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`.

### 1. Implementations
| Package | Count | Where |
|---|---|---|
| Framework | `Codec` interface plus abstract `CodecImpl` | `packages/1-framework/1-core/framework-components/src/shared/codec.ts:34-83`. The shared JSON readers are in `src/shared/decode-json.ts`: `refuseJsonValue`, `decodeJsonString`/`Matching`/`Boolean`/`Integer`/`IntegerText`/`Float`, `encodeJsonFloat` |
| SQL family | 5 classes | `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`: SqlText:49, SqlInt:86, SqlFloat:123, SqlChar:160, SqlVarchar:200. These are templates (`CodecDescriptorTemplateImpl`) with no data type of their own |
| Postgres | 31 full `CodecImpl` classes, plus 4 subclasses of SQL family codecs | • pg-codecs: 22 classes (Text, Enum, TextArray, Int4, Int2, Int8, Int8Number, Float4, Float8, Bool, Numeric, UnboundedInt, Timetz, Bit, Varbit, Bytea, Uuid, Inet, Tsquery, Interval, Json, Jsonb)<br>• the 4 subclasses (pg-codecs:1564-1622): `PgIntCodec` overrides decode and decodeJson, `PgCharCodec` and `PgVarcharCodec` override decodeJson, `PgFloatCodec` overrides decode<br>• `date-codecs.ts:108`: 1 class<br>• `temporal-codecs.ts`: 4 classes<br>• `temporal-string-codecs.ts`: 4 classes |
| SQLite | 8 full classes, plus 2 subclasses | • sq-codecs: Text:350, Integer:391, Real:432, Blob:473, Datetime:554, Json:612, Bigint:695, BigintNumber:766<br>• `SqliteFloatCodec`:196 overrides encode, encodeJson and decodeJson<br>• `SqliteSqlIntCodec`:324 overrides encodeJson and decodeJson |
| Mongo | `mongoCodec()` factory plus 13 target codecs | • Factory: `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:52-120`. It defaults to identity for encodeJson/decodeJson (:117-118)<br>• Codecs: `packages/3-mongo-target/1-mongo-target/src/core/codecs.ts:92-226` (objectId, string, double, int32, boolean, date, vector, int64, int64Number, decimal128, binary, json, bson). `mongoJsonCodec` supplies no JSON methods at all |
| pgvector | 1 | `packages/3-extensions/pgvector/src/core/codecs.ts:70` |
| postgis | 1 | `packages/3-extensions/postgis/src/core/codecs.ts:82` (encode writes EWKT; decode reads EWKB hex) |
| arktype-json | 1 | `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:145` |
| paradedb, supabase | 0 | — |
| Test-only fakes | about 80 test files | They define encodeJson/decodeJson, `extends CodecImpl` or `mongoCodec(` (about 354 definition lines). 137 test files mention the JSON methods at all |

**`encode` that does not return a string:**
- Binary (`Uint8Array`): `PgByteaCodec` (pg-codecs:1236) and `SqliteBlobCodec` (sq-codecs:479). Mongo binary returns a BSON `Binary`.
- `number`: pg Int4, Int2 and Bool (Bool returns `boolean`), `SqlInt`, `SqlFloat`, sqlite Integer, Real and BigintNumber.
- `string | number`: pg Float4 and Float8.
- `number | bigint`: `SqliteBigint`:701.
- Array: `PgTextArray`:562.
- Mongo: every codec returns a BSON or native object (ObjectId, Double, Long, Decimal128, Binary, Date).

**`decode` that accepts non-string input:**
- `string | number`: pg Int4, Int2, Float4, Float8, Numeric, plus `PgIntCodec` and `PgFloatCodec`.
- `string | number | bigint`: pg Int8, Int8Number, UnboundedInt.
- `string | boolean`: pg Bool.
- `Uint8Array | string`: pg Bytea.
- `string | JsonValue`: pg Json and Jsonb, sqlite Json, arktype.
- `string | Record`: pg Interval:1437.
- Array: pg TextArray.
- `number`: sqlite Integer and Real.
- `number | bigint | string`: sqlite Bigint and BigintNumber.
- `Uint8Array`: sqlite Blob.
- Mongo: all BSON.
- Mongo `decode` returns `TOutput`, which can differ from `TInput` (bson codec).

### 2. Interfaces
- **Framework `Codec` and `CodecImpl`:** `codec.ts:34-54` and `:61-83`.
- **SQL `Codec`** (narrows `ctx` to `SqlCodecCallContext`): `relational-core/src/ast/codec-types.ts:95-102`.
  - `DescriptorCodecJson` is `ReturnType<encodeJson>` (:164-166) and feeds `ExtractCodecTypes.json` (:194).
- **`MongoCodec`:** `mongo-codec/src/codecs.ts:15-23`. `JsonRoundTripConfig` is at :28-41.
- **Descriptors:** `framework-components/src/shared/codec-descriptor.ts`. `CodecDescriptorTemplate` is at :28-58, `CodecDescriptor` (adds `dataType`) at :67-70, `canonicalFormOf` at :75-80, and the Impl classes at :104-149. Value-related fields:
  - `renderValueLiteral(value: JsonValue, side)` at :51 and :123. It takes the contract-form value.
  - `toCanonicalForm` at :55 and :126.
  - `renderOutputType` and `renderInputType` at :38 and :40. These are types only.
- **Target-only JSON projection:**
  - Postgres (`postgres/src/core/codec-descriptor.ts`): `projectJson` at :43, abstract `jsonProjection` at :52, `jsonArrayProjection` at :54-86, options at :109-132. The adapter copies `renderValueLiteral` (:186-189) but not `toCanonicalForm`.
  - SQLite (`sqlite/src/core/codec-descriptor.ts`): :25, :34-50, options at :66-93. The adapter also does not copy `toCanonicalForm`.
- **Mongo descriptor:** `descriptorFor`, `1-mongo-target/src/core/codecs.ts:242-272`. It has `renderValueLiteral` but no projection and no canonical form.
- **Data types:** `framework-components/src/shared/data-type.ts`. `Cast` is at :31, `ListCast` at :37, `ToCanonicalForm` at :47, `DataType` at :49-61, `DataTypeSpec` at :63-68, `dataType()` at :92-107. The SQL extension is `2-sql/1-core/contract/src/sql-data-type.ts:50-72`.
- **Aggregate descriptor:** `emptyResultJson` at `framework-components/src/shared/aggregate-descriptor.ts:55`.

### 3. Production call sites of `encodeJson` / `decodeJson`
- **Contract loading:** none. `validateSqlContractFully` (`2-sql/1-core/contract/src/validators.ts:916`) takes no codecs, and Mongo validation doesn't either. ADR 184:134-136 ("Contract loading integrates decoding") is not implemented, so literal defaults stay as contract JSON in memory.
- **PSL default reading:**
  - `contract-psl/src/data-type-default.ts:219`: decodeJson is used only as a validity check; the result is thrown away and `canonicalFormOf` is applied next (:216, :233).
  - `value-object-default.ts:71`: encodeJson of a list document. `:82`: decodeJson from the stored form to the document (for sqlite/json text). `:215`: encodeJson of enum values to compare against a member default.
- **Enum members:**
  - PSL: `framework-components/src/shared/enum-block-members.ts:47` (decodeJson) and `:71` (encodeJson, used for duplicate detection). Called from SQL `2-sql/9-family/src/core/authoring-entity-types.ts:77` and Mongo `2-mongo-family/9-family/.../authoring-entity-types.ts:91`.
  - TS: `contract-ts/src/build-contract.ts:134-135`, `encodeViaCodec` (encodeJson, then a decodeJson read-back), used by `encodeEnumMember`:537 for domain members and the storage valueSet (:1761). `:515` `assertStoredAsWritten` decodes the stored value back. `checkMemberValues`:600 turns the encodeJson output into CHECK constraint SQL literals (:1385).
- **TS builder `.default()`:** `build-contract.ts:181` (`encodeDefaultValue`), reached from `buildStorageColumn`:961. A default flagged `canonical: true` skips the codec (:243-251).
- **Mongo:** `mongo-contract/src/build-mongo-storage.ts:22`, used by contract-prisma6 `interpreter.ts:1431` and contract-psl `interpreter.ts:1694`. `contract-ts/src/contract-builder.ts:98` (:2550, :2607). Value sets flow raw into `$jsonSchema` `enum` (`contract-psl/src/derive-json-schema.ts:43-62`).
- **DDL default rendering:** `relational-core/src/ast/ddl-default.ts:66` (decodeJson, then encode at :72; a `Date` skips decodeJson at :33; a refused `null` becomes SQL NULL at :69). Callers:
  - Postgres `6-adapters/postgres/src/core/control-adapter.ts:1871` and `:1877`. Date/time defaults are written as text via `postgresDateTimeDdlText` (`pgWrittenValue`).
  - SQLite `control-adapter.ts:802`.
- **Runtime decoding of database-produced JSON:** `sql-orm-client/src/collection-dispatch.ts:778` (`decodeIncludedJsonValue`), reached from include rows (:299, :670) and scalar or aggregate includes (:957). `aggregate-empty-result.ts:18` uses `emptyResultJson: '0'`, defined in postgres `aggregates.ts:169,176` and sqlite `aggregates.ts:152,160`; it is used at collection-dispatch.ts:945 and :955 and collection.ts:1638. These are synchronous row-mapping functions.
- **Discriminator values:** no codec. The contract value is used directly as the runtime value (`sql-orm-client/src/collection-runtime.ts:127-132`, `collection.ts:2049`).
- **`contract.d.ts` emission:** no encodeJson call.
  - `renderValueLiteral` is fed contract-form values (`emitter/src/domain-type-generation.ts:345`, via `control-stack.ts:719-720,757`).
  - The type-level `json` channel is used by the emitted `DefaultLiteralValue` (`2-sql/3-tooling/emitter/src/index.ts:501-507`). 256 tracked files contain `CodecTypes[CodecId]["json"]`.
  - The comment at `control-stack.ts:722` mentions an "emitter literal-default encodeJson resolver" that does not exist.
- **Migration ops and `ops.json`:** no codec calls at plan time. Defaults are emitted as `lit(jsonToTsSource(def.value))` in contract form (`postgres/src/core/migrations/op-factory-call.ts:174`, sqlite `op-factory-call.ts:82`) and decoded only at apply time, through the DDL default path above.
- **`contract infer`:** `postgres/src/core/psl-infer/infer-default-codec.ts:105` (`readsBack`, a check only).
- **`contract print`:** none. It uses canonical forms (`2-sql/9-family/src/core/psl-build/default-mapping.ts:280-282`) and raw domain enum values (`psl-print/model-attributes.ts:49`).
- **Test kits:** postgres `index.ts:341,343,372,381`; sqlite `index.ts:311,352`.
- **`super.` overrides:** pg-codecs:1593 and :1606; sq-codecs:201.

### 4. `encode` / `decode` outside the runtime loops
- **DDL rendering:** `ddl-default.ts:33,72`, which is async. It is reached through adapter `lower()` for DDL nodes, meaning migration apply, `db init` and `db update`.
- **Control-plane query parameters:** `6-adapters/{postgres,sqlite}/src/core/control-codecs.ts:27`. This calls `encodeParamsWithMetadata`, the runtime loop reused, for data transforms and control DML (`control-adapter.ts:278` / `:198`) and the marker ledger (`marker-ledger.ts:116` / `:89`). It is async.
- **Test kits:** they encode to insert values (postgres `index.ts:327,332`; sqlite `:263`).
- **Introspection, verify and planner:** no encode/decode. They compare defaults through `toCanonicalForm` instead. Temporary defaults come from `resolveIdentityValue` hooks that return SQL text.
- **Synchronous contexts:** every encode/decode caller is async. Every encodeJson/decodeJson caller is synchronous: PSL, the TS builder, Mongo storage, infer, ORM include and aggregate decoding, and the read-back step inside the async DDL path.

### 5. What runtime `decodeJson` receives from database-produced JSON
| Codec | Projection | What `decodeJson` receives |
|---|---|---|
| pg/int8 and int8-number | `CAST(x AS text)` (pg-codecs:250, :722, :774) | Decimal text, the same as the contract form |
| pg/numeric | `CAST(x AS text)` (:987) | PostgreSQL's numeric text (keeps its scale); decodeJson checks it against the canonical pattern |
| pg/bytea | `translate(encode(x,'base64'),chr(10),'')` (:266, :1251) | Unwrapped base64, the same as the contract form |
| pg timestamptz (Date codec) and every temporal/string date-time codec | `CAST AS text` (`date-codecs.ts:136`; `temporal-codecs.ts:64,105,152,199`; `temporal-string-codecs.ts:61,105,154,204`) | **PostgreSQL's text, in the session TimeZone** (e.g. `2024-01-15 01:00:00+01`), not the contract form (canonical ISO). decodeJson accepts both (`date-time-stored-text.ts:1-11`). The string codecs return that text unchanged (`postgres-codec-testkit/test/date-time-text.integration.test.ts:110-140`) |
| pg/interval | ISO-8601 duration assembled in SQL (pg-codecs:290-337) | ISO duration text |
| pg/json and pg/jsonb, arktype-json | Identity | A native JSON value, the same as the contract form |
| pgvector | `array_to_json(x::real[]::float8[])` | A number array, the same as the contract form |
| sqlite/datetime | Identity (sq-codecs:591) | The stored `toISOString()` text; the contract form is a codec-level canonical instant |
| sqlite/json | Identity (sq-codecs:674) | The stored JSON **text** (key order and whitespace as stored), while the contract holds `canonicalizeJson` text |
| sqlite/blob | `hex()` with a NULL guard | Uppercase hex, the same as the contract form |
| sqlite/bigint | `CAST AS TEXT` | Decimal text |

Both test kits apply `canonicalFormOf` to the projected value before comparing it with encodeJson, but pass the **raw** projected value to decodeJson.

PostGIS uses an identity projection while its decodeJson expects HEXEWKB. This is not covered by any test kit. It may be broken on PostGIS 3 and later, where to_json might use the geometry→json (GeoJSON) cast; I did not verify this.

### 6. Test kits
**`@internal/postgres-codec-testkit`** (`runPostgresCodecProjection`, `src/index.ts:384`) asserts, per case:
- the projection executes;
- a NULL column projects as `null`;
- encodeJson accepts the value;
- the projected value, after `canonicalFormOf`, deep-equals `encodeJson(value)` (element by element for arrays);
- decodeJson accepts the raw projected value;
- `decodeJson(projected)` equals the original value, or matches the case's `valueEquality`.

Its own suites: codec-conformance, array-lift, aggregate-conformance (declared result types against a live database), aggregate-defaults (values read back), date-time-text, interval-runtime-read, temporal-flat-nested-agreement, textual-trait, type-params (decodeJson enforces PostgreSQL's type parameters), uuid-input.

Packages that use it: pgvector and arktype-json (`test/codec-conformance.integration.test.ts`).

**`@internal/sqlite-codec-testkit`** (`src/index.ts:246`) asserts the same properties without array cases. Only its own tests use it: codec-conformance, aggregate-conformance, aggregate-defaults.

There is no Mongo or framework codec conformance kit.

### 7. `toCanonicalForm` / `canonicalFormOf`
**Definitions on data types:**
- pg/int8: `postgres/.../data-types.ts:153`, using `integerTextCanonicalForm` from `2-sql/1-core/contract/src/data-type-support.ts:45`.
- pg timetz, interval, bytea, date, time, timestamp, timestamptz: `typeCanonicalFromText` at :351-356. The same function object is also each type's cast from pg/text.
- sqlite/integer: `sqlite/.../data-types.ts:40`.
- pgvector: `pgvector/src/core/data-types.ts:54,80`.

**Definitions on codec descriptors:** `SqliteDatetimeDescriptor` (sq-codecs:582, :594) and `SqliteJsonDescriptor` (:654, :677).

**`canonicalFormOf` readers:**
- `data-type-default.ts:216` (PSL)
- `2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:131` (schema IR for plan and verify)
- `default-mapping.ts:282` (print and infer)
- `postgres/.../psl-infer/infer-model-blocks.ts:409`
- the two test kits (postgres :356, sqlite :329)

**Schema IR non-enumerable carriers:**
- `2-sql/1-core/schema-ir/src/ir/sql-column-ir.ts:84,124,140,173`
- `sql-column-default-ir.ts:39,70,81,116` (in `isEqualTo`) and `:132` (in `explainMismatch`)

**Helpers:**
- `default-in-canonical-form.ts:20` (`defaultInCanonicalForm`) and `:59` (`contractDefaultRefusal`)
- `resolved-default-equality.ts:20,92`

**Helper consumers:**
- postgres `migrations/column-ddl-rendering.ts:82,90,106,156`
- sqlite `column-ddl-rendering.ts:65-67`
- `default-mapping.ts:280`
- `infer-model-blocks.ts:405`

**File counts:** 20 production files and 21 test files (framework-components 2, mongo-contract 1, sql contract 1, schema-ir 3, contract-psl 1, 9-family 2, pgvector 1, postgres target 5, sqlite target 4, sqlite adapter 1).

### 8. Docs
- **ADRs** in `docs/architecture docs/adrs/`: 184, 186, 204 (Single-Path Async Codec Runtime), 207 (Codec call context), 254, 126, 030, 114, 155, 158, 169, 202, 208, 209, 215.
- **References:** `docs/reference/codec-authoring-guide.md`, `error-reference.md`, `integer-representation-types.md`, `framework-gaps.md`, `community-generator-migration-analysis.md`.
- **Releases:** `docs/releases/v0.15.0.md`, `v8.0.0-rc.12.md`, `rc.14.md`, `rc.15.md`. Also `CHANGELOG.md`.
- **Subsystem docs:** `docs/architecture docs/subsystems/1, 4, 5 (:245 driver boundary claim), 6`. These use encode/decode generically.
- **READMEs:**
  - `packages/1-framework/1-core/framework-components/README.md`
  - `packages/1-framework/1-core/ts-render/README.md`
  - `packages/2-mongo-family/1-foundation/mongo-codec/README.md`
  - `packages/2-sql/2-authoring/contract-ts/README.md`
  - `packages/2-sql/4-lanes/relational-core/README.md:96`
  - `packages/3-extensions/arktype-json/README.md`
  - `packages/3-extensions/sql-orm-client/README.md`
  - `packages/3-mongo-target/2-mongo-adapter/README.md`
  - both test kit READMEs
- **Skills:** 11 files under `skills/prisma-8/upgrading/{app,extension}/upgrades/*/instructions.md`.
- **Upgrade instructions:** 5 files under `upgrade-instructions/releases/*`.
- **Agent rules:** `.agents/rules/adr-writing.mdc:10` and `test-database-limitations.mdc:88` (generic). `skills-contrib`: none.
- **Planning notes:** 50 files under `projects/`.

### What "a codec never sees contract.json" would break
1. **The wire is not "text/bytes".** Codecs exchange numbers, booleans, bigints, arrays and `Uint8Array`, and Mongo exchanges BSON class instances. `decode` takes driver-parsed JSON and interval objects. Subsystem doc 5:245 says otherwise.
2. **Database JSON is not the contract form.** For dates and times, sqlite/json and numeric, runtime decodeJson gets the database's own spelling (session-TimeZone text, stored JSON text). Each decodeJson accepts both spellings on purpose. A `fromDataTypeValue` fed from database JSON has to do the same, or the projection has to produce the contract form.
3. **Some codecs need their own contract form inside one data type.** sqlite/text hosts both datetime and json, whose canonical forms differ (sq-codecs:582-677). sql/int@1 stores a JSON number on Postgres but digit text on SQLite (sq-codecs:324-331). A data-type-level `fromContract`/`toContract` would need new data types (sqlite/datetime, sqlite/json) or per-codec overrides.
4. **Contract values are used as database values with no codec at all:**
   - enum CHECK literals (`build-contract.ts:596-620` → `postgres/src/core/check-expressions.ts:63-80`; psl-print `model-attributes.ts:49`);
   - Mongo `$jsonSchema` enums (`derive-json-schema.ts:43-62`), wrong for int64, date or objectId enums;
   - discriminator values (sql-orm-client).
5. **`renderValueLiteral` takes contract-form JSON**, including the Mongo descriptors. `renderTsLiteral` says it is valid only for identity codecs (`render-ts-literal.ts:8-11`).
6. **The type-level `json` channel is `ReturnType<encodeJson>`** and is baked into 256 tracked `contract.d.ts` and fixture files.
7. **Authoring compares by encodeJson output:** enum duplicate detection, the `assertStoredAsWritten` read-back, and the value-object default document read (`value-object-default.ts:55-83`).
8. **Aggregate descriptors hold `emptyResultJson`**, authored JSON that goes straight to codec decodeJson.
9. **ADR 184's "contract load decodes" claim is already false.** Only the DDL renderer decodes contract literals, at migration apply time. `Date` literals and refused `null`s are special-cased there, and Postgres date/time defaults are written from contract text, bypassing the codec's wire value.
10. **The target descriptor adapters already drop a template's `toCanonicalForm`.** This is harmless today because no SQL template declares one.
