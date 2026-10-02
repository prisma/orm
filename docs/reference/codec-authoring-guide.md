# Codec authoring guide

This guide describes the canonical authoring shape for codecs in Prisma 8: **class-based codecs and descriptors** (`CodecImpl`, `CodecDescriptorImpl`, and target-owned SQL descriptor subclasses), per-codec column helpers, and `satisfies` for compile-time wiring. The design rationale and the broader codec model live in [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md); this document is the practical "how to write a codec" reference for contributors.

## At a glance

A codec is **three artifacts**:

1. A **codec class** that extends `CodecImpl<Id, TTraits, TWire, TInput>` and implements all four conversion methods: `encode`, `decode`, `encodeJson`, and `decodeJson`.
2. A **descriptor class** that extends `CodecDescriptorImpl<P>` for a target-neutral codec, or the target-owned `PostgresCodecDescriptor<P>` / `SqliteCodecDescriptor<P>` for a target-bound SQL codec, and declares the data type it represents, the codec id, traits, params schema, and the curried factory that materializes codec instances.
3. A **per-codec column helper function** that calls `descriptor.factory(...)` directly and packages the result into a `ColumnSpec` via the framework-supplied `column(...)` packager. The helper carries a `satisfies ColumnHelperFor<D>` clause that ties it to its descriptor at compile time.

The framework imports live at `@internal/framework-components/codec`:

