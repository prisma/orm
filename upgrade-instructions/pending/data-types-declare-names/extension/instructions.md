---
changes:
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
  - id: resolve-identity-value-receives-data-type
    summary: |
      `CodecControlHooks.resolveIdentityValue` receives `dataType`, the id of the data type the
      column's codec represents, instead of `nativeType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bresolveIdentityValue\s*:\s*\(\s*\{[^}]*\bnativeType\b'
        - '\bResolveIdentityValueInput\b[^;]*\bnativeType\b'
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
---

After the edits below, delete imports and constants that are no longer used, and run the package's formatter so imports are sorted.

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

## `resolve-identity-value-receives-data-type`

```ts
// before
resolveIdentityValue: ({ nativeType }) => (nativeType === 'vector' ? "'[0]'" : null),

// after
resolveIdentityValue: ({ dataType }) => (dataType === 'pgvector/vector' ? "'[0]'" : null),
```

A list column now reaches the hook with its element's data type and `typeParams`.

## `contract-build-takes-lookups`

The column's stored `nativeType` is now written from the data type its codec represents, so the build needs both lookups. Through the facades, list every extension whose codec the contract uses:

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
        nativeType: PGVECTOR_NATIVE_TYPE,
        typeParams: {},
      },
    },
    models: {},
  }),
);
```

A column whose codec the lookup lacks fails with `CONTRACT.CODEC_DESCRIPTOR_MISSING`; one whose codec's data type the lookup lacks fails with `CONTRACT.DATA_TYPE_UNREGISTERED`. A direct call of `buildSqlContractFromDefinition(definition, codecLookup, dataTypeLookup)` passes both.

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

Import each helper listed in the summary from `@internal/sql-contract/data-type-support`. Remove it from the `@internal/sql-relational-core/ast` import, and delete that import if nothing is left in it. Add `@internal/sql-contract` to the package's dependencies if it is not there:

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
