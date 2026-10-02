# Design: data types own column types

This document is the contract for implementers. Where it and an inventory file disagree, this document wins. Where it is silent, stop and ask the orchestrator; do not choose. Snippets are illustrative until re-verified against the code, as `drive/spec/README.md` requires. `reviews/design-verification.md` holds the evidence for many rules below.

The work is four slices, in this order: slice 1 (TML-3386, sections 2 to 6), slice 2 (TML-3388, sections 7 to 10), slice 3 (TML-3387, sections 11 to 13), slice 4 (TML-3389, section 14).

## 1. Terms

- **Data type**: the type of a value Prisma stores or passes to the database, registered by id (`pg/int8`), as ADR 254 defines it. A column's data type is what the database stores; in SQL it is a `SqlDataType`. `sql/expression` is the one data type no column has.
- **Codec**: one representation of a data type's values in memory, on the wire and in `contract.json`. Every codec names exactly one data type. The data type owns its canonical form and its casts (ADR 254); the codec reads, writes and checks values. A data type never parses or prints SQL value literals.
- **Text**: one way a database type is written or reported, possibly with parameters: `timestamp(3) with time zone`.
- **Written text**: the text a migration writes. **Catalog text**: the text the database catalog prints (`format_type` on Postgres, `PRAGMA table_info` on SQLite). **Claiming text**: a text that is `catalog` or carries neither mark; only claiming texts are used to recognise a reported type.
- **Base name**: the name of a data type with no parameters, used where parameters must not appear (section 2.3).
- **Type constructor**: how a schema names a column type: `Numeric(10, 2)`.
- **Claim**: a data type claims a reported type when one of its claiming texts matches it, or when it claims the type's kind.

There is no "stored as" concept. The resolver receives the kind of a type, not a list of enum names. `pg/tsquery` gets no type constructor.

# Slice 1: each SQL data type declares its facts (TML-3386)

Outcome: every fact about a SQL database type is declared once on its data type, and every copy is deleted. `contract.json` and every example's DDL are unchanged, except the `typeRef` quoting fix in 3.6.

## 2. The declaration

### 2.1 Framework

`DataType` in `packages/1-framework/1-core/framework-components/src/shared/data-type.ts` gains one optional field, `params`, an arktype object schema of the type's parameters. `DataTypeSpec` gains the same. A data type without `params` has none.

### 2.2 The SQL data type module

New file `packages/2-sql/1-core/contract/src/sql-data-type.ts`, exported from a new entry point `@internal/sql-contract/data-type` (shared plane, by the glob `packages/2-sql/1-core/**`). Every SQL layer, every target, every extension and both planes may import it. It holds:

```ts
interface SqlTypeText {
  readonly text: string;          // lower case; `{name}` placeholders
  readonly written?: true;        // a migration writes this text
  readonly catalog?: true;        // the database catalog prints this text
  readonly display?: string;      // the exact characters written and printed, when they differ from `text` in letter case only
}

interface SqlDataTypeSpec<Params> extends DataTypeSpec {
  readonly texts?: readonly SqlTypeText[];
  readonly claimsKind?: string;
  readonly normalize?: (params: Params) => Params;
  readonly render?: (params: Params) => string;
  readonly fromReported?: (reported: ReportedSqlType) => Params;
}

interface SqlDataType<Params> extends DataType {
  readonly sql: { texts; claimsKind; normalize; render; fromReported };
}
```

and the functions `sqlDataType`, `isSqlDataType`, `dataTypeParams`, `sqlBaseName`, `renderSqlTypeName`, `renderSqlCatalogText`, `resolveReportedSqlType`, and the type `ReportedSqlType` (section 5).

Rules, enforced by `sqlDataType` when called, with an `InternalError` naming the id:

1. A `text` is lower case, has single spaces, and contains only literal characters and placeholders `{name}`. Every placeholder names a key of `params`. A placeholder matches one or more decimal digits and yields an integer.
2. Among texts with the same set of placeholders, at most one is `written` and at most one is `catalog`. A text may be both.
3. `display`, when present, equals `text` compared without regard to letter case.
4. `render` and `fromReported` are allowed only together with `claimsKind`, and then `texts` must be absent.
5. A text marked only `written` never claims. A text marked `catalog`, or with neither mark, claims.
6. Every normal form has a written text, because the contract side of verify writes the normal form (3.4). The check: for no parameters, and for each text's placeholders set to `1`, parameters that `params` accepts are normalised, and a `written` text must have exactly the normalised keys. A type with no written text (`pg/text-array`) or with `claimsKind` is exempt.

### 2.3 Writing a name

`dataTypeParams(type, typeParams)` keeps only the keys of `type.params`, read from the arktype object schema's `props` as `requiredKeysOf` does in `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts:113-121`. A type without `params` gets `{}`. Every caller of the three functions below passes its parameters through it first, so codec-owned keys (`arktype/json@1`'s `expression`, `jsonIr`) never reach them.

`sqlBaseName(type, params)`:

1. If the type has `render`, return `render(params)`. (`pg/enum` needs `typeName`.)
2. Otherwise return the `display` or `text` of the `written` text whose placeholder set is empty; if there is none, the `written` text with the fewest placeholders, cut before its first `(`. Values: `vector` for `pgvector/vector`; for every other type in 2.6, the written text with no placeholders.

`renderSqlTypeName(type, params)`:

1. Validate `params` against `type.params`. A failure throws the structured error `CONTRACT.TYPE_PARAMS_INVALID` naming the data type and the parameter.
2. If the type has `render`, return `render(params)`.
3. Use the raw parameters, not the normalised ones, and drop only the keys that `normalize` removes (the `length` of the two SQLite character types).
4. Pick the `written` text whose placeholder set equals the remaining keys. None: throw `CONTRACT.TYPE_PARAMS_INVALID` with the message `<id> cannot be written with parameters <keys>; it is written with <list of placeholder sets>`.
5. Replace each placeholder with its value, in `display` when the text has one, else in `text`.

Because step 3 uses the raw parameters, `Char` with no length writes `character` and `Numeric(10)` writes `numeric(10)`, as today. Lists: the caller appends `[]`. SQLite upper-cases the written name, as today.

`renderSqlCatalogText(type, params)` is the same with `normalize(params)` and the `catalog` texts, using `display` where present. A type with `claimsKind` has no catalog text; callers use section 12.3 instead. It is used only for the `ALTER COLUMN TYPE` postcheck.

### 2.4 Parameters: one bound each

The data type's `params` schema is the only place a bound is written.