- `CodecImpl<Id, TTraits, TWire, TInput>` — abstract codec base class.
- `CodecDescriptorImpl<P>` — abstract descriptor base class; `CodecDescriptorTemplateImpl<P>` is the same shape for a codec whose data type the adapting target names.
- `dataType(id, spec)` — declares a data type with its casts; `DataType`, `DataTypeId`, `Cast`. A SQL data type is declared with `sqlDataType(id, spec)` from `@internal/sql-contract/data-type` instead, which adds how the type is written — see [Declaring a data type](#declaring-a-data-type).
- `ColumnHelperFor<D>` / `ColumnHelperForStrict<D>` — `satisfies` shapes for per-codec helpers.
- `column(codecFactory, codecId, typeParams)` — column-spec packager. The contract takes the column's data type from the codec.
- `Codec<...>`, `CodecDescriptor<P>`, `AnyCodecDescriptor` — consumer-facing interfaces (consumers depend on these; target-neutral authors extend the `*Impl` classes, while target-bound SQL authors use target-owned bases).

`decodeJson` follows one rule, stated on [`Codec.decodeJson`](../../packages/1-framework/1-core/framework-components/src/shared/codec.ts): it reads a value in a stored JSON form of the codec's type and throws on anything else, and callers use it as the check that a value is valid. The readers in `@internal/framework-components/codec` (`decodeJsonString`, `decodeJsonMatching`, `decodeJsonBoolean`, `decodeJsonInteger`, `decodeJsonIntegerText`, `decodeJsonFloat`) implement it for the common forms and refuse through `refuseJsonValue`, which raises `RUNTIME.DECODE_FAILED` with `meta.codecId` and `meta.received`. A codec built with type parameters checks them there too, as `pg/vector@1` checks its length, and a target adds its column's rule to a family codec it adapts, as PostgreSQL's `sql/varchar@1` checks the column's length.

SQL codecs use the same framework `CodecImpl` base. Their `encodeJson` and `decodeJson` methods define the codec's JSON-safe contract representation; `decode` remains responsible for the driver's ordinary column wire value. Keep that representation stable and mutually consistent, and keep `decodeJson` compatible with the values the current SQL JSON renderer returns for the codec. This distinction matters for types such as PostgreSQL `bytea` and extension-defined types whose values inside database-produced JSON may differ from their normal driver representation.

PostgreSQL and SQLite target descriptors also declare AST-to-AST JSON projection hooks, described below. The production JSON renderers call `projectJson()` for every column-valued entry they build, so a descriptor's projection is what a database actually returns — see [The canonical JSON guarantee](#the-canonical-json-guarantee).

## The canonical JSON guarantee

**A value read back through database-produced JSON is the value that was stored.** Where a query returns JSON — an `.include()`'s nested rows, an aggregated child row set — each column reaches that JSON through its own codec's projection, and `decodeJson` returns the application value the column holds. A `numeric` arrives as its exact decimal text rather than rounded through a double; a `bytea` as base64 rather than a hex escape; a `bigint` as decimal text rather than a JSON number that cannot hold it. Absence is preserved: a `NULL` column reads back as `null`, never as a zero or an empty value.

The guarantee reaches values the query **computes** as well as values it stores. An aggregate has no column codec to be canonical against, so its target declares one — see the [aggregate descriptor guide](./aggregate-descriptor-guide.md) — and the declared codec is what the value enters JSON under and is read back through. A count inside an `.include()` arrives under `pg/int8number@1`, whose canonical JSON is the digit text `pg/int8` stores and whose post-parse guard refuses a value the safe-integer range cannot hold; a `countBigInt` in the same position arrives under `pg/int8@1` as decimal text. An aggregate no target declares an overload for does not weaken this: the call is a type error on the typed surfaces, and a dynamic invocation is rejected with `ORM.AGGREGATE_UNSUPPORTED` before any SQL is built — no undeclared value ever reaches JSON.

The guarantee rests on the codec, not on the database's own JSON conversion, which is why it can be stated at all. It has exactly two limits, and both are real:

- **`pg/geometry@1` is exempt.** The PostGIS geometry codec has no canonical JSON projection, so a geometry column inside database-produced JSON carries whatever PostGIS's own JSON conversion emits, and round-tripping it is not guaranteed. Tracked as [TML-3105](https://linear.app/prisma-company/issue/TML-3105).
- **Float codecs need `extra_float_digits >= 1`.** `pg/float4@1`, `pg/float8@1`, `pg/float@1` and `sql/float@1` render through PostgreSQL's float-to-text conversion, which `extra_float_digits` controls. At `1` (the default since PostgreSQL 12) it prints the shortest decimal that round-trips exactly, and the guarantee holds. A session that lowers it to `0` or below prints fewer digits than the value needs, and a float read back through JSON may differ from the one stored. Nothing in the framework enforces the setting; if your deployment changes it, floats are outside the guarantee.

Non-finite floats read back as the numbers they are. JSON has no number for `NaN` or an infinity, and PostgreSQL writes them in JSON as the text `"NaN"`, `"Infinity"` and `"-Infinity"`, so every float codec's `encodeJson` writes that text and its `decodeJson` reads it back as the number. SQLite writes an infinity in JSON as `9.0e+999`, so the SQLite float codecs' JSON projection writes the same text instead, and `decodeJson` refuses a number that is not finite. SQLite cannot store `NaN`, which it turns into `NULL`, so on SQLite `sqlite/real@1` and `sql/float@1` refuse `NaN` in `encode` and in both JSON directions, and the SQLite driver refuses a NaN parameter no codec encoded. `pg/numeric@1` reads all three, because its application value is already text.

The consumer-facing [`BigInt`, `BigIntNumber`, and `UnboundedInt` representation choices](./integer-representation-types.md), including `BigIntNumber`'s deliberate JSON-number exception, are documented separately from this contributor guide.

The PostgreSQL temporal codecs pair a `Temporal`-valued codec with a raw-text one for each native type — `pg/timestamptz-temporal@1` reads a `Temporal.Instant`, `pg/timestamptz-string@1` reads PostgreSQL's own text, and the contract names which one a column uses.

## Three case studies

The same three artifacts express the full spectrum: non-parameterized, parameterized with literal preservation, and parameterized with a typed schema.

Case 1 carries the full framework import block; Cases 2 and 3 continue from it and list only the imports each one adds. All three elide the pack's own internals — `Vector` / `parseVector` in Case 2, `ArktypeSchemaLike` / `rehydrateSchema` / `validateSchema` in Case 3 — so read them as descriptor shape rather than as complete files.

### Case 1 — Non-parameterized codec (`pg/text@1`)

```ts
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  type CodecInstanceContext,
  CodecImpl,
  type ColumnHelperFor,
  column,
  decodeJsonString,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';

class PgTextCodec extends CodecImpl<
  'pg/text@1',
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext) { return value; }
  async decode(wire: string, _ctx: CodecCallContext) { return wire; }
  encodeJson(value: string) { return value; }
  decodeJson(json: JsonValue) {
    return decodeJsonString('pg/text@1', json);
  }
}

class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgText.id;
  override readonly codecId = 'pg/text@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    const shared = new PgTextCodec(this);
    return () => shared;
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const text = () =>
  column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined, 'text');
text satisfies ColumnHelperFor<PgTextDescriptor>;
```

The factory is **constant**: every call returns the same shared codec instance. The runtime relies on this contract — non-parameterized columns sharing a codec id share one resolved codec without explicit caching.

### Case 2 — Parameterized codec with literal preservation (`pg/vector@1`)

```ts
import { pgvectorVector, pgvectorVectorParams } from './data-types';

class VectorCodec<N extends number> extends CodecImpl<
  'pg/vector@1',
  readonly ['equality'],
  string,
  Vector<N>
> {
  constructor(descriptor: PgVectorDescriptor, readonly dimension: N) {
    super(descriptor);
  }
  async encode(value: Vector<N>, _ctx: CodecCallContext) {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return parseVector(wire) as Vector<N>;
  }
}

class PgVectorDescriptor extends PostgresCodecDescriptor<{ readonly length: number }> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgvectorVector.id;
  override readonly codecId = 'pg/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = pgvectorVectorParams;
  override renderOutputType({ length }: { length: number }) { return `Vector<${length}>`; }
  override factory<N extends number>(
    params: { readonly length: N },
  ): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return (ctx) => new VectorCodec<N>(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

export const vector = <N extends number>(length: N) =>
  column(
    pgVectorDescriptor.factory({ length }),
    pgVectorDescriptor.codecId,
    { length },
    'vector',
  );
vector satisfies ColumnHelperFor<PgVectorDescriptor>;
```

The params schema is the `pgvector/vector` data type's own `params`, referenced rather than restated, so the bound on `length` is written once — see [Declaring a data type](#declaring-a-data-type). The class-level params type is `{ readonly length: number }` (widest bound). The **method-level generic** `<N extends number>` on `factory` is what preserves the literal at the call site: when `vector(1536)` calls `pgVectorDescriptor.factory({ length: 1536 })` *directly*, TypeScript binds `N=1536`. The literal flows through `column(...)`'s generics into the column spec, into the contract type, and into `contract.d.ts`.

This is the **load-bearing variance pattern**: method generics on the descriptor's factory are preserved by direct invocation inside the per-codec helper, not by structural extraction at a polymorphic helper. A polymorphic `column<P, R>(descriptor, params)` helper that tried to extract `R` from the descriptor's `factory` would lose the literal — TypeScript instantiates method generics to their constraint at every form of structural extraction (structural match, indexed access, `Parameters` / `ReturnType`, etc.).

### Case 3 — Parameterized codec with typed schema (`arktype/json@1`)

The schema's TypeScript-level inferred type `S['infer']` is only available at the column-author site (where the user passes their typed schema), not at the descriptor's factory site (where only the serialized IR is available). This drives a slightly richer shape than Case 2:

```ts
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { arktypeJson } from './data-types';

class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  'arktype/json@1',
  readonly ['equality'],
  string,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) { super(descriptor); }
  async encode(value: TInferred, _ctx: CodecCallContext) {
    return serializeToJsonSafe(this.schema, value).wire;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return validateSchema<TInferred>(this.schema, JSON.parse(wire));
  }
}

class ArktypeJsonDescriptor extends PostgresCodecDescriptor<ArktypeJsonTypeParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgJsonb.id;
  override readonly codecId = 'arktype/json@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = type({
    expression: 'string',
    jsonIr: 'object',
  }) satisfies StandardSchemaV1<ArktypeJsonTypeParams>;
  override renderOutputType(params: ArktypeJsonTypeParams) { return params.expression; }
  override factory(
    params: ArktypeJsonTypeParams,
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown> {
    const schema = rehydrateSchema(params.jsonIr);
    return () => new ArktypeJsonCodecClass<unknown>(this, schema);
  }
}

export const arktypeJsonDescriptor = new ArktypeJsonDescriptor();

export function arktypeJsonColumn<S extends Type<unknown>>(
  schema: S,
): ColumnSpec<ArktypeJsonCodecClass<S['infer']>, ArktypeJsonTypeParams> {
  // Eager serialization captures `expression` (emit-path) and `jsonIr` (runtime rehydration) at the column-author site.
  const params: ArktypeJsonTypeParams = { expression: schema.expression, jsonIr: schema.json };
  return column(
    (_ctx) => new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptor, schema),
    arktypeJsonDescriptor.codecId,
    params,
    'jsonb',
  );
}
arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
```

Three things to note:

1. `pg/jsonb` declares no parameters, so the params schema holds only the codec's own keys. A codec whose data type has parameters and which adds keys of its own writes `dataType.params.and(ownKeys)`.
2. The descriptor's factory return is `ArktypeJsonCodecClass<unknown>` (the descriptor only sees IR — `S` is erased). The runtime path through `descriptor.factory(params)` always exists (e.g. for `validateContract` re-materialization); it just loses the typed inferred shape.
3. The column helper bypasses `descriptor.factory(...)` and constructs the typed codec directly so `S['infer']` flows through the column spec into the contract type. It satisfies `ColumnHelperFor<D>` (coarse) but not `ColumnHelperForStrict<D>` — the descriptor's factory return is `ArktypeJsonCodecClass<unknown>` while the helper produces `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is invariant. Negative type tests cover the literal-preservation property the strict variant would otherwise enforce.

JSON-Schema validation lives **inside `decode`**: the rehydrated schema is closure-captured by the codec instance, and `decode` calls into it synchronously. There is no parallel validator registry — the framework deleted `JsonSchemaValidatorRegistry` when unified descriptors and inline decode validation replaced the parallel registry.

## Target-owned SQL codec descriptors

A SQL extension binds each codec descriptor to the target that owns its native storage and JSON projection rules. Import the target protocol from the target package's lean `./codec-descriptor` export; this is a runtime dependency whenever production extension source imports it. Target-neutral framework and SQL-family descriptors extend `CodecDescriptorTemplateImpl<P>`, which names no data type, and must be explicitly adapted — the adapter supplies the data type — before a PostgreSQL or SQLite adapter takes them.

### PostgreSQL

Subclass `PostgresCodecDescriptor<P>` when the codec itself is PostgreSQL-bound. Keep all ordinary descriptor members from the generic authoring model, and add the protected JSON projection hook:

```ts
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';

class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: VectorParams,
  ): ProjectionExpr {
    return expression;
  }

  // dataType, codecId, traits, paramsSchema, factory and renderOutputType
  // stay on the ordinary descriptor.
}

export const pgVectorDescriptor = new PgVectorDescriptor();
export const codecDescriptors = definePostgresCodecs([pgVectorDescriptor]);
```

The descriptor does not say how its column type is written: the data type it represents does, for DDL, schema verification and PostgreSQL's parameter casts alike. `jsonProjection(expression, params)` declares the scalar AST transformation. Identity is an explicit, behavior-preserving declaration during the 0.17 transition, not an implicit default.

The public `projectJson(expression, ref)` method validates parameters and dispatches scalar versus stored-array projection. For `ref.many === true`, the default `jsonArrayProjection` binds the input expression once, unnests with ordinality, applies the scalar hook to each non-null element, and preserves a null array, an empty array, null elements, and element order. Override `jsonArrayProjection` only when the target codec has an equivalent optimized transformation.

Adapt a reusable generic descriptor with `postgresCodec(...)` instead of subclassing it solely to add target behavior:

```ts
import { sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgInt4 } from '@internal/target-postgres/data-types';

const postgresSqlIntDescriptor = postgresCodec(sqlIntDescriptor, {
  dataType: pgInt4,
  jsonProjection: (expression) => expression,
});
```

The adapter delegates the wrapped descriptor's codec id, literals, factory and renderers. Its parameter schema is the data type's `params`, not the wrapped descriptor's, so a parameter's bound is declared once, on the data type. It adds the PostgreSQL discriminant and target methods without changing codec materialization.

### SQLite

Subclass `SqliteCodecDescriptor<P>` for a SQLite-bound codec and implement the scalar projection hook. SQLite has no stored scalar-array descriptor protocol; `projectJson()` rejects `CodecRef.many` rather than guessing a storage representation.

```ts
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  defineSqliteCodecs,
  SqliteCodecDescriptor,
} from '@internal/target-sqlite/codec-descriptor';

class SqliteTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: void,
  ): ProjectionExpr {
    return expression;
  }

  // Keep the ordinary descriptor members unchanged.
}

export const sqliteTextDescriptor = new SqliteTextDescriptor();
export const codecDescriptors = defineSqliteCodecs([sqliteTextDescriptor]);
```

Generic SQL descriptors are adapted explicitly with `sqliteCodec(...)`:

```ts
import { sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { sqliteCodec } from '@internal/target-sqlite/codec-descriptor';
import { sqliteInteger } from '@internal/target-sqlite/data-types';

const sqliteSqlIntDescriptor = sqliteCodec(sqlIntDescriptor, {
  dataType: sqliteInteger,
  jsonProjection: (expression) => expression,
});
```

As with `postgresCodec(...)`, the adapted codec's parameter schema is the data type's `params`.

### Target-typed tuples and structural validation

`definePostgresCodecs(...)` and `defineSqliteCodecs(...)` are identity-style tuple helpers. They preserve each concrete descriptor's literal and factory types while rejecting a raw generic or wrong-target descriptor at authoring time. Prefer them to broad annotations such as `readonly AnyCodecDescriptor[]`; use `readonly AnyPostgresCodecDescriptor[]` or `readonly AnySqliteCodecDescriptor[]` only where an erased target-typed collection is necessary.

Adapter composition validates erased contributions structurally through `buildPostgresCodecDescriptorRegistry(...)` or `buildSqliteCodecDescriptorRegistry(...)`. Validation checks the stable `descriptorKind`, the ordinary descriptor contract, and the target's public methods, then rejects malformed, raw generic, wrong-target, or duplicate-id contributions before lowering a query. It deliberately does not rely on `instanceof`, so an extension remains valid when its package manager loads a separate copy of the target package. This is an open-world boundary: each target owns its descriptor subtype, validator, and registry rather than participating in a framework-global target map.

### Stack contribution and direct adapter injection

Contribute one canonical target-typed descriptor set through the existing target-neutral stack metadata, beside the data types those descriptors represent. Runtime and control descriptors for the same extension must expose the same sets; when the runtime SPI also requires `codecs()`, return that canonical descriptor set there as well.

```ts
const codecDescriptors = definePostgresCodecs([
  pgVectorDescriptor,
  postgisGeometryDescriptor,
]);

const codecTypes = { codecDescriptors };
const dataTypes = [...pgvectorDataTypes, ...postgisDataTypes];

export const runtimeExtension = {
  dataTypes,
  types: { codecTypes },
  codecs: () => codecDescriptors,
  // remaining runtime extension members
};

export const controlExtension = {
  dataTypes,
  types: { codecTypes },
  // remaining control extension members
};
```

Runtime and control stacks may assemble through different framework paths, but each target adapter validates the resulting ordered descriptor set once and builds one coherent registry for ordinary codec materialization and target behavior. Bare adapters remain built-ins-only. For focused construction outside a stack, pass target-typed descriptors through the adapter's single coherent option; custom descriptors append to built-ins. The PostgreSQL adapter also takes the data types those descriptors represent beyond the target's own, because it writes each parameter's cast from the codec's data type:

```ts
import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { createSqliteAdapter } from '@internal/adapter-sqlite/adapter';

const postgresAdapter = createPostgresAdapter({
  codecDescriptors: postgresExtensionCodecs,
  dataTypes: postgresExtensionDataTypes,
});

const sqliteAdapter = createSqliteAdapter({
  codecDescriptors: sqliteExtensionCodecs,
});
```

Do not inject an independent generic codec lookup and target registry: both views are derived from the same validated target descriptors so they cannot drift. Stack composition order remains target contributions, the full adapter descriptor set, then ordered extension contributions.

### One source of target truth

The descriptor is the only place a target's behaviour for a codec is declared, and the data type is the only place the database type's names are. `projectJson()` gives the expression that produces the column's canonical JSON; the column's declared type and PostgreSQL's parameter casts come from the data type the descriptor names. There is no parallel metadata channel to keep in step with them.

An identity `jsonProjection` is a claim, not a placeholder: it says this codec's stored form *is* its canonical JSON, as it is for `pg/text@1` and `pg/int4@1`. Write one only when that holds. A codec whose stored form cannot survive JSON — a wide integer, a byte string, a value whose text depends on a session setting — needs a projection that converts it, because the renderer will ask and then use the answer.

## Target-owned Mongo codecs

The Mongo target package owns every built-in Mongo codec, as the Postgres target owns its codecs. The adapter depends on the target and never the reverse.

| Module | Holds |
| --- | --- |
| `@internal/target-mongo/codec-ids` | the codec id constants (`MONGO_INT64_CODEC_ID`, …) |
| `@internal/target-mongo/codecs` | the codecs built with `mongoCodec(...)`, their descriptors (`mongoCodecDescriptors`, `mongoDescriptorById`), `mongoStandardCodecs` and `buildStandardCodecRegistry` |
| `@internal/target-mongo/data-types` | the data type each codec represents |
| `@internal/target-mongo/codec-types` | the `CodecTypes` map emitted `contract.d.ts` files import |

The source lives in `packages/3-mongo-target/1-mongo-target/src/core/{codec-ids,codecs,bson-scalar-helpers,data-types}.ts` and `src/exports/codec-types.ts`. The adapter's runtime descriptor registers `buildStandardCodecRegistry()`, and its control descriptor names each PSL scalar (`mongoScalarAuthoringTypes` in `packages/3-mongo-target/2-mongo-adapter/src/exports/control.ts`). The TypeScript builder in `@internal/mongo-contract-ts` keeps its own copy of the `CodecTypes` map; keep the two in step. `BsonScalar`, `BsonValue` and `BsonInputValue` are declared once in `@internal/mongo-value`, which both maps import, and `@internal/target-mongo/codec-types` re-exports them.

The PSL name, TS helper, BSON storage types and application type of every Mongo codec are listed in [Scalar types](scalar-types.md#mongodb). What that page does not list is each codec's JSON form, the value `encodeJson` writes into `contract.json`:

| Codec id | JSON form |
| --- | --- |
| `mongo/string@1`, `mongo/bool@1`, `mongo/vector@1`, `mongo/decimal128@1`, `mongo/json@1` | the application value itself |
| `mongo/objectId@1` | the application value, 24 hexadecimal digits |
| `mongo/int32@1` | the application value, an integer from -2147483648 to 2147483647 |
| `mongo/double@1` | the application value, with NaN and the infinities written as the text `"NaN"`, `"Infinity"` and `"-Infinity"`, as the SQL float codecs write them |
| `mongo/date@1` | ISO-8601 text in UTC, as `Date.toISOString()` writes it |
| `mongo/int64@1` | decimal text; a safe-integer `number` is accepted on the way in |
| `mongo/int64Number@1` | decimal text, as `mongo/int64@1` writes it |
| `mongo/binary@1` | unwrapped base64 |
| `mongo/bson@1` | canonical Extended JSON v2 (`EJSON.serialize(value, { relaxed: false })`), after writing each JavaScript number and `Uint8Array` as the BSON type the driver would store: an integer outside the int32 range as `double`, bytes as `binData` |

`decodeJson` reads only these forms: a value of another kind, or text in another format, throws `RUNTIME.DECODE_FAILED` naming the codec. `mongo/bson@1` refuses Extended JSON that is not canonical, such as a bare number or `{ "$numberInt": "abc" }`, which the `bson` reader would read as 0. The Mongo runtime reads documents through `decode` and never calls `decodeJson`; what `decodeJson` reads is the JSON a schema holds, such as a PSL enum member's value under `@@type`.

`Json` (`mongo/json@1`) means a JSON value, no more. Encode accepts exactly a plain JSON value (plain objects, arrays without holes, strings, finite numbers, booleans, `null`) and refuses anything else at any depth with `RUNTIME.ENCODE_FAILED`, naming its path. Decode accepts a stored value whose every part is a BSON `object`, `array`, `string`, `double`, `int`, `bool`, `null`, or a `long` in the safe-integer range (returned as a `number`), and refuses anything else (a `Date`, `ObjectId`, `Decimal128`, `Binary`, regex, timestamp, a larger `long`, a non-finite double) with `RUNTIME.DECODE_FAILED`, naming its BSON type and path. The validator admits the same BSON types at the field's top level.

`Bson` (`mongo/bson@1`) passes values through, so the driver's number handling shows: a stored `long` in the safe-integer range and an integral `double` read back as a JavaScript `number` (the driver's default `promoteLongs` and `promoteValues`), and a `number` that fits in 32 bits is written back as `int`. Wrap a value in `Long` or `Double` to keep its BSON type across a read and a write.

The PSL names `Int`, `Float`, `Boolean` and `DateTime` are deprecated aliases of `Int32`, `Double`, `Bool` and `Date`: they resolve to the same codecs, report `PSL_DEPRECATED_SCALAR_NAME` as a warning, and will be removed.

The JSON forms of `int64`, `decimal128` and `binary` match the Postgres `int8`, `numeric` and `bytea` codecs. `Decimal128.toString()` prints some values with an exponent (`1E+3`); the codec rewrites them without one (`1000`), keeping trailing zeros, so the text is stable across a round trip. The driver hands a stored `long` that fits in 53 bits back as a `number`, a larger one (or any one with `promoteLongs: false`) as a `Long`, and every one as a `bigint` with `useBigInt64`, so the `int64` and `int64Number` codecs accept all three on decode. `mongo/int64@1` and `mongo/int64Number@1` both name the `mongo/int64` data type, as `pg/int8@1` and `pg/int8number@1` both name `pg/int8`: the first reads a `bigint`, the second a `number` within ±(2^53 − 1), refusing a stored value outside that range or with a fraction rather than rounding it, and both write a BSON `long`. Decoding a wire value of the wrong BSON type throws `RUNTIME.DECODE_FAILED`.

`$jsonSchema` validators take each field's `bsonType` from the `bsonTypes` of the data type the field's codec represents, declared with `mongoDataType(id, { bsonTypes })` from `@internal/mongo-contract/data-type` and kept on the type as `mongo.bsonTypes`: one entry gives `bsonType: '<entry>'`, several give `bsonType: [...entries]` (`mongo/json@1` lists `object`, `array`, `string`, `double`, `int`, `long`, `bool`, `null`). A list field applies the same to `items`, and a nullable field prepends `'null'` unless the list already has it. A data type that lists no BSON type gets an empty schema (`{}`), which admits any value, or `{ bsonType: 'array', items: {} }` for a list field, which admits an array of any values; the field stays listed under `properties` because the validator is closed with `additionalProperties: false`.

## The data type a codec represents

Every codec descriptor names the data type it is one representation of. A data type is a stored type made first-class — `pg/int8`, `sqlite/text`, `pgvector/vector` — owned by the pack that registers it. It names the one JSON shape `contract.json` stores for its values, its canonical form, and it declares the casts that say which other types' values it takes. `dataType` is abstract on `CodecDescriptorImpl` and on the target-owned bases, so a descriptor that names no data type does not compile, and one that names a type no pack in the assembled stack registers is an assembly error.

```ts
export class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly dataType = pgText.id;
  override readonly codecId = PG_TEXT_CODEC_ID;
  // …
}
```

Several codecs may represent one type. `pg/int8@1` and `pg/int8number@1` both name `pg/int8`; they differ in the value they produce in memory, a `bigint` and a `number`, and both read and write the digit text that type stores. `encodeJson` produces the canonical form, and `decodeJson` takes a stored form of the type and nothing else, as [`Codec.decodeJson`](../../packages/1-framework/1-core/framework-components/src/shared/codec.ts) states. A codec has no method for PSL and never sees PSL text.

A data type that stores several codecs' values in one form declares no canonical form for them: `sqlite/text` holds strings, JSON documents and datetimes. A codec whose values have several written forms then declares the function on its descriptor, as `toCanonicalForm`: `sqlite/datetime@1` turns `2024-01-01 01:00:00+01:00` into `2024-01-01T00:00:00Z` and refuses text with no UTC offset, and `sqlite/json@1` turns the JSON text of a document into that text with sorted keys and no added whitespace. `canonicalFormOf(codec, dataTypes)` from `@internal/framework-components/codec` gives a column's canonical form: the codec's when it declares one, else its data type's. A contract source, `db verify` and the migration planner all take it from there, so an extension codec's form is used wherever a built-in one is.

An extension's codec does the same. `arktype/json@1` stores a `jsonb` column and validates the document against a schema on the way out, so it names `pg/jsonb` and the extension registers no data type at all. Register a new one only for a database type no pack describes yet, as pgvector does for `vector`. Reusing the target's type is what lets a written `` json`{}` `` reach an arktype column: the tag yields `pg/json`, `pg/jsonb` casts from it unchanged, and the codec validates the document.

### Declaring a data type

`dataType(id, spec)` from `@internal/framework-components/codec` declares a data type with its casts and, optionally, its parameters. The id is `owner/name` in lower case and carries no version; a versioned id such as `pg/int8@1` names a codec, and `dataType` refuses anything that is not the `owner/name` shape.

A SQL data type is declared with `sqlDataType(id, spec)` from `@internal/sql-contract/data-type`. It takes the same `params`, `casts` and `listCast`, and adds how the database writes and reports the type. Migrations, schema verification and PostgreSQL's parameter casts all read the type's name from this declaration, and from nowhere else. In a SQL stack every codec must represent a type declared with `sqlDataType`, because a codec is how a column stores its values; assembly refuses a codec that represents a type declared with plain `dataType` (item 9 under [Assembly is strict](#assembly-is-strict)). The SQL family's own `sql/expression` is such a plain type: it is the type of a written SQL expression, and no codec or column has it. A Mongo data type is declared with `mongoDataType(id, { bsonTypes })` instead; see [Target-owned Mongo codecs](#target-owned-mongo-codecs).

```ts
import { sqlDataType } from '@internal/sql-contract/data-type';

export const pgInt2 = sqlDataType('pg/int2', {
  texts: [
    { text: 'int2', written: true },
    { text: 'smallint', catalog: true },
  ],
});

export const pgInt4 = sqlDataType('pg/int4', {
  texts: [
    { text: 'int4', written: true },
    { text: 'integer', catalog: true },
    { text: 'int' },
  ],
  casts: { [pgInt2.id]: (value) => value },
});
```

Each entry of `texts` is one way the type is written or reported, in lower case with single spaces:

- `written: true` marks the text a migration writes.
- `catalog: true` marks the text the database catalog prints: `format_type` on PostgreSQL, `PRAGMA table_info` on SQLite.
- A text with neither mark is another name the database accepts for the type, such as `int`.
- A text marked only `written` is never used to recognise a type the database reports.
- `display` gives the exact characters to write and print when they differ from `text` in letter case only.

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

`sqlDataType` refuses a declaration that breaks these rules, with an `InternalError` naming the id. Among texts with the same placeholders, at most one is `written` and at most one is `catalog`.

#### Parameters

`params` is an arktype object schema of the type's parameters, and it is the only place a parameter's bound is written. A placeholder `{name}` in a text stands for the parameter `name` and matches a whole number. To write a column's type, the declaration picks the `written` text whose placeholders are exactly the parameters the column has, so one type can be written several ways:

```ts
export const pgNumericParams = arktype({
  'precision?': 'number.integer >= 1 & number.integer <= 1000',
  'scale?': 'number.integer >= -1000 & number.integer <= 1000',
}).narrow(
  (params, ctx) =>
    params.scale === undefined ||
    params.precision !== undefined ||
    ctx.reject({ path: ['scale'], message: 'scale requires a precision' }),
);

export const pgNumeric = sqlDataType('pg/numeric', {
  params: pgNumericParams,
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true, catalog: true },
    { text: 'decimal' },
    { text: 'decimal({precision})' },
    { text: 'decimal({precision},{scale})' },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});
```

A column with `{ precision: 10 }` is written `numeric(10)`, and one with `{ precision: 10, scale: 2 }` is written `numeric(10,2)`. Parameters that fail the schema, or that no `written` text takes, are refused with `CONTRACT.TYPE_PARAMS_INVALID`. A placeholder is written only with an integer value; any other value is refused with the same code, so a parameter can never write other SQL into a migration. `normalize` returns the normal form of a type's parameters, so that two ways of writing the same database type compare equal: PostgreSQL reports `numeric(10)` as `numeric(10,0)`. A type without `normalize` keeps its parameters as they are. Schema verification writes the contract's side with the normal form, so every normal form needs a `written` text with exactly its parameters, and `sqlDataType` refuses a declaration whose `normalize` gives parameters that no `written` text takes.

A codec's `paramsSchema` is its data type's `params`, referenced and never restated, so a bound has one home:

```ts
export class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  override readonly dataType = pgChar.id;
  override readonly paramsSchema = pgCharacterLengthParams satisfies StandardSchemaV1<LengthParams>;
  // …
}
```

A codec with parameters of its own sets `paramsSchema` to `dataType.params.and(ownKeys)`, or to its own keys alone when the data type declares no `params`, as `arktype/json@1` does. `postgresCodec(...)` and `sqliteCodec(...)` take the adapted codec's params schema from the data type they are given.

A type constructor maps its arguments onto the parameters and names only the codec; the data type follows from the codec. An argument that becomes a data type parameter carries no `minimum` or `maximum`, because the parameter's schema checks it. `inferred: true` marks the constructor `contract infer` prints for the data type, and at most one constructor per data type carries it.

```ts
export const pgvectorAuthoringTypes = {
  pgvector: {
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
  },
} as const satisfies AuthoringTypeNamespace;
```

#### Types recognised by kind

A PostgreSQL enum type has no fixed name, so `pg/enum` declares no texts. It claims the kind of type instead, and says how to write a name from its parameters and how to read the parameters of a type the database reports:

```ts
export const pgEnum = sqlDataType('pg/enum', {
  params: pgEnumParams,
  claimsKind: 'enum',
  render: ({ typeName }) => {
    const dot = typeName.indexOf('.');
    return dot === -1
      ? quoteIdentifier(typeName)
      : `${quoteIdentifier(typeName.slice(0, dot))}.${quoteIdentifier(typeName.slice(dot + 1))}`;
  },
  fromReported: (reported) => ({ typeName: qualifiedEnumName(reported) }),
});
```

`render` and `fromReported` are allowed only with `claimsKind`, and a type with `claimsKind` declares no `texts`. A migration writes what `render` returns without further checks, so `render` must quote every parameter value it writes, as `pg/enum` does with `quoteIdentifier`.

#### Casts

`casts` is keyed by the id of the type each cast takes values of. A cast is declared by the type that receives, never by the source, so there is at most one cast for any pair and the owner of a type is the only one who decides what it takes. Each cast is a pure function from the source type's canonical form to this type's, and it may throw a structured error for a value it cannot convert:

```ts
const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : wrongShape(value, 'a number');
```

There is no list data type. A written list on a list column is checked element by element against the column's own type. A type whose single value holds several elements takes a written list through `listCast` instead: `of` is the element types it takes, and `cast` receives their canonical forms in written order.

```ts
export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});
```

A pack contributes its types through `dataTypes` on its component metadata, beside the codec descriptors that represent them:

```ts
dataTypes: pgvectorDataTypes,
```

Register the same list on the control descriptor and the runtime descriptor. The runtime writes PostgreSQL parameter casts from it, and a codec whose data type the runtime stack does not register fails there.

### Giving a type PSL support

A type's values can be written in PSL only when the pack contributes an **authoring entry** for it, keyed by the type's id under `authoring.dataTypes`. The entry says how a value of the type is written, reads the text into the type's canonical form, and prints a stored value back; `contract infer` and the language server read the same entry.

A value is written either with a tag — a qualified name followed by a string in any of PSL's quote styles — or in one of the three plain forms the interpreter reads without a tag: a quoted string, `true`/`false`, and a number. `parse` turns the text into the canonical form and throws a structured error for text it cannot read.

```ts
[pgText.id]: {
  written: { kind: 'plain', syntax: 'string', parse: (text) => text },
  print: (value) => String(value),
  documentation: 'Text.',
},
[pgJson.id]: {
  written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
  print: printJsonBody,
  documentation: 'Reads the text as a JSON document and stores it as the default value.',
},
```

A tag whose value is a type that another syntax already reads sits under `tagEntryKey(tag)` and names that type in `type`. SQLite stores a JSON document as text, so its `json` tag yields `sqlite/text`, whose own entry reads a plain string:

```ts
[tagEntryKey('json')]: {
  written: { kind: 'tag', tag: 'json', type: sqliteText.id, parse: (text) => canonicalizeJson(parseJsonBody(text)) },
  print: (value) => String(value),
  documentation: 'Reads the body as a JSON document and stores its JSON text as the default value.',
},
```

A number is the one plain form that yields several types, so its arm carries a classifier in place of `parse`: `classify` picks the type from the digits and returns the canonical form with it, and `types` lists every data type the classifier can return. Assembly reads `types` to know those types can be written, so leaving one out turns a cast from it into an assembly error.

```ts
[pgNumeric.id]: {
  written: {
    kind: 'plain',
    syntax: 'number',
    types: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    classify: classifyPostgresNumber,
  },
  print: printNumber,
  documentation: 'A number, whose type comes from its own size and precision.',
},
```

Reading a written default is then: the entry parses or classifies the text into a value of a known type; if that type is not the column's, the column's type is looked up for a cast from it, and having none is `PSL_VALUE_TYPE_INCOMPATIBLE`; the value, cast or not, is handed to the codec instance built with the column's parameters, and a refusal there is `PSL_INVALID_DEFAULT_LITERAL` with the codec's own message; the value is then stored in the column's canonical form. Text the entry, a cast or the column's canonical form refuses is `PSL_INVALID_LITERAL`. A column whose data type has no authoring entry and no cast into it takes only a `` sql`...` `` default.

A data type need not be a column's type. `sql/expression` has an authoring entry that is a tag, declares no casts, and has no codec, so its values are admitted only where a position asks for that type. The SQL family defines and registers it. A family registers only a type whose definition must not differ between targets and that nothing casts from.

Checks that depend on a column's parameters belong in the codec instance, on the canonical form: `vector(3)` refuses four elements, `numeric(10,2)` refuses a third decimal place, and a limit of the stored representation is the codec's to refuse too — on SQLite, `sqlite/real@1` and `sql/float@1` refuse `NaN`, because SQLite cannot store it.

### Assembly is strict

The control stack assembles every pack's data types, codec descriptors and authoring entries into one stack and checks them against each other. Each failure names the contributing component and the id at fault:

1. **A codec names a type nobody registers.** `CONTRACT.DATA_TYPE_UNREGISTERED`.
2. **An authoring entry, a type in a number entry's `types`, or a type some cast takes values of, is not registered.** Also `CONTRACT.DATA_TYPE_UNREGISTERED`.
3. **Two entries claim one tag or one plain form.** `CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE`. Two packs registering one type id is `CONTRACT.DATA_TYPE_DUPLICATE`, and two entries under one key is `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE`.
4. **A type some cast takes values of cannot be written.** `CONTRACT.DATA_TYPE_NOT_WRITABLE`: a cast from a type no contract source can write is never exercised. A type counts as writable when it has an authoring entry of its own, when a tag entry's `type` names it, or when a number entry's `types` names it.
5. **An entry sits under the wrong key.** `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`: a tag entry that names its `type` sits under `tagEntryKey(tag)`, and only there.

Type constructors, field presets and SQL declarations are checked at assembly too. Each failure is an `InternalError` naming the contributor and the id:

6. **A type constructor or field preset names a codec no component registers.**
7. **A type constructor maps an argument onto a parameter** that neither the codec's data type's `params` nor the codec's own parameters declare.
8. **Two type constructors of one data type are both marked `inferred`.**
9. **Two SQL data types claim the same reported type**: a claiming text of one matches a claiming text of the other, or both claim the same kind.
10. **A codec in a SQL stack represents a data type that is not a SQL data type** (declared with plain `dataType` rather than `sqlDataType`). The error names the codec, its data type and the data type's contributor.

The SQL family runs items 9 and 10 when it creates its control instance, together with its check that no type casts from `sql/expression`, so the CLI reports them and the language server does not.

The reverse of the fourth is not required: a type may be reachable only through casts. These checks span packs, which is why they run at assembly — `pgvector/vector` taking `pg/numeric` values is valid only when the Postgres target that owns `pg/numeric` is in the stack. Within a pack, refer to a type by its constant rather than by string, so a misspelt id fails to compile.

### A codec whose data type depends on the target

A codec the SQL family exports for several targets cannot name a data type, because the type belongs to the target that adapts it. Its descriptor extends `CodecDescriptorTemplateImpl<P>`, which is `CodecDescriptorImpl<P>` without `dataType`:

```ts
export class SqlTextDescriptor extends CodecDescriptorTemplateImpl<void> {
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => new SqlTextCodec(this);
  }
}
```

The target names the type when it adapts the template, alongside the JSON projection:

```ts
import { sqlTextDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';

export const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
});
```

The adapted descriptor satisfies `CodecDescriptor`, so the codec reaches the stack with a data type even though the shared template declares none. Its parameter schema is that data type's `params`, not the template's.

See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).

## `satisfies` discipline

The framework exports two helper-shape constraints:

- `ColumnHelperFor<D>` — checks the helper returns a `ColumnSpec` whose typeParams shape matches `Parameters<D['factory']>[0]`. Catches wiring the wrong descriptor's factory in by typeParams shape; doesn't catch literal-preservation violations (those are covered by negative type tests).
- `ColumnHelperForStrict<D>` — also checks the helper's promised codec type matches `ReturnType<D['factory']>`. Use this when the codec's resolved type is well-defined (most cases). The strict form fails for helpers like `arktypeJsonColumn` whose typed return is more specific than the descriptor's factory return; in that case use the coarse form and rely on `expectTypeOf` tests for the literal-preservation property.

Both are exported from `@internal/framework-components/codec`.

## Reusing generic SQL descriptors in PostgreSQL

A reusable SQL-family descriptor remains target-neutral. Bind it to PostgreSQL with `postgresCodec(...)`; do not subclass the generic descriptor, because the PostgreSQL registry requires the target discriminant and target methods.

```ts
import { sqlCharDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgChar } from '@internal/target-postgres/data-types';

const postgresSqlCharDescriptor = postgresCodec(sqlCharDescriptor, {
  dataType: pgChar,
  jsonProjection: (expression) => expression,
});
```

The adapter preserves the generic codec id, traits, factory, output renderer, and metadata, takes its params schema from the data type, and adds PostgreSQL projection behavior. It also supplies the `dataType` the template itself cannot name — see [A codec whose data type depends on the target](#a-codec-whose-data-type-depends-on-the-target).

When PostgreSQL owns a distinct codec id, define a `PostgresCodecDescriptor` subclass and delegate only the reusable SQL behavior explicitly:

```ts
class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }

  override readonly dataType = pgChar.id;
  override readonly codecId = 'pg/char@1' as const;
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = pgCharacterLengthParams;

  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharDescriptor.renderOutputType(params);
  }

  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}
```

This keeps target ownership explicit: adaptation is for a reusable descriptor with its existing id; target-owned subclassing is for a PostgreSQL codec with PostgreSQL identity or behavior. In both cases the result satisfies the PostgreSQL descriptor protocol and can participate in `definePostgresCodecs(...)`.

See [packages/3-targets/3-targets/postgres/src/core/codecs.ts](../../packages/3-targets/3-targets/postgres/src/core/codecs.ts) (`postgresSqlCharDescriptor`, `PgCharDescriptor`) for both patterns.

## Aggregate result codecs

What an aggregate returns is a declaration of its target, not a property of the input codec. That contribution surface — `SqlAggregateDescriptor` on `types.aggregateDescriptors`, a sibling of `codecTypes` — has its own reference: the [aggregate descriptor guide](./aggregate-descriptor-guide.md).

## Heterogeneous storage at the runtime layer

The framework's descriptor registry is keyed by `codecId: string` and stores type-erased descriptor instances. The canonical erasure type is `AnyCodecDescriptor` (defined in `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`):

```ts
interface CodecDescriptorRegistry {
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  values(): IterableIterator<CodecDescriptor<unknown>>;
}
```

Registries are built from flat descriptor lists (see `buildCodecDescriptorRegistry` in `@internal/sql-relational-core`); there is no imperative `register` on the public surface.

`CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly), so `CodecDescriptor<unknown>` is **not** assignable from concrete `CodecDescriptor<SpecificParams>` subclasses — the `<unknown>` shape would force `as` casts at every register/retrieve boundary. `AnyCodecDescriptor` is the only erasure form that admits cast-free heterogeneous storage.

Per-codec helpers don't pass through the registry — they're imported directly by extension authors and column-defining sites. The registry exists for runtime lookup (by codec id string), where types are already erased.

## Why classes work for this design

The class hierarchy isn't load-bearing for variance preservation (per-codec helpers' direct calls do that work). It's load-bearing for **structure**:

1. **Codec instance ↔ descriptor reference is structural.** The abstract `CodecImpl` constructor takes a `descriptor: AnyCodecDescriptor`; concrete codec subclasses pass it via `super(descriptor)`. `codec.id` proxies through this reference, so a target-owned descriptor can reuse a generic codec class while preserving the target-owned codec id without object spreads or prototype loss.
2. **Subclass-based authoring is uniform within each ownership boundary.** Target-neutral descriptors extend `CodecDescriptorImpl<...>`; PostgreSQL- and SQLite-bound descriptors extend their target-owned bases. Generic descriptors cross into a target through explicit adapters such as `postgresCodec(...)`. The variance behavior remains the same: the per-codec helper handles literal preservation via direct calls, while the descriptor class or adapter declares the target shape.

## Reference implementations in the repo

- **Non-parameterized base codecs** (text, int, float, bool, etc.): `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`.
- **PostgreSQL target codecs and generic descriptor adapters**: `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
- **SQLite target codecs and generic descriptor adapters**: `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`.
- **Parameterized codec with literal preservation** (pgvector): `packages/3-extensions/pgvector/src/core/codecs.ts`.
- **Parameterized codec with typed schema** (arktype-json): `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`.

## Pitfalls

- **`override` discipline.** With `noImplicitOverride`, every concrete-subclass member that touches an inherited member must carry `override`. Forgetting it surfaces as a typecheck error.
- **Don't widen the factory return at the descriptor.** Concrete descriptors should declare their factory's typed return (`(ctx) => VectorCodec<N>`, not `(ctx) => Codec<...>`). The widened return loses literal preservation at consumer sites.
- **Don't extract codec types via `Parameters` / `ReturnType` of the descriptor's `factory`.** TypeScript widens method generics to their constraint in those forms. Use the per-codec helper's typed return (`ColumnSpec<R, P>`) and project with `R extends Codec<any, any, any, infer T> ? T : never`.
- **Don't reach through the codec instance for metadata.** The runtime `Codec` instance is narrow (id + four conversion methods). Read traits and meta from `descriptor` (e.g. `context.codecDescriptors.descriptorFor(codecId).traits`).

## See also

- [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — design rationale and how the codec composes across authoring, emit, and runtime dispatch.
- [ADR 204 — Single-Path Async Codec Runtime](../architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — `encode` / `decode` are uniformly Promise-returning at the public boundary.
- [ADR 207 — Codec call context](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the `CodecCallContext` (per-call signal + family-extended column metadata) threaded into every encode/decode invocation.