1. A codec descriptor's `paramsSchema` is its data type's `params` object, referenced, never restated. A codec with keys of its own sets `paramsSchema` to `dataType.params.and(ownKeys)`, or to `ownKeys` when the data type has no `params` (`arktype/json@1`). A codec is parameterised exactly when it has a `paramsSchema`, as today, so the runtime still builds one codec instance per column from the full `typeParams`.
2. Type constructor and field preset arguments mapped onto a data type parameter lose `minimum` and `maximum`. Validation of such an argument is validation of the resulting `typeParams` against the codec's `paramsSchema`, reported at the argument with the existing code `PSL_INVALID_ATTRIBUTE_ARGUMENT` and the schema's message. An argument that also feeds a generator parameter keeps its own bounds: today that is `size` of the `nanoid` and `id.nanoid` presets, 2 to 255.
3. The temporal presets' shared `precision` bound (`packages/2-sql/9-family/src/core/timestamp-now-generator.ts:22-28`) is deleted.

| Data types | Parameter | Bound |
| --- | --- | --- |
| `pg/numeric` | `precision`, optional | integer 1 to 1000 |
| `pg/numeric` | `scale`, optional, only with `precision` | integer -1000 to 1000 (Postgres 15 allows a negative scale; `main` supports it since TML-3278) |
| `pg/char`, `pg/varchar` | `length`, optional | integer 1 to 10485760 |
| `pg/bit`, `pg/varbit` | `length`, optional | integer 1 to 83886080 |
| `pg/time`, `pg/timetz`, `pg/timestamp`, `pg/timestamptz`, `pg/interval` | `precision`, optional | integer 0 to 6 |
| `pg/enum` | `typeName`, required | non-empty string |
| `pgvector/vector` | `length`, required | integer 1 to 16000 |
| `postgis/geometry` | `srid`, optional | integer 1 or more |
| `sqlite/character`, `sqlite/character-varying` | `length`, optional | integer 1 or more |
| `mongo/vector` | `length`, optional | integer 1 or more |

### 2.5 Normal forms

| Data type | `normalize` |
| --- | --- |
| `pg/numeric` | a `precision` with no `scale` gains `scale: 0` |
| `pg/char`, `pg/bit` | no `length` becomes `length: 1` |
| `sqlite/character`, `sqlite/character-varying` | `length` is removed |
| every other type | identity |

### 2.6 The declarations

Every text below is complete: no other text is declared. `W` marks written, `C` catalog; a text with neither mark claims only. Casts and `listCast` stay exactly as they are today.

**Postgres target** (`packages/3-targets/3-targets/postgres/src/core/data-types.ts`):

| Id | Texts |
| --- | --- |
| `pg/text` | `text` W C |
| `pg/int2` | `int2` W; `smallint` C |
| `pg/int4` | `int4` W; `integer` C; `int` |
| `pg/int8` | `int8` W; `bigint` C |
| `pg/float4` | `float4` W; `real` C |
| `pg/float8` | `float8` W; `double precision` C; `float` |
| `pg/bool` | `bool` W; `boolean` C |
| `pg/numeric` | `numeric` W C; `numeric({precision})` W; `numeric({precision},{scale})` W C; `decimal`; `decimal({precision})`; `decimal({precision},{scale})` |
| `pg/json`, `pg/jsonb`, `pg/uuid`, `pg/inet`, `pg/bytea`, `pg/date`, `pg/tsquery` | its own name W C |
| `pg/char` | `character` W; `character({length})` W C; `char`; `char({length})` |
| `pg/varchar` | `character varying` W C; `character varying({length})` W C; `varchar`; `varchar({length})` |
| `pg/bit` | `bit` W; `bit({length})` W C |
| `pg/varbit` | `bit varying` W C; `bit varying({length})` W C; `varbit`; `varbit({length})` |
| `pg/time` | `time` W; `time({precision})` W; `time without time zone` C; `time({precision}) without time zone` C |
| `pg/timetz` | `timetz` W; `timetz({precision})` W; `time with time zone` C; `time({precision}) with time zone` C |
| `pg/timestamp` | `timestamp` W; `timestamp({precision})` W; `timestamp without time zone` C; `timestamp({precision}) without time zone` C |
| `pg/timestamptz` | `timestamptz` W; `timestamptz({precision})` W; `timestamp with time zone` C; `timestamp({precision}) with time zone` C |
| `pg/interval` | `interval` W C; `interval({precision})` W C |
| `pg/text-array` | none: claims nothing, is never written |
| `pg/enum` | none; `claimsKind: 'enum'`; `render` and `fromReported` as in section 11.3 |

`numeric(10)` is reported as `numeric(10,0)`: the catalog text for the normalised parameters. `bpchar`, the quoted text `"char"`, and `interval` with fields are declared by nothing.

**pgvector**: `pgvector/vector`: `vector({length})` W C. **postgis**: `postgis/geometry`: `geometry` W C; `geometry(geometry,{srid})` W C with `display: 'geometry(Geometry,{srid})'`.

**SQLite target** in slice 1: `sqlite/text`, `sqlite/json`, `sqlite/datetime`: `text` W; `sqlite/integer`, `sqlite/bigint`: `integer` W; `sqlite/real`: `real` W; `sqlite/blob`: `blob` W. Two data types are added, each casting from `sqlite/text` unchanged: `sqlite/character` (`character` W) and `sqlite/character-varying` (`character varying` W). `sql/char@1` and `sql/varchar@1` on SQLite name them. In slice 1 no SQLite text claims; slice 2 replaces this set (section 9).

**Mongo**: `packages/2-mongo-family/1-foundation/mongo-contract/src/mongo-data-type.ts`, exported from its own entry point `@internal/mongo-contract/data-type`, defines `mongoDataType(id, { bsonTypes, params?, casts? })` and `isMongoDataType`. As SQL keeps its facts in a `sql` object, the declared type keeps them in a `mongo` object: `type.mongo.bsonTypes`, and `isMongoDataType` tests for `mongo`. `bsonTypes` is a list that may be empty. The values are today's `targetTypes` of each type's codec (inventory `data-types.md` section 5): twelve types, `mongo/json` with eight names, `mongo/bson` with none.

### 2.7 Rules fixed while building dispatch a

1. **Listing data types.** `DataTypeLookup` gains `all(): readonly DataType[]`, in assembly order. `resolveReportedSqlType` takes that list; the collision check of 5.2 and every later caller use it.
2. **Literal characters.** The literal parts of a `text` may contain lower-case letters, digits, spaces, `_`, `.`, `,`, `(` and `)`. Placeholder names are exact `params` keys and may contain upper-case letters.
3. **Text preparation** (11.2 step 2) applies outside double quotes only; quoted text is kept exactly as reported. Spaces directly after `(` or `,` and directly before `)` are removed, including when the next character is a double quote. A space before `,` is kept.
4. **`display`** must equal `text` compared without regard to letter case, and every placeholder in `display` must be written exactly as in `text`.
5. **Programming errors** in a declaration or a call are `InternalError`: a declaration that breaks a rule of 2.2; `sqlBaseName` on a type with no written text and no `render` (`pg/text-array`); `renderSqlCatalogText` on a type with `claimsKind`. `texts: []` beside `claimsKind` is refused like any `texts` there.
6. **Kind claims** are validated and normalised like text claims: `resolveReportedSqlType` validates `fromReported`'s result against `params` (a failure is `undefined`) and returns `normalize` of it. `sqlBaseName` validates the parameters it passes to `render`, throwing `CONTRACT.TYPE_PARAMS_INVALID`.
7. **Parameters are validated where a column uses a type.** A `storage.types` entry that no column references is not validated against its data type's `params`. pgvector's contract space keeps its bare `vector` entry with `typeParams: {}` (`packages/3-extensions/pgvector/src/contract.ts`), which exists so the extension's space is not empty.
9. **SQLite registers `sql/char@1` and `sql/varchar@1`.** The SQLite adapter filters them out of its registered codecs today (`packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts`), so the stack cannot find them although `examples/prisma-8-demo-sqlite` uses `sql/char@1`. The SQLite adaptations of both codecs name `sqlite/character` and `sqlite/character-varying`, carry no `renderOutputType` (SQLite imports no `Char<N>` or `Varchar<N>` type), and are registered in `types.codecTypes.codecDescriptors` like every other SQLite codec. The stack's codec lookup and the emitter both read that list, so there is one registry per target. Consequence, accepted: each emitted SQLite `contract.d.ts` whose stack includes these codecs gains the aggregate rows (`min`, `max`) for them. `contract.json`, hashes and DDL do not change. A side registry for the planner was rejected, because it would be a second source for which codecs a target has.
8. **Tests use registered codecs.** A planner or verify test that builds a column from a codec id no stack registers (for example `pg/tsvector@1` in `packages/3-extensions/pgvector/test/migrations/planner.behavior.test.ts`) registers a test-only data type and codec in its test stack. A test that builds a `text[]` column from `pg/text-array@1` uses `pg/text@1` with `many: true`.

### 2.8 Resolving a reported type (function only)

`resolveReportedSqlType` is defined in slice 1 (section 11.2) with unit tests, so that TML-3253's lookup can use it (section 3.7). Slice 3 wires it into introspection, verify and infer.

## 3. Who registers, readers, and what is deleted

1. The Postgres and SQLite targets' descriptor metadata register `dataTypes`, in the control and runtime planes; the adapters stop. The scalar type constructors are defined in each target (`src/core/type-constructors.ts`) and contributed by the adapter, as `main` does since TML-3278: the TypeScript builder's `type.*` helpers are built from the family, the target and the extensions, so a target that contributed them would add `type.String()` and similar helpers to the builder's public surface. The data type authoring entries (`authoring.dataTypes`: the tags, the plain entries and the number classifier) are contributed by the target, because the pack that owns a data type contributes its PSL support. TypeScript column helpers keep their public import paths.
2. Each SQL target exports its data types from `./data-types`, which both targets have. Slice 1 adds the Postgres target's shared files (`src/core/data-types.ts`, `src/core/data-type-entries.ts` and what they import) and both targets' `src/exports/data-types.ts` to `architecture.config.json` with plane `shared`; the rest of `src/core/**` stays unmapped. The helpers both targets' declarations and entries use (the number classifier, the JSON body reader and printer, `escapePslString`, the 64-bit integer canonical form and `canonicalDateTime`) live in `@internal/sql-contract/data-type-support`, in the shared plane. Runtime target and extension descriptors register the same `dataTypes`. `createSqlExecutionContext` assembles a `DataTypeLookup` with the owner check of `assembleDataTypes` and passes it to the Postgres SQL renderer next to `codecDescriptorRegistry`.
3. Deleted, with every reader moved to the data type: `targetTypes` on `CodecDescriptorTemplate` and every declaration; `targetTypesFor`; `byTargetType`; the Postgres codec hook `nativeType(params)` and `nativeTypeFor`; `controlPlaneHooks[codecId].expandNativeType`, `expandLength`, `expandPrecision`, `expandNumeric`, the pgvector, postgis and arktype-json hooks; `buildNativeTypeExpander`; `buildSqlTypeMetadataRegistry` and `typeMetadataRegistry`; `ControlAdapter.normalizeNativeType`; `deriveAnnotations`' `storageTypes`; `validateScalarTypeCodecIds`. Pack metadata `types.storage[].nativeType` stays until slice 2, because it is copied into 15 committed contracts. `inventory/change-list.md`'s "Becomes" text binds for every file it lists, including `examples/prisma-8-demo/src/app/ContractView.tsx` and the language server. The released `stamp-storage-types-kind.ts` upgrade scripts are not changed.
4. `ContractToSchemaIROptions` replaces `expandNativeType` with `dataTypeLookup: DataTypeLookup` and `codecLookup: CodecLookup`, both required. The contract side's type text is `renderSqlTypeName` of the column's data type and the normal form of its `dataTypeParams`, plus `[]` for lists. It uses the normal form because verify compares it with what the catalog prints, and the catalog prints the normal form: a `Numeric(10)` column is written `numeric(10)` and reported `numeric(10,0)`, and a bare `Char` is reported `character(1)`. A type with `claimsKind` gives its `typeName` unquoted.
5. Readers after the change:
   - Both planners' `buildColumnTypeSql` call `renderSqlTypeName` with the column's data type, found through `codecLookup.descriptorFor(codecId).dataType`.
   - The Postgres planner chooses `SERIAL`, `BIGSERIAL`, `SMALLSERIAL` for data type ids `pg/int4`, `pg/int8`, `pg/int2`. Identity values and `renderDefaultLiteral`'s JSON branch test data type ids.
   - `SAFE_WIDENINGS` in `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` is keyed by data type ids: `pg/int2→pg/int4`, `pg/int2→pg/int8`, `pg/int4→pg/int8`, `pg/float4→pg/float8`.
   - The Postgres SQL renderer's parameter casts render `sqlBaseName(type, params)`, never the parameters, because an explicit cast to `varchar(n)` truncates and to `numeric(p,s)` rounds. `$1::integer` becomes `$1::int4`. `POSTGRES_INFERRABLE_NATIVE_TYPES` becomes a set of data type ids: `pg/int2`, `pg/int4`, `pg/int8`, `pg/float4`, `pg/float8`, `pg/numeric`, `pg/bool`, `pg/text`, `pg/char`, `pg/varchar`, `pg/timestamp`, `pg/timestamptz`, `pg/time`, `pg/timetz`, `pg/interval`, `pg/bit`, `pg/varbit`.
   - `enum` blocks take their column's data type from the `@@type` codec. An `enum` block whose `@@type` codec represents a data type with a required parameter is refused: `PSL_ENUM_TYPE_NEEDS_PARAMETERS`, naming the parameter.
   - The Mongo enum factory and `deriveJsonSchema` read `bsonTypes`. `deriveJsonSchema` and `derivePolymorphicJsonSchema` gain a required `dataTypeLookup: DataTypeLookup` argument and read `dataTypeLookup.get(codecLookup.descriptorFor(codecId).dataType).mongo.bsonTypes`.
   - The Prisma 7 binding's `literalDefaultForm` tests data type ids.
6. **`typeRef` columns.** A `typeRef` column is written exactly as a column of the referenced entry's data type and parameters. The quoting of `typeRef` names (`planner-ddl-builders.ts:93-96`) and `codecNamedType` in `column-ddl-rendering.ts` are deleted. This is the one DDL change of the project: today a `types { Id = Uuid }` alias writes `"uuid"`, and a `VarChar` alias writes `"character varying"`, which Postgres rejects. No committed `ops.json` contains such a column.
7. **TML-3253's lookup.** If TML-3253 has merged when slice 1 starts, its lookup from a reported type name to a codec (through `targetTypes`) is replaced in slice 1 by `resolveReportedSqlType` over the stack's data types, followed by the codec rule of section 12.4. If it has not merged, TML-3253 uses that function.

## 4. Writing the contract in slice 1

The contract still stores `nativeType` in slice 1. Every writer of a column's or a `storage.types` entry's `nativeType` writes `sqlBaseName` of the codec's data type with the column's `dataTypeParams`: `buildStorageColumn`, the `type.*` helpers' results, `types {}` aliases, raw `storage.types`, and constructor and preset resolution. For a type with `claimsKind` (`pg/enum`) the stored name is `typeParams.typeName` unquoted, as today, not `sqlBaseName`, whose `render` quotes it. The value-object column keeps `jsonb`.

`buildSqlContractFromDefinition` requires `codecLookup` and a new `dataTypeLookup` argument from slice 1. `ColumnTypeDescriptor.nativeType` becomes optional and is ignored.

`AuthoringStorageTypeTemplate` loses `nativeType`. A constructor or preset output is `{ codecId, typeParams? }`. Each constructor gains an optional flag `inferred: true`, set as listed in 13.4. `postgis.Geometry`'s `srid` becomes optional.

One contract change follows for users only: the five shared column packagers in `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts:84-243` passed `int`, `float`, `char`, `varchar` and `text`, so a user contract built with `sqlIntColumn` changes `nativeType` from `int` to `int4`, and its hash with it. No committed contract uses them.

## 5. Assembly checks

1. In `enforceDataTypeInvariants` (framework, `control-stack.ts`), each an `InternalError` naming the contributor and the id: a type constructor or field preset names a codec for which `codecLookup.descriptorFor` returns nothing; a constructor maps an argument onto a key that neither the codec's data type's `params` nor the codec's own keys declare; two constructors of one data type are both marked `inferred`.
2. In one SQL family check, `enforceSqlDataTypeInvariants(stack.declaredDataTypes, stack.codecDescriptors)` in `packages/2-sql/9-family/src/core/assembly.ts`, called at the start of `createSqlControlFamilyInstance`, each naming the contributor: two SQL data types in the stack have claiming texts that collide, or claim the same kind; a data type casts from `sql/expression` (`CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`, from TML-3296); a codec represents a data type that is not a `SqlDataType`, because a codec represents a column's type and `sql/expression` is the one data type no column has. Two texts collide when either text's pattern matches the other text with each placeholder replaced by `1`.

## 6. Tests and docs for slice 1

- Per pack, a test that lists every registered data type and asserts its declaration equals section 2.6, and fails for a registered type with no entry.
- Per data type with parameters: every row of inventory `data-types.md` section 1.3 "Written today" as a `renderSqlTypeName` case; `sqlBaseName` for every type; every bound in 2.4 at its edges; `normalize` applied twice equals once.
- `resolveReportedSqlType` unit tests on every claiming text in 2.6, with different letter case and spacing, and on `"char"`, `bpchar` and `interval year to month` (unclaimed).
- **DDL unchanged.** A test plans every committed example and fixture contract from an empty contract, with the base commit's `plan()` output recorded as golden files, and asserts slice 1's output is byte-identical. `pnpm migrations:regen` does not run the planner and is not this test.
- Runtime: a parameter cast test expecting `$1::int4`, and one with a `varchar(255)` column expecting no length in the cast.
- Assembly: one test per check in section 5. `pnpm fixtures:check` shows no change.
- Docs: ADR 171 marked superseded by ADR 254; `docs/reference/codec-authoring-guide.md` gains "Declaring a data type" and loses the rendering hook section; `docs/reference/error-reference.md` gains `CONTRACT.TYPE_PARAMS_INVALID`.
- Upgrade instruction, extension audience only: `upgrade-instructions/pending/data-types-declare-names/extension/instructions.md`, following `skills-contrib/record-upgrade-instructions/SKILL.md`. It covers every change an extension author sees in slice 1: `postgresCodec` takes the data type object instead of its id; codec `targetTypes` and the `expandNativeType` hooks are gone, replaced by `sqlDataType` texts on the extension's data type; a codec's `paramsSchema` is its data type's `params`; type constructor templates lose `nativeType`. `pnpm check:upgrade-coverage --mode pr` must pass. Application authors see no change in slice 1, so there is no app-audience instruction.

# Slice 2: the contract names the data type (TML-3388)

Outcome: `contract.json` stores `dataType` instead of `nativeType`; SQLite's data types are the ones the database stores; users upgrade with a script and `db sign`. Every hash changes once, in this slice.

## 7. The contract format

1. `StorageColumnInput`, `StorageColumnSchema`, `StorageTypeInstance` and its validator: `nativeType` removed; `dataType: string` required, matching the data type id pattern. The schema keeps rejecting unknown keys, which refuses an old contract with the standard `CONTRACT.VALIDATION_FAILED`; the message for this key is `<path>.nativeType: contracts no longer store a column's database type name; the column names its data type in "dataType"`. The refusal looks for `nativeType` only on columns and `storage.types` entries, the places where old contracts stored it, so a JSON default whose document contains a `nativeType` key still loads. The message lists the first five such paths in this form; when there are more, it ends with `and <n> more paths (<total> in all)`.
2. `buildStorageColumn` and every writer of section 4 write the codec's data type id.
3. `ColumnTypeDescriptor` becomes `{ codecId, typeParams?, typeRef?, valueSet?, entityRef? }`; the fourth argument of `column()` is deleted; every helper in inventory `type-constructors.md` section 3 drops the field. A `type.*` helper returns `{ kind, codecId, typeParams }`; the builder adds `dataType` and validates the parameters against the codec's `paramsSchema`, throwing `CONTRACT.ARGUMENT_INVALID` with the schema's message and the helper path.
4. The validator without a stack compares junction columns by `dataType` and canonical `dataTypeParams`. Two checks run in `SqlControlFamilyInstance.deserializeContract` (`packages/2-sql/9-family/src/core/control-instance.ts:651`) after the serializer, using `stack.codecLookup` and `stack.authoringContributions`, and not at runtime: each column's codec represents its `dataType` (failure `<path>: codec <codecId> represents <its data type>, not <dataType>`); a value-object column uses the codec of the stack's `valueObjectStorageType` constructor. The hard-coded set `json`, `jsonb` is deleted. `verify` and `verifySchema`, which also accept contract JSON, read it through the same function as `deserializeContract`, so they run both checks too.
5. `contract.d.ts`: the emitter writes `readonly dataType: '<id>'` where it wrote `nativeType`. The contract type built by `contract-ts` declares `readonly dataType: string`; type tests that compared the two literally compare `codecId` only. The JSON Schema `data-contract-sql-v1.json` is regenerated.
6. Pack metadata: the `types.storage` list of every pack and its type `StorageTypeMetadata` are deleted, because nothing reads them once `nativeType` is gone, and with them `extensions.<pack>.types.storage` in `contract.json`. `contract-enrichment.ts` copies only the `types` keys a contract carries (`codecTypes`, `aggregateDescriptors`, `queryOperationTypes`, and pgvector's `operationTypes`), so a pack built for an earlier framework that still declares the list does not write it into a contract. The list lies outside every hash, so no hash changes for it.
7. Enum columns: `dataType` is `pg/enum`; `typeParams.typeName` is unchanged; the qualifier hook rewrites only `typeParams.typeName`.
8. `DdlColumnRenderContext`, `DdlColumnDefaultVisitor` and the `accept` method of the two column default classes are deleted, because nothing implemented or called them. A field that holds a base name is called `baseTypeName`: `DefaultRenderer`'s third argument is `{ dataType, baseTypeName }` and the Postgres `DefaultColumn` is `{ many?, baseTypeName, dataType }`, where `dataType` is the data type id, as on a stored column. `typeText` is kept for the full text slice 3 introduces. `assertSafeNativeType` and the code `CONTRACT.NATIVE_TYPE_INVALID` are deleted, with their error reference entry: names now come from declarations, and enum names are quoted by `render`.

## 8. `db sign` and `migrate`

1. `db sign` loads the aggregate with `contract-space-aggregate-loader.ts`, as `migrate` does. It verifies each space with `strict: false`. It reads every space's marker before it introspects. It then opens a transaction through `SqlControlAdapter.withTransaction(driver, fn)` (Postgres `BEGIN`; SQLite `BEGIN IMMEDIATE`). Through `SqlControlAdapter.lockMarker` it takes the lock the migration runner holds while it reads and writes markers: one lock per database, whatever the spaces or the contracts' namespaces, because the marker table holds every space's marker; on Postgres this is the advisory lock keyed by `MARKER_LOCK_KEY`. It handles the spaces in the order `migrate` applies them, extension spaces first, which one helper, `spacesInApplyOrder`, gives both commands. It writes each verified space's marker only while the marker still holds the hashes read before introspection, commits, and then advances each signed space's `db` ref and writes its snapshot. A ref or snapshot write that fails does not undo the markers. The command still writes every other ref, then fails with `MIGRATION.SIGN_REFS_NOT_WRITTEN` (exit code 2). The error says the database was signed, names each ref it could not write and why, names the spaces it did not sign (failed verification, or a marker that changed), and gives the `db sign` command to run again, with the same contract and `--advance-ref` arguments. The second run finds the markers already hold the contracts and writes only the refs. A space that failed verification is not signed and is reported with its drift; the command then exits with code 4. A space whose marker changed, when it is read inside the transaction or when the compare-and-swap write finds another value, is not signed either: it is reported with status `conflict` and a `MIGRATION.MARKER_CAS_FAILURE` diagnostic, and the command exits with code 4. Mongo implements the same family method and signs its spaces one by one, without a transaction; the transaction is required on Postgres and SQLite only. An unchanged space advances its ref too, so the command is idempotent, and `--advance-ref` names the ref for every space. The single-space `sign` of `ControlFamilyInstance` and of the control client is deleted with `SignOptions` and `SignDatabaseResult`; `signSpaces` and `dbSign` replace them.
2. The `MIGRATION.MARKER_MISMATCH` refusal of `migrate` (`packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts:486-519`) adds the fix line that `migration status` already uses for `db sign`.

## 9. SQLite's data types

1. The SQLite target declares exactly: `sqlite/text` (`text` W C), `sqlite/integer` (`integer` W C), `sqlite/real` (`real` W C), `sqlite/blob` (`blob` W C), `sqlite/character` (`character` W C), `sqlite/character-varying` (`character varying` W C). `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are deleted.
2. Codecs: `sqlite/text@1`, `sqlite/json@1`, `sqlite/datetime@1` represent `sqlite/text`; `sqlite/integer@1`, `sqlite/bigint@1`, `sqlite/bigintnumber@1`, `sql/int@1` represent `sqlite/integer`; `sqlite/real@1`, `sql/float@1` represent `sqlite/real`; `sqlite/blob@1` represents `sqlite/blob`; `sql/char@1` and `sql/varchar@1` represent the two character types.
3. Canonical forms: `sqlite/text` a string; `sqlite/integer` digit text; `sqlite/real` a JSON number; `sqlite/blob` uppercase hex text as today. Each codec's `encodeJson` and `decodeJson` produce and read exactly that form: `sqlite/json@1` stores the JSON text of the document; `sqlite/datetime@1` its text; the integer codecs digit text. A codec whose values have a canonical form finer than its data type's declares it with the optional codec field `toCanonicalForm`: on SQLite, `sqlite/datetime@1` (a UTC ISO timestamp) and `sqlite/json@1` (the document's JSON text with sorted keys and no added whitespace), both over `sqlite/text`. The data type's canonical form stays the coarser one. One rule gives a column's canonical form: the codec's `toCanonicalForm` when it declares one, else its data type's. One helper reads it, `canonicalFormOf(codec, dataTypes)` in `@internal/framework-components/codec`; the PSL reader, `contract print`, `contract infer` and `contractToSchemaIR`, which stores it on each schema IR column for verify, the planners and DDL, all take it from there.
4. Written values: the `json` tag on SQLite yields `sqlite/text` with the canonical JSON text, through its own entry key (`tagEntryKey('json')`), because the plain string entry already holds the `sqlite/text` key, and an entry filed under the wrong key is refused at assembly with `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`; the number classifier yields `sqlite/integer` for a whole number of up to 64 bits, `sqlite/real` for a number with a fraction, and refuses the rest as today. Casts: `sqlite/real` from `sqlite/integer`; `sqlite/blob` and the two character types from `sqlite/text`. A `Json` column given a plain string is refused by the codec (`PSL_INVALID_DEFAULT_LITERAL`). A `String` column accepts a `json` literal. An enum member written as a number literal is read from its source text the way a default is read: the literal's entry gives it a data type, the enum codec's data type takes it directly or through a cast, and the codec checks it, so `Low = 1` under `@@type("sqlite/integer@1")` stores `"1"` and `A = 9007199254740993` under `@@type("pg/int8@1")` stores `"9007199254740993"`. A member written as a string literal, or as any other value, is read by the codec's `decodeJson`, as before this slice, so every string form accepted before is still accepted (for example `A = "3000000000"` under `pg/int8@1`, and the `pg/numeric`, `pg/json`, `pg/jsonb` and `sqlite/bigint` codecs). Slice 4 puts both under the cast rule (14.6).
5. SQLite constructors carry no `inferred` mark: SQLite has no `contract infer`, and `sql.String` is one constructor shared with Postgres, where `pg/varchar`'s mark is `VarChar`. Mongo constructors carry none either. A target that gains `contract infer` adds its marks then.
6. Verify on SQLite compares a literal default through the canonical form of the column's values (9.3), so a `sqlite/json@1` default written by hand with another key order or spacing is not drift; no list of codec ids is kept. Verify on SQLite still compares type text in this slice. The contract side renders `text`, `integer`, `real`, `blob`, `character`, `character varying`, which equal what `normalizeSqliteNativeType` gives for existing databases.

## 10. The upgrade

### 10.1 The script

One script per audience, under `upgrade-instructions/pending/data-type-in-contract/{app,extension}/`, following `skills-contrib/record-upgrade-instructions/SKILL.md`. It takes the project root, needs no database, network or stack, and is idempotent: it changes only contracts in the old format (an object carrying both `codecId` and `nativeType`, or an extension `types.storage` entry carrying `nativeType`), never a contract in the new format, whatever its stored hash, so a project already in the new format is left unchanged and the script exits 0.

1. Find every SQL contract: the emitted `contract.json`, every `snapshots/<hash>/contract.json`, and the extension copies beside them. Migration directories are found by their content, whatever they are called: a snapshot is any `snapshots/<hash>/contract.json`, a migration package any directory holding `migration.json`, a ref any JSON file in a `refs` directory; `node_modules`, `.git`, `dist` and `build` are skipped. A contract whose target family is not SQL is skipped.
2. Record each contract's old storage hash: its snapshot directory name, or `storage.storageHash` for an emitted contract. Recompute it from the file's content with `recomputePublishedStorageHash` (`packages/1-framework/3-tooling/migration/src/hash.ts:31-50`) and `sqlContractCanonicalizationHooks`. If it does not recompute, the file is still rewritten; the script prints `<file>: stored hash did not recompute; rehashed from content` and continues.
3. For each object in the contract that carries both `codecId` and `nativeType` (whatever the file's layout), look up the data type id in the table of inventory `upgrade-rewrite.md` section 3, as corrected by section 9. The `sql/*` codecs map by the contract's target. The table also maps these retired ids on target `postgres`: `pg/timestamptz@1` to `pg/timestamptz`, `pg/timestamp@1` to `pg/timestamp`, `pg/time@1` to `pg/time`, `pg/date@1` to `pg/date`, `sql/timestamp@1` to `pg/timestamptz`. Any codec id still unknown: stop (step 9), unless the user names its data type with the repeatable option `--data-type <codecId>=<dataTypeId>`, which is refused only for a codec the table already maps on the target of one of the project's contracts; the stop message names the option, and the extension instruction tells extension authors to publish that line for each codec they own.
4. Replace `nativeType` with `dataType`; remove `extensions.*.types.storage`; apply the SQLite default rewrite: a default of a `sqlite/json@1` column becomes `JSON.stringify` of the stored document with no added whitespace, including `null`, which becomes the text `"null"`; a default of an integer codec on SQLite that is a JSON number becomes its decimal digits. The members of an enum typed by a SQLite integer codec, in the domain enum and in the storage value set its columns name, become digit text the same way, and those of an enum typed by `sqlite/json@1` become the JSON text of their documents.
5. Recompute each contract's storage hash with today's rules. Profile and execution hashes are left as stored; neither covers columns.
6. Build the map from old to new storage hash. Rename each snapshot directory; if the target name already exists with different content, stop. In each `migration.json` replace `from` and `to` through the map and recompute `migrationHash`. Replace the hash in each ref file.
7. In each `migration.ts` under `migrations/`, replace every storage hash that is a key of the map, wherever it is written: in a `snapshots/<hash>/` import specifier and as a literal (for example the `from` and `to` of `describe()`). A hash that is not in the map is left as it is. Other text is unchanged.
8. Rewrite each `contract.d.ts` beside a rewritten contract: each `readonly nativeType: '…'` line becomes the `dataType` line for that column's codec, rewritten default and enum values follow the contract, and hash literals go through the map; an emitted contract's own old hash maps to its own new hash, so its `contract.json` and `contract.d.ts` agree.
9. Write each file in its own form: an emitted `contract.json` with the emitter's top-level key order, sorted nested keys, two-space indent, and the file's own final newline kept as it was (the emitter writes none); a snapshot `contract.json` as `JSON.stringify` of the key-sorted object on one line with a trailing newline. On a stop, the script changes no file, prints one line per case (`<file>: unknown codec <id>`, `<path>: snapshot directory already exists with different content`), and exits 1. A file named `contract.json` or `migration.json`, a needed `ops.json` or a ref that is not valid JSON is a stop too (`<file>: not valid JSON`). When it finishes, it prints how many files it rewrote and snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`); on a project already in the new format it prints that nothing changed, and under a root holding no SQL contract it prints that it found none.
10. A run interrupted at any write leaves a project a second run finishes. Every new file is computed first. New snapshot directories are written first, then each `contract.d.ts`, `migration.json`, ref and `migration.ts`, then each emitted `contract.json`, and old snapshot directories are removed last, so the files a second run rebuilds the map from change last. Each file and directory is written under a temporary name ending in `.data-type-in-contract-tmp` and renamed into place; an old directory is renamed to such a name before it is removed. A second run removes leftover temporary files and recognises an old and a new snapshot directory with the same content. An I/O failure prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1.

### 10.2 The instruction text

App audience: delete `nativeType` from hand-written column descriptors in `contract.ts`; upgrade every extension that ships migrations in the same step; run the script; run `db sign` against every database before deploying the application built with the new contract, because until then `migrate` is refused and `db verify` reports `CONTRACT.MARKER_MISMATCH` (the running application does not report it: the `postgres()` client has no logger for the marker check); `migration status` no longer labels migrations applied before the upgrade as applied; a space that fails verification (for example a drifted Supabase schema) must be repaired before it can be signed. Extension audience: run the script on the extension's contract space, release the extension against the framework version that contains this change and raise its peer dependency floor to that version, because the old framework refuses a rewritten contract space and the new framework refuses an old one; users upgrade the framework and their extensions in the same step. Both: query text changes from `$1::integer` to `$1::int4`, which affects logged SQL and SQL snapshots in tests.

### 10.3 In the repository

Regeneration order is inventory `upgrade-rewrite.md` section 7. The proof required by the upgrade skill: the script run on `examples/`, `apps/` and `packages/3-extensions/` at the base commit produces the same files as regeneration. Before slice 2 merges, check whether `prisma/getting-started-eval` stores contracts or migrations, and if so run the script there.

### 10.4 ADR and docs for slice 2

ADR 254: status Accepted; "Data types" rewritten to the declaration of section 2 and the rule "a column's data type is what the database stores; in SQL it is a `SqlDataType`, and `sql/expression` is the one data type no column has", replacing the paragraph that begins "Where a database's storage classes are shared"; "How PSL writes a value": the SQLite classifier paragraph rewritten to 9.4; "Columns and type constructors" states the stored column; "Assembly" gains the checks of section 5. `CONTRACT-FIDELITY.md` and the package READMEs named in inventory `change-list.md` part (c) are updated. `docs/reference/error-reference.md` loses `CONTRACT.NATIVE_TYPE_INVALID`.

# Slice 3: tools recognise a column's type from declarations (TML-3387)

Outcome: introspection resolves every reported type through the stack's declarations; `db verify` compares data type ids exactly; `contract infer` prints constructors, including extension types, and fails on unclaimed types. Depends on slice 2 and TML-3253.

## 11. Reading a database type

### 11.1 What introspection hands over

```ts
interface ReportedSqlType {
  readonly text: string;               // the catalog text of the element type
  readonly kind: string | undefined;   // the target's word for the type's kind
  readonly schema: string | undefined;
  readonly name: string | undefined;   // unquoted
}
```

`ReportedSqlType` describes the element only; introspection sets `many` on the `SqlColumnIR` itself. Postgres introspection (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`) reads, per column, from `pg_attribute` joined to `pg_type` and `pg_namespace`: whether the type is an array (`typelem <> 0` and `typcategory = 'A'`), and for the element type (or the type itself) `format_type(oid, atttypmod)`, `typtype`, `nspname`, `typname`. `kind` is `'enum'` for `typtype = 'e'`, `'domain'` for `'d'`, `'composite'` for `'c'`, `'range'` for `'r'`, `'multirange'` for `'m'`, and `undefined` for `'b'`. When `kind` is undefined and `nspname` is not `pg_catalog`, introspection removes a leading `<nspname>.` from the text (quoted as `format_type` quoted it), so an extension type installed in another schema, as Supabase does, is still claimed. SQLite hands over `text` from `PRAGMA table_info` and nothing else.

### 11.2 The resolver

`resolveReportedSqlType(reported, dataTypes)` returns `{ dataType: DataTypeId, typeParams }` or `undefined`.

1. If `reported.kind` is defined: the data type whose `claimsKind` equals it claims the type and `typeParams` is `fromReported(reported)`. No such data type: `undefined`. Texts are not consulted.
2. Otherwise prepare the text: trim; lower-case every character outside double quotes; collapse runs of whitespace to one space; remove spaces after `(` and `,` and before `)`.
3. Match the prepared text against every claiming text of every SQL data type in the stack. A match yields the placeholders' integers. Assembly guarantees at most one match.
4. No match: `undefined`. Otherwise validate the parameters against the type's `params`; a failure is `undefined`. Return the id and `normalize(params)`.

The function contains no type name, no target name and no branch on the data type's owner.

### 11.3 Enums

`pg/enum` declares `claimsKind: 'enum'`. `fromReported` returns `{ typeName }`: `name` when `schema` is `public` or undefined, otherwise `schema + '.' + name`. `render({ typeName })` splits on the first dot and double-quotes each part, as `quoteQualifiedName` does today. A column in the unbound namespace whose enum type lives outside `public` does not compare equal; this is a documented limit.

## 12. Comparing

### 12.1 Schema IR

`SqlColumnIR` (`packages/2-sql/1-core/schema-ir`) keeps `main`'s field `dataType`, which holds the `DataType` object. Today only the contract side sets it, from `sqlDataTypeOfCodec`, and equality ignores it. Slice 3 sets it on both sides: the contract side as today, the introspected side from `resolveReportedSqlType` and the stack's `DataTypeLookup`, undefined when no data type claims the reported type. `typeParams` holds normalised `dataTypeParams`. Both fields become part of equality (12.2). `nativeType` is renamed `typeText`: the reported text on the database side, the written name on the contract side, used for display and DDL only. `resolvedNativeType` and `codecBaseNativeType` are deleted; `codecRef` stays. The DDL builders' paths that take a schema IR column (`renderColumnDdl` in both targets' `column-ddl-rendering.ts`) render the type from `column.dataType` and `codecRef.typeParams`, without `SqlTypeLookups` or `codecBaseNativeType`. The path that takes a contract column (`planner-recipes.ts`) keeps the lookups.

### 12.2 Equality

Two columns have the same type when both `dataType` values are defined and their ids are equal, their `typeParams` are equal as canonical JSON, and their `many` flags are equal. Every string comparison of type names becomes this function: `sql-column-ir.ts:182-195`, the Postgres and SQLite issue planners, `sqlite/.../operations/tables.ts:225-226`, `planner-strategies.ts:85`. A column with `dataType` undefined never equals another. The reported text is shown in the mismatch message.

### 12.3 `ALTER COLUMN TYPE` postcheck

For a data type with `claimsKind`, the postcheck compares the column's type by identity: `a.atttypid = to_regtype('<render(params)>')`, or its array type through `typarray` for lists. For every other type it compares `format_type(...)` with `renderSqlCatalogText(type, params)` plus `[]` for lists. `FORMAT_TYPE_DISPLAY`, `buildExpectedFormatType`, `formatUserDefinedTypeName` and its reserved-word set are deleted.

### 12.4 Defaults

After TML-3253 the default parsers take a codec. The codec is the contract column's codec when verifying, and when inferring the codec of the constructor marked `inferred` for the resolved data type.

## 13. `contract infer`

1. `inferPslContract(schema: SqlSchemaIRNode, context: SqlPslBuildContext, describedContracts?: readonly SqlDescribedContractSpace[])`. `control-instance.ts:1012` builds `context` as `:1041-1043` does.
2. For each column, resolve its type (section 11). `undefined`, or a data type with no constructor marked `inferred`: infer fails with `CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED`, listing every such column as `<schema>.<table>.<column>: <reported text>`, and prints no schema. The code is added to `docs/reference/error-reference.md`.
3. Otherwise print the marked constructor. Its arguments come from the smallest parameter object `p` such that `normalize(p)` equals the resolved parameters, where "smallest" means dropping keys from the end of the constructor's argument list while the equality holds. This prints `Numeric(10)`, `Char`, `Bit` and `Numeric(10, 2)`. Lists print `[]`. Enums print `pg.enum(Name)` as today.
4. Marks on Postgres reproduce today's output: `pg/text` `String`; `pg/bool` `Boolean`; `pg/int4` `Int`; `pg/int8` `BigInt`; `pg/float8` `Float`; `pg/numeric` `Numeric`; `pg/json` `Json`; `pg/jsonb` `Jsonb`; `pg/bytea` `Bytes`; `pg/int2` `SmallInt`; `pg/float4` `Real`; `pg/char` `Char`; `pg/varchar` `VarChar`; `pg/uuid` `Uuid`; `pg/inet` `Inet`; `pg/date` `Date`; `pg/time` `Time`; `pg/timetz` `Timetz`; `pg/timestamp` `Timestamp`; `pg/timestamptz` `Timestamptz`; `pg/enum` `pg.enum`; `pgvector/vector` `pgvector.Vector`; `postgis/geometry` `postgis.Geometry`; and the new `pg/bit` `Bit`, `pg/varbit` `VarBit`, `pg/interval` `Interval`. `pg/tsquery` and `pg/text-array` have no constructor.
5. New constructors in the Postgres target: `Bit(length?)` codec `pg/bit@1`; `VarBit(length?)` codec `pg/varbit@1`; `Interval(precision?)` codec `pg/interval@1`. Each maps its argument onto the parameter of the same name and has documentation in the form its neighbours use.
6. `Unsupported(...)` is removed from Prisma 8: the production places and tests in inventory `type-constructors.md` sections 5.1, 5.2 and 5.4. The Prisma 6 and Prisma 7 schema readers keep it (5.3).
7. Deleted: `postgres-type-map.ts` tables `POSTGRES_TO_PSL`, `PRESERVED_NATIVE_TYPES`, `PARAMETERIZED_NATIVE_TYPES`; `infer-default-codec.ts` table `CODEC_ID_BY_INFERRED_TYPE`; `normalizeFormattedType`; `normalizeSchemaNativeType`; `normalizeSqliteNativeType`.

### Tests for slice 3

- A test-only extension in `test/integration` declares `testext/thing` with a parameter. One journey creates the type and a column by raw SQL, then introspects, verifies and infers it; a second run without the extension expects the mismatch and the infer failure.
- Against a real Postgres and a real SQLite: for every row of 2.6 and section 9 except `postgis/geometry`, `pg/tsquery` and `pg/text-array`, as a single column and as a list, create the column through a planned migration, then verify clean and infer the same PSL. `pg/tsquery` gets the infer-failure test. `postgis/geometry` is covered by resolver unit tests on its texts and by the manual QA run.
- Every kind, an enum in `public` and in another schema, a quoted enum name, and an enum list.
- Reviewers compare with what the database returns, per `drive/calibration`.

# Slice 4: written values outside defaults (TML-3389)

Depends on slice 1 and on `dataTypeValue` from TML-3367, which must never be a direct arm of `oneOf` and throws when its data type is not registered.

## 14. Arguments, enum members and discriminators

1. **Signatures.** `packages/2-sql/9-family/src/core/default-function-signatures.ts` exports `sqlDefaultFunctionSignatures({ integer: DataTypeId })`, returning the signatures of `autoincrement`, `now`, `ulid`, `uuid`, `cuid`, `nanoid`. Postgres passes `pg/int4`, SQLite `sqlite/integer`. The copies in both adapters are deleted; lowering functions stay where they are.
2. **Parameters.** `uuid(version?)`, `cuid(version)`, `nanoid(size?)` each take one `dataTypeValue` of the integer type, followed by the function's own check on the canonical value: `uuid` 4 or 7; `cuid` 2; `nanoid` 2 to 255. Messages: `uuid: version must be 4 or 7, got <n>`; `cuid: version must be 2, got <n>`; `nanoid: size must be between 2 and 255, got <n>`. Code `PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT`, at the argument. The limits are exported from `packages/1-framework/2-authoring/ids`, which the TypeScript helper and the field presets import.
3. **Reporting.** In `sql-attribute-specs.ts`, before the `@default` arms are tried: if the value is a call whose name is a registered function, only that function's arm runs and its diagnostics are returned. The existing interception of `dbgenerated` uses the same place. Arity messages say `Default function "nanoid"`, not `Attribute "nanoid"`. The optional-field check gets its own code `PSL_DEFAULT_GENERATOR_ON_OPTIONAL_FIELD`.
4. **Prisma 7 reader.** `lowerFunction` binds arguments through the same signatures; `FUNCTION_ARGUMENT_KEYS` is deleted; failures keep the code `PSL.PRISMA7_UNKNOWN_DEFAULT` with the function's message.
5. **Generators.** `applicableCodecIds` becomes `applicableDataTypes`, passed by each target: text generators `pg/text`, `pg/char`, `pg/varchar` on Postgres and `sqlite/text`, `sqlite/character`, `sqlite/character-varying` on SQLite; the UUID generators add `pg/uuid`. The check compares the column's data type.
6. **Enum member values.** The SQL enum entity factory stops calling `JSON.parse` and `decodeJson` on text. A member value is a written value read through the stack's authoring entries, cast into the enum codec's data type, then validated by the codec, with the diagnostics of a default and the general codes from TML-3367. The Mongo factory is unchanged in behaviour. Slice 2 already reads a member written as a number literal this way, from its source text, and reads a member written as a string literal with the codec's `decodeJson` (9.4); this slice puts both under the cast rule.
7. **Discriminator values.** `@@base(Model, value)` takes a `dataTypeValue` whose data type is the discriminator column's, resolved when the attribute is interpreted. The duplicate check stays.

### Tests for slice 4

Each message above in Prisma 8 PSL and through the Prisma 7 reader, on Postgres and SQLite; `nanoid(8.5)` reporting the missing cast; `String @default(uuid())` emitting on SQLite; enum member and discriminator values of the wrong type refused at the value; the nanoid limits defined in one file.
