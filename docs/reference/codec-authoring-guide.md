# Codec authoring guide

This guide describes the canonical authoring shape for codecs in Prisma 8: **class-based codecs and descriptors** (`CodecImpl`, `CodecDescriptorImpl`, and target-owned SQL descriptor subclasses), per-codec column helpers, and `satisfies` for compile-time wiring. The design rationale and the broader codec model live in [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md); this document is the practical "how to write a codec" reference for contributors.

## At a glance

A codec is **three artifacts**:

1. A **codec class** that extends `CodecImpl<Id, TTraits, TWire, TInput>` and implements its four methods: `toWire`, `fromWire`, `toDataTypeValue` and `fromDataTypeValue`. Its constructor passes the descriptor, the data type it converts values of and the column's parameters of that type to `CodecImpl`: `super(descriptor, dataType, params)`.
2. A **descriptor class** that extends `CodecDescriptorImpl<P>` for a target-neutral codec, or the target-owned `PostgresCodecDescriptor<P>` / `SqliteCodecDescriptor<P>` for a target-bound SQL codec, and declares the data type it represents, the codec id, traits, params schema, and the curried factory that materializes codec instances.
3. A **per-codec column helper function** that calls `descriptor.factory(...)` directly and packages the result into a `ColumnSpec` via the framework-supplied `column(...)` packager. The helper carries a `satisfies ColumnHelperFor<D>` clause that ties it to its descriptor at compile time.

The framework imports live at `@internal/framework-components/codec`:

- `CodecImpl<Id, TTraits, TWire, TInput>` — abstract codec base class.
- `CodecDescriptorImpl<P>` — abstract descriptor base class; `CodecDescriptorTemplateImpl<P>` is the same shape for a codec whose data type the adapting target names.
- `dataType(id, spec)` — declares a data type with the `read` function for its values and its casts; `DataType`, `DataTypeId`, `DataTypeReader`, `Cast`. A SQL data type is declared with `sqlDataType(id, spec)` from `@internal/sql-contract/data-type` instead, which adds how the type is written — see [Declaring a data type](#declaring-a-data-type).
- Helpers for declaring data types and their PSL entries (ADR 254): the casts `castUnchanged`, `asNumeralText` and `asFloat`, and `refuseWrongShape` for a cast's own refusals; `createNumberClassifier` and `signedRange` for the plain-number entry; `parseJsonText` and `printJsonText`; `numeralText` and `storedNumeralText`; `dateTimeStoredText` and `isoDateStringText`, which build the stored form of date and time types.
- `DataTypeValue` — a value of a data type, `{ type, params, value }`, whose `value` is the JSON `contract.json` stores.
- `ColumnHelperFor<D>` / `ColumnHelperForStrict<D>` — `satisfies` shapes for per-codec helpers.
- `column(codecFactory, codecId, typeParams)` — column-spec packager. The contract takes the column's data type from the codec.
- `Codec<...>`, `CodecDescriptor<P>`, `AnyCodecDescriptor` — consumer-facing interfaces (consumers depend on these; target-neutral authors extend the `*Impl` classes, while target-bound SQL authors use target-owned bases).

## The four methods

A codec converts between three forms of a value ([ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#codecs)):

| Method | From | To | Used when | Runs |
| --- | --- | --- | --- | --- |
| `fromDataTypeValue` | value of the data type | application value | building a contract, planning, verifying | synchronously |
| `toDataTypeValue` | application value | value of the data type | the same | synchronously |
| `fromWire` | wire value | application value | reading a row, a row the database returns as JSON, or a default the database reports | asynchronously |
| `toWire` | application value | wire value | writing a parameter, or a default into DDL | asynchronously |

The wire value is what the driver exchanges with the database. `fromWire` and `toWire` take the per-call context of [ADR 207](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) and are asynchronous, as [ADR 204](../architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) describes.

The value belongs to the data type, not to the codec. The data type reads every stored value with its `read` function, under the column's parameters, before a codec sees it, so `fromDataTypeValue` receives a value the type holds and only converts it. `toDataTypeValue` finishes with `this.dataTypeValueOf(json)`, which constructs the value through the type's `valueFrom(json, params)`. `valueFrom` reads the JSON with the type's `read` and writes it in the spelling the parameters give, so a codec, including one from outside the repository, cannot hand over a value its type does not hold or store a value differently from the other codecs of its type. `CodecImpl` also refuses, with an `InternalError`, a value of another data type handed to `fromDataTypeValue`.

A codec checks only what its application value or its target's storage cannot hold. `pg/int8number@1` refuses digit text past 2^53 in `fromDataTypeValue`, the `Temporal` and `Date` codecs refuse `infinity`, which only the text codecs hold, and on SQLite `sqlite/real@1` and `sql/float@1` refuse `NaN`, which SQLite cannot store. A limit of the type itself, such as a `numeric(10,2)` scale or a `vector(3)` length, is the data type's, in its `read`.

`fromWire` reads what the driver hands over for a row and refuses a value the column's type does not hold with `RUNTIME.DECODE_FAILED`: on SQLite, text in an `INTEGER` or `REAL` column outside a `STRICT` table, or text in a `BLOB` column. The readers in `@internal/framework-components/codec` (`readJsonString`, `readJsonMatching`, `readJsonBoolean`, `readJsonInteger`, `readJsonIntegerText`, `readJsonFloat`) read the common JSON forms, for a data type's `read` and for a codec's wire, and refuse through `refuseJsonValue`, which raises `RUNTIME.DECODE_FAILED` with `meta.dataType` or `meta.codecId` and `meta.received`.

PostgreSQL and SQLite target descriptors also declare AST-to-AST JSON projection hooks, described below. The production JSON renderers call `projectJson()` for every column-valued entry they build, and the runtime reads what each projection writes with `fromWire` — see [Rows the database returns as JSON](#rows-the-database-returns-as-json).

## Rows the database returns as JSON

**A value read through database-produced JSON is the value an ordinary row of the column gives.** Where a query returns JSON — an `.include()`'s nested rows, an aggregated child row set — each column reaches that JSON through its own codec's projection, and the runtime reads it with the codec's `fromWire`, the method that reads an ordinary row. A projection therefore writes into the JSON the value the driver returns for a row of the column ([ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#reading-and-writing-a-stored-value), "Rows the database returns as JSON"). On PostgreSQL that is the text PostgreSQL prints, `CAST(x AS text)`, for every type whose row arrives as text: a `numeric` or `int8` keeps every digit instead of becoming a JSON number, a `bytea` arrives as its hex text, a `json` or `jsonb` document arrives as its JSON text, so a document that is a string is not parsed twice, and a vector arrives as the text a row reads, not as elements widened to double precision. A type whose JSON value is what the driver hands `fromWire` for a row, such as a boolean or an `int4`, enters as the column itself. On SQLite an integer enters as decimal text, a blob as an array of its hex text, and a float as text where JSON has no number for it. Absence is preserved: a `NULL` column reads back as `null`.

The rule reaches values the query **computes** as well as values it stores. An aggregate has no column codec, so its target declares one — see the [aggregate descriptor guide](./aggregate-descriptor-guide.md) — and the declared codec's projection and `fromWire` read the value. A count inside an `.include()` arrives under `pg/int8number@1` as decimal text, and a `countBigInt` under `pg/int8@1`. An aggregate over no rows takes the value its descriptor declares in `emptyResultWire`, which is a wire value the declared codec reads with `fromWire`. An aggregate no target declares an overload for is a type error on the typed surfaces, and a dynamic invocation is rejected with `ORM.AGGREGATE_UNSUPPORTED` before any SQL is built.

One limit remains: **float codecs need `extra_float_digits >= 1`.** `pg/float4@1`, `pg/float8@1`, `pg/float@1` and `sql/float@1` read PostgreSQL's float-to-text conversion, which `extra_float_digits` controls. At `1` (the default since PostgreSQL 12) it prints the shortest decimal that reads back exactly. A session that lowers it prints fewer digits than the value needs, in a row and in JSON alike. Nothing in the framework enforces the setting.

A value in a contract, a literal default or an enum member, converts to the value a query returns for it: `fromDataTypeValue` of the stored value equals what `fromWire` gives for the same value in a row, and `db.enums` compares with that value ([ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)). The stored form need not be the text the database prints: `pg/bytea` stores base64 where PostgreSQL prints hex, and the timestamp types store ISO 8601. Where the database normalises how a value is written, the stored form is the database's spelling, which the data type writes and its `read` requires: `pg/uuid` stores lower case, the integer types and `pg/numeric` drop leading zeros and the minus sign on zero, a `numeric(10,2)` value has two fraction digits, and `pg/inet` drops `/32` or `/128` on a host address and writes IPv6 in lower case with PostgreSQL's zero compression.

An enum compares values with its members, so every enum authoring surface (`enumType` in `defineContract` and the PSL enum block, in both families) refuses a codec whose descriptor does not declare the `equality` trait. A codec that declares it, but whose values read back can never equal a member as the contract stores it, sets `enumRefusal` on its descriptor: one or two sentences saying why, ending with what to use instead. A codec without equality may set it too, to replace the generic reason. `enumRefusalOf` from `@internal/framework-components/codec` reads both rules, and every surface refuses through it. On Postgres, `pg/bytea@1` sets it, because its CHECK would compare a value with the bytes of the stored base64 text; `pg/tsquery@1`, because PostgreSQL normalises the query text; `pg/json@1`, because its type has no equality operator; `pg/jsonb@1` and `arktype/json@1`, because a CHECK cannot compare their stored members with `jsonb`; `pg/enum@1`, which types a native enum's column; `pg/vector@1`, whose members no CHECK can list; and `pg/geometry@1`, until a test proves a shape reads back as its member. Each names a text enum, or for `pg/enum@1` a native enum, as what to use instead.

The consumer-facing [`BigInt`, `BigIntNumber`, and `UnboundedInt` representation choices](./integer-representation-types.md), are documented separately from this contributor guide.

The PostgreSQL temporal codecs pair a `Temporal`-valued codec with a text one for each native type — `pg/timestamptz-temporal@1` reads a `Temporal.Instant`, `pg/timestamptz-string@1` reads ISO 8601 text, and the contract names which one a column uses. A type may have more codecs: `timestamptz` and `timestamp` also have a `Date` codec, `timestamp` a second `Temporal` codec, `pg/timestamp-instant@1`, that reads the stored date and time as a UTC `Temporal.Instant`, and `interval` a codec that reads an ISO 8601 duration string. A codec of one type differs from its siblings only in the application value, so a new one is a codec, never a new data type. A text codec's application value is its data type's stored form: its `fromWire` reads the text PostgreSQL prints under `DateStyle=ISO` into that form, converting a `timestamptz` offset to UTC and a ` BC` or long year to the signed ISO year, and refuses text printed under another `DateStyle` with `RUNTIME.DATE_STYLE_NOT_ISO`, as every Postgres codec that reads a date or timestamp does. Its `toDataTypeValue` takes only the stored form, and its `toWire` converts the stored ISO year into PostgreSQL's year text. A value beyond the stored form's range, such as `24:00:00` or a seven-digit year, reads in the same ISO shape.

## Three case studies

The same three artifacts express the full spectrum: non-parameterized, parameterized with literal preservation, and parameterized with a typed schema.

Case 1 carries the full framework import block; Cases 2 and 3 continue from it and list only the imports each one adds. All three leave out the pack's own helpers, which a real file declares beside them: `parseVector` and the `./data-types` module in Case 2; `ArktypeSchemaLike`, `rehydrateSchema`, `validateSchema`, `serializeWire`, `serializeJson` and `decodeWireValue` in Case 3.

### Case 1 — Non-parameterized codec (`pg/text@1`)

```ts
import {
  type CodecCallContext,
  type CodecInstanceContext,
  CodecImpl,
  type ColumnHelperFor,
  column,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';

export class PgTextCodec extends CodecImpl<
  'pg/text@1',
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext) { return value; }
  async fromWire(wire: string, _ctx: CodecCallContext) { return wire; }
  fromDataTypeValue(value: DataTypeValue<string>) { return value.value; }
  toDataTypeValue(input: string) { return this.dataTypeValueOf(input); }
}

export class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgText.id;
  override readonly codecId = 'pg/text@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    const shared = new PgTextCodec(this, pgText);
    return () => shared;
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const text = () => column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined);
text satisfies ColumnHelperFor<PgTextDescriptor>;
```

`pgText` declares that a value is a string, so `fromDataTypeValue` receives one and returns it. The factory is **constant**: every call returns the same shared codec instance. The runtime relies on this contract — non-parameterized columns sharing a codec id share one resolved codec without explicit caching.

### Case 2 — Parameterized codec with literal preservation (`pg/vector@1`)

```ts
import { CastExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { pgvectorVector, pgvectorVectorParams } from './data-types';

type VectorParams = { readonly length: number };

export class PgVectorCodec extends CodecImpl<'pg/vector@1', readonly ['equality'], string, number[]> {
  constructor(
    descriptor: PgVectorDescriptor,
    readonly length: number,
  ) {
    super(descriptor, pgvectorVector, { length });
  }
  async toWire(value: number[], _ctx: CodecCallContext) {
    return `[${value.join(',')}]`;
  }
  async fromWire(wire: string, _ctx: CodecCallContext) {
    return parseVector(wire);
  }
  fromDataTypeValue(value: DataTypeValue<readonly number[]>) {
    return [...value.value];
  }
  toDataTypeValue(input: number[]) {
    return this.dataTypeValueOf([...input]);
  }
}

export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgvectorVector.id;
  override readonly codecId = 'pg/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = pgvectorVectorParams;
  override factory(params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

export const vector = <N extends number>(length: N) =>
  column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length });
vector satisfies ColumnHelperFor<PgVectorDescriptor>;
```

The params schema is the `pgvector/vector` data type's own `params`, referenced rather than restated, so the bound on `length` is written once — see [Declaring a data type](#declaring-a-data-type). The data type's `read` refuses a stored vector of another length, so `fromDataTypeValue` only copies the array. The projection writes the text PostgreSQL prints for the vector, which `fromWire` reads as it reads a row. The codec and its factory work with `number[]` and `{ readonly length: number }` for every length; the codec checks the length it is built with in its wire methods. The literal length lives in the column helper: `vector` is generic over `N extends number`, so `vector(1536)` binds `N = 1536` at the call site, and the literal flows through `column(...)`'s `typeParams` into the column spec, the contract type and `contract.d.ts` as `{ length: 1536 }`. The column's application type, `Vector<1536>`, comes from that literal through the pack's type map, described next.

Keep the generic on the per-codec helper and call `column(...)` with the descriptor's factory directly. A polymorphic helper that tried to read the literal from the descriptor's `factory` would lose it, because TypeScript instantiates a method's generics to their constraint whenever a type is extracted from it (structural match, indexed access, `Parameters` / `ReturnType`).

#### The output type of a column with type parameters

A `vector(3)` column reads as `Vector<3>`, not as the codec's plain output type. The pack says so once, as a type, and both paths use it: a contract written with `defineContract` and the `contract.d.ts` that `prisma contract emit` writes.

```ts
import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';

type OutputTypeMap<TypeParams> = {
  readonly 'pg/vector@1': TypeParams extends { readonly length: infer N extends number }
    ? Vector<N>
    : never;
};

export interface ParameterizedOutputTypesForTypeParams extends ParameterizedOutputTypesFunction {
  readonly outputTypes: OutputTypeMap<this['typeParams']>;
}
```

The pack exports this interface from its public `codec-types` entry and names it twice:

- in its pack meta, as `__parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams`, which `defineContract` reads;
- in `types.codecTypes.parameterizedOutputTypes`, as an import of that interface, on the component that contributes the codecs. The emitted `contract.d.ts` imports it into `ParameterizedOutputTypeFunctions`, through which `ParameterizedOutputType` types a `vector(3)` column as `Vector<3>`.

A codec the map leaves out, or maps to `never` for some parameters, keeps its plain output type. Do not write `renderOutputType` for such a codec. `renderOutputType` is only for a codec whose output type cannot come from its type parameters as a type, such as `arktype/json@1` below, whose type is the text of its schema.

### Case 3 — Parameterized codec with typed schema (`arktype/json@1`)

The schema's TypeScript-level inferred type `S['infer']` is only available at the column-author site (where the user passes their typed schema), not at the descriptor's factory site (where only the serialized IR is available). This drives a slightly richer shape than Case 2:

```ts
import type { ColumnSpec } from '@internal/framework-components/codec';
import { CastExpr } from '@internal/sql-relational-core/ast';
import { pgJsonb } from '@internal/target-postgres/data-types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type Type, type } from 'arktype';

type ArktypeJsonTypeParams = { readonly expression: string; readonly jsonIr: object };

export class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  'arktype/json@1',
  readonly ['equality'],
  string,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) { super(descriptor, pgJsonb); }
  async toWire(value: TInferred, _ctx: CodecCallContext) {
    return serializeWire(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext) {
    return decodeWireValue<TInferred>(this.schema, wire);
  }
  fromDataTypeValue(value: DataTypeValue) {
    return validateSchema<TInferred>(this.schema, value.value);
  }
  toDataTypeValue(input: TInferred) {
    return this.dataTypeValueOf(serializeJson(input));
  }
}

export class ArktypeJsonDescriptor extends PostgresCodecDescriptor<ArktypeJsonTypeParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
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
    (_ctx: CodecInstanceContext) =>
      new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptor, schema),
    arktypeJsonDescriptor.codecId,
    params,
  );
}
arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
```

Three things to note:

1. `pg/jsonb` declares no parameters, so the params schema holds only the codec's own keys. A codec whose data type has parameters and which adds keys of its own writes `dataType.params.and(ownKeys)`.
2. The descriptor's factory return is `ArktypeJsonCodecClass<unknown>` (the descriptor only sees IR — `S` is erased). The runtime path through `descriptor.factory(params)` always exists (e.g. for `validateContract` re-materialization); it just loses the typed inferred shape.
3. The column helper bypasses `descriptor.factory(...)` and constructs the typed codec directly so `S['infer']` flows through the column spec into the contract type. It satisfies `ColumnHelperFor<D>` (coarse) but not `ColumnHelperForStrict<D>` — the descriptor's factory return is `ArktypeJsonCodecClass<unknown>` while the helper produces `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is invariant. Negative type tests cover the literal-preservation property the strict variant would otherwise enforce.

JSON-Schema validation lives **inside `fromWire` and `fromDataTypeValue`**: the rehydrated schema is closure-captured by the codec instance, and both call into it synchronously. The schema is a parameter the codec keeps for itself, so it checks it there; `pg/jsonb` checks only that the value is a document. There is no parallel validator registry — the framework deleted `JsonSchemaValidatorRegistry` when unified descriptors and inline decode validation replaced the parallel registry.

## Target-owned SQL codec descriptors

A SQL extension binds each codec descriptor to the target that owns its native storage and JSON projection rules. Import the target protocol from the target package's lean `./codec-descriptor` export; this is a runtime dependency whenever production extension source imports it. Target-neutral framework and SQL-family descriptors extend `CodecDescriptorTemplateImpl<P>`, which names no data type, and must be explicitly adapted — the adapter supplies the data type — before a PostgreSQL or SQLite adapter takes them.

### PostgreSQL

Subclass `PostgresCodecDescriptor<P>` when the codec itself is PostgreSQL-bound. Keep all ordinary descriptor members from the generic authoring model, and add the protected JSON projection hook, as `PgVectorDescriptor` in [Case 2](#case-2--parameterized-codec-with-literal-preservation-pgvector1) does. Collect the pack's descriptors with `definePostgresCodecs`:

```ts
import { definePostgresCodecs } from '@internal/target-postgres/codec-descriptor';
import { pgVectorDescriptor } from './codecs';

export const codecDescriptors = definePostgresCodecs([pgVectorDescriptor]);
```

The descriptor does not say how its column type is written: the data type it represents does, for DDL, schema verification and PostgreSQL's parameter casts alike. `jsonProjection(expression, params)` declares the scalar AST transformation. Identity is an explicit, behavior-preserving declaration during the 0.17 transition, not an implicit default.

The public `projectJson(expression, ref)` method validates parameters and dispatches scalar versus stored-array projection. For `ref.many === true`, the default `jsonArrayProjection` binds the input expression once, unnests with ordinality, applies the scalar hook to each non-null element, and preserves a null array, an empty array, null elements, and element order. Override `jsonArrayProjection` only when the target codec has an equivalent optimized transformation.

Adapt a reusable generic descriptor with `postgresCodec(...)` instead of subclassing it solely to add target behavior:

```ts
import { SqlIntCodec, sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgInt4 } from '@internal/target-postgres/data-types';

const postgresSqlIntDescriptor = postgresCodec(sqlIntDescriptor, {
  dataType: pgInt4,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new SqlIntCodec(descriptor, dataType),
});
```

The adapter delegates the wrapped descriptor's codec id, traits, literals and renderers, and builds codecs with the `factory` it is given, which receives the adapted descriptor, the data type and the column's parameters. A template's own factory builds no codec, because it names no data type. A target may pass a subclass of the family codec with its own wire rules, as PostgreSQL does for `int4`. The adapter's parameter schema is the data type's `params`, not the wrapped descriptor's, so a parameter's bound is declared once, on the data type. It adds the PostgreSQL discriminant and target methods.

### SQLite

Subclass `SqliteCodecDescriptor<P>` for a SQLite-bound codec and implement the scalar projection hook. SQLite has no stored scalar-array descriptor protocol; `projectJson()` rejects `CodecRef.many` rather than guessing a storage representation.

```ts
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { type ProjectionExpr, SqlTextCodec } from '@internal/sql-relational-core/ast';
import {
  defineSqliteCodecs,
  SqliteCodecDescriptor,
} from '@internal/target-sqlite/codec-descriptor';
import { sqliteText } from '@internal/target-sqlite/data-types';

export class SqliteNoteDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteText.id;
  override readonly codecId = 'acme/note@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => new SqlTextCodec(this, sqliteText);
  }
}

export const sqliteNoteDescriptor = new SqliteNoteDescriptor();
export const codecDescriptors = defineSqliteCodecs([sqliteNoteDescriptor]);
```

Generic SQL descriptors are adapted explicitly with `sqliteCodec(...)`:

```ts
import { CastExpr, SqlIntCodec, sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { sqliteCodec } from '@internal/target-sqlite/codec-descriptor';
import { sqliteInteger } from '@internal/target-sqlite/data-types';

const sqliteSqlIntDescriptor = sqliteCodec(sqlIntDescriptor, {
  dataType: sqliteInteger,
  jsonProjection: (expression) => CastExpr.as(expression, 'TEXT'),
  factory: (descriptor, dataType) => () => new SqlIntCodec(descriptor, dataType),
});
```

As with `postgresCodec(...)`, the adapter builds codecs with the `factory` it is given, and the adapted codec's parameter schema is the data type's `params`. SQLite projects an integer as decimal text, so `fromWire` reads a 64-bit value without rounding it.

### Target-typed tuples and structural validation

`definePostgresCodecs(...)` and `defineSqliteCodecs(...)` are identity-style tuple helpers. They preserve each concrete descriptor's literal and factory types while rejecting a raw generic or wrong-target descriptor at authoring time. Prefer them to broad annotations such as `readonly AnyCodecDescriptor[]`; use `readonly AnyPostgresCodecDescriptor[]` or `readonly AnySqliteCodecDescriptor[]` only where an erased target-typed collection is necessary.

Adapter composition validates erased contributions structurally through `buildPostgresCodecDescriptorRegistry(...)` or `buildSqliteCodecDescriptorRegistry(...)`. Validation checks the stable `descriptorKind`, the ordinary descriptor contract, and the target's public methods, then rejects malformed, raw generic, wrong-target, or duplicate-id contributions before lowering a query. It deliberately does not rely on `instanceof`, so an extension remains valid when its package manager loads a separate copy of the target package. This is an open-world boundary: each target owns its descriptor subtype, validator, and registry rather than participating in a framework-global target map.

### Stack contribution and direct adapter injection

Contribute one canonical target-typed descriptor set through the existing target-neutral stack metadata, beside the data types those descriptors represent. Runtime and control descriptors for the same extension must expose the same sets; when the runtime SPI also requires `codecs()`, return that canonical descriptor set there as well.

```ts
import { definePostgresCodecs } from '@internal/target-postgres/codec-descriptor';
import { pgVectorDescriptor } from './codecs';
import { pgvectorDataTypes } from './data-types';

const codecDescriptors = definePostgresCodecs([pgVectorDescriptor]);

const codecTypes = { codecDescriptors };
const dataTypes = pgvectorDataTypes;

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
import { codecDescriptors as postgresExtensionCodecs } from './codecs';
import { pgvectorDataTypes as postgresExtensionDataTypes } from './data-types';
import { codecDescriptors as sqliteExtensionCodecs } from './sqlite-codecs';

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

The descriptor is the only place a target's behaviour for a codec is declared, and the data type is the only place the database type's names are. `projectJson()` gives the expression whose JSON value `fromWire` reads; the column's declared type and PostgreSQL's parameter casts come from the data type the descriptor names. There is no parallel metadata channel to keep in step with them.

An identity `jsonProjection` is a claim, not a placeholder: it says the JSON value PostgreSQL or SQLite writes for the column is the value the driver hands `fromWire` for a row, as it is for `pg/text@1` and `pg/int4@1`. Write one only when that holds. A column whose value would change on the way into JSON — a wide integer, a byte string, a document, a vector — needs a projection that writes the text a row carries, usually `CAST(x AS text)`, because the renderer will ask and then use the answer.

## Target-owned Mongo codecs

The Mongo target package owns every built-in Mongo codec, as the Postgres target owns its codecs. The adapter depends on the target and never the reverse.

| Module | Holds |
| --- | --- |
| `@internal/target-mongo/codec-ids` | the codec id constants (`MONGO_INT64_CODEC_ID`, …) |
| `@internal/target-mongo/codecs` | the codecs built with `mongoCodec(...)`, their descriptors (`mongoCodecDescriptors`, `mongoDescriptorById`), `mongoStandardCodecs` and `buildStandardCodecRegistry` |
| `@internal/target-mongo/data-types` | the data type each codec represents |
| `@internal/target-mongo/codec-types` | the `CodecTypes` map emitted `contract.d.ts` files import |

The source lives in `packages/3-targets/mongo/1-target/src/core/{codec-ids,codecs,bson-scalar-helpers,data-types}.ts` and `src/exports/codec-types.ts`. The adapter's runtime descriptor registers `buildStandardCodecRegistry()`, and its control descriptor names each PSL scalar (`mongoScalarAuthoringTypes` in `packages/3-targets/mongo/2-adapter/src/exports/control.ts`). The TypeScript builder in `@internal/mongo-contract-ts` keeps its own copy of the `CodecTypes` map; keep the two in step. `BsonScalar`, `BsonValue` and `BsonInputValue` are declared once in `@internal/mongo-value`, which both maps import, and `@internal/target-mongo/codec-types` re-exports them.

The PSL name, TS helper, BSON storage types and application type of every Mongo codec are listed in [Scalar types](scalar-types.md#mongodb). What that page does not list is the JSON form `contract.json` stores for each codec's values, which its data type reads and the codec's `toDataTypeValue` returns:

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

A stored value in another form is refused with `RUNTIME.DECODE_FAILED` when the contract is read. `mongo/bson@1` refuses Extended JSON that is not canonical, such as a bare number or `{ "$numberInt": "abc" }`, which the `bson` reader would read as 0. The Mongo runtime reads documents through `fromWire` and never calls `fromDataTypeValue`; what `fromDataTypeValue` converts is a value a schema holds, such as a PSL enum member's value under `@@type`.

A Mongo codec is built with `mongoCodec({ typeId, dataType, toWire, fromWire, toDataTypeValue, fromDataTypeValue })`. `toDataTypeValue` returns a value of the data type, as on every codec, built with `dataType.valueFrom(json, params)`; when it is left out, the factory builds the value from the application value. Both value functions may be left out when the application type is exactly `JsonValue`; `toDataTypeValue` may be left out for a narrower JSON type such as `string`; a codec whose application type is not JSON writes both:

```ts
import type { DataTypeValue } from '@internal/framework-components/codec';
import { mongoCodec } from '@internal/mongo-codec';
import { MONGO_STRING_CODEC_ID } from '@internal/target-mongo/codec-ids';
import { mongoString } from '@internal/target-mongo/data-types';

export const mongoStringCodec = mongoCodec({
  typeId: MONGO_STRING_CODEC_ID,
  dataType: mongoString,
  fromWire: (wire: string) => wire,
  toWire: (value: string) => value,
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});
```

`Json` (`mongo/json@1`) means a JSON value, no more. `toWire` accepts exactly a plain JSON value (plain objects, arrays without holes, strings, finite numbers, booleans, `null`) and refuses anything else at any depth with `RUNTIME.ENCODE_FAILED`, naming its path. `fromWire` accepts a stored value whose every part is a BSON `object`, `array`, `string`, `double`, `int`, `bool`, `null`, or a `long` in the safe-integer range (returned as a `number`), and refuses anything else (a `Date`, `ObjectId`, `Decimal128`, `Binary`, regex, timestamp, a larger `long`, a non-finite double) with `RUNTIME.DECODE_FAILED`, naming its BSON type and path. The validator admits the same BSON types at the field's top level.

`Bson` (`mongo/bson@1`) passes values through, so the driver's number handling shows: a stored `long` in the safe-integer range and an integral `double` read back as a JavaScript `number` (the driver's default `promoteLongs` and `promoteValues`), and a `number` that fits in 32 bits is written back as `int`. Wrap a value in `Long` or `Double` to keep its BSON type across a read and a write.

The PSL names `Int`, `Float`, `Boolean` and `DateTime` are deprecated aliases of `Int32`, `Double`, `Bool` and `Date`: they resolve to the same codecs, report `PSL_DEPRECATED_SCALAR_NAME` as a warning, and will be removed.

The JSON forms of `int64`, `decimal128` and `binary` match the Postgres `int8`, `numeric` and `bytea` codecs. `Decimal128.toString()` prints some values with an exponent (`1E+3`); the codec rewrites them without one (`1000`), keeping trailing zeros, so the text is stable across a round trip. The driver hands a stored `long` that fits in 53 bits back as a `number`, a larger one (or any one with `promoteLongs: false`) as a `Long`, and every one as a `bigint` with `useBigInt64`, so the `int64` and `int64Number` codecs accept all three in `fromWire`. `mongo/int64@1` and `mongo/int64Number@1` both name the `mongo/int64` data type, as `pg/int8@1` and `pg/int8number@1` both name `pg/int8`: the first reads a `bigint`, the second a `number` within ±(2^53 − 1), refusing a stored value outside that range or with a fraction rather than rounding it, and both write a BSON `long`. Reading a wire value of the wrong BSON type throws `RUNTIME.DECODE_FAILED`.

`$jsonSchema` validators take each field's `bsonType` from the `bsonTypes` of the data type the field's codec represents, declared with `mongoDataType(id, { bsonTypes })` from `@internal/mongo-contract/data-type` and kept on the type as `mongo.bsonTypes`: one entry gives `bsonType: '<entry>'`, several give `bsonType: [...entries]` (`mongo/json@1` lists `object`, `array`, `string`, `double`, `int`, `long`, `bool`, `null`). A list field applies the same to `items`, and a nullable field prepends `'null'` unless the list already has it. A data type that lists no BSON type gets an empty schema (`{}`), which admits any value, or `{ bsonType: 'array', items: {} }` for a list field, which admits an array of any values; the field stays listed under `properties` because the validator is closed with `additionalProperties: false`.

## The data type a codec represents

Every codec descriptor names the data type it is one representation of. A data type is a stored type made first-class — `pg/int8`, `sqlite/text`, `pgvector/vector` — owned by the pack that registers it. It reads and constructs every value of the type, in the one JSON form `contract.json` stores, and it declares the casts that say which other types' values it takes. `dataType` is abstract on `CodecDescriptorImpl` and on the target-owned bases, so a descriptor that names no data type does not compile, and one that names a type no pack in the assembled stack registers is an assembly error.

`PgTextDescriptor` in [Case 1](#case-1--non-parameterized-codec-pgtext1) names `pgText` this way: `override readonly dataType = pgText.id`.

Several codecs may represent one type. `pg/int8@1` and `pg/int8number@1` both name `pg/int8`; they differ in the value they produce in memory, a `bigint` and a `number`, and both convert the digit text that type stores. The type reads the stored value; the codec converts it with `fromDataTypeValue` and hands an application value back with `toDataTypeValue`. A codec has no method for PSL and never sees PSL text.

Values of different kinds are different data types, even when the database stores them alike. SQLite stores text, a JSON document and an instant in one storage class, so its target declares `sqlite/datetime` and `sqlite/json`, both stored as `sqlite/text` (`storedAs`), each with a `read` of its own: `sqlite/datetime` stores the instant in UTC with three fraction digits, and `sqlite/json` the document's JSON text with sorted keys and no added whitespace. A contract source, `db verify` and the migration planner all read a value through its type, so an extension's type is read wherever a built-in one is.

An extension's codec does the same. `arktype/json@1` stores a `jsonb` column and validates the document against a schema on the way out, so it names `pg/jsonb` and the extension registers no data type at all. Register a new one only for a database type no pack describes yet, as pgvector does for `vector`. Reusing the target's type is what lets a written `` json`{}` `` reach an arktype column: the tag yields `pg/json`, `pg/jsonb` casts from it unchanged, and the codec validates the document.

### Declaring a data type

`dataType(id, spec)` from `@internal/framework-components/codec` declares a data type with its `read` function, its casts and, optionally, its parameters. `read(json, params)` is required: it returns the JSON when the type holds it under the parameters and refuses anything else with `refuseJsonValue`. An optional `spell(json, params)` gives the spelling the parameters require, such as two fraction digits on `numeric(10,2)`; a stored value in another spelling is refused, and a value a codec hands over is written in it. The id is `owner/name` in lower case and carries no version; a versioned id such as `pg/int8@1` names a codec, and `dataType` refuses anything that is not the `owner/name` shape.

A SQL data type is declared with `sqlDataType(id, spec)` from `@internal/sql-contract/data-type`. It takes the same `params`, `casts` and `listCast`, and adds how the database writes and reports the type. Migrations, schema verification and PostgreSQL's parameter casts all read the type's name from this declaration, and from nowhere else. In a SQL stack every codec must represent a type declared with `sqlDataType`, because a codec is how a column stores its values; the SQL family refuses a codec that represents a type declared with plain `dataType` when it creates its control instance (item 9 under [Checks on the assembled stack](#checks-on-the-assembled-stack)). The SQL family's own `sql/expression` is such a plain type: it is the type of a written SQL expression, and no codec or column has it. A Mongo data type is declared with `mongoDataType(id, { bsonTypes })` instead; see [Target-owned Mongo codecs](#target-owned-mongo-codecs).

```ts
import { readJsonInteger } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';

export const pgInt2 = sqlDataType('pg/int2', {
  texts: [
    { text: 'int2', written: true },
    { text: 'smallint', catalog: true },
  ],
  read: (json) => readJsonInteger('pg/int2', json, { min: -32768, max: 32767 }),
});

export const pgInt4 = sqlDataType('pg/int4', {
  texts: [
    { text: 'int4', written: true },
    { text: 'integer', catalog: true },
    { text: 'int' },
  ],
  read: (json) => readJsonInteger('pg/int4', json, { min: -2147483648, max: 2147483647 }),
  casts: { [pgInt2.id]: (value) => value },
});
```

Each entry of `texts` is one way the type is written or reported, in lower case with single spaces:

- `written: true` marks the text a migration writes.
- `catalog: true` marks the text the database catalog prints: `format_type` on PostgreSQL, `PRAGMA table_info` on SQLite.
- A text with neither mark is another name the database accepts for the type, such as `int`.
- A text marked only `written` is never used to recognise a type the database reports.
- `display` gives the exact characters to write and print when they differ from `text` in letter case only.

`readGeometry`, declared beside the type in the postgis extension, reads HEXEWKB text and refuses a geometry in another SRID than the column's:

```ts
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgText } from '@internal/target-postgres/data-types';
import { type as arktype } from 'arktype';

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
  read: readGeometry,
  casts: { [pgText.id]: (value) => value },
});
```

`sqlDataType` refuses a declaration that breaks these rules, with an `InternalError` naming the id. Among texts with the same placeholders, at most one is `written` and at most one is `catalog`.

#### Parameters

`params` is an arktype object schema of the type's parameters, and it is the only place a parameter's bound is written. A placeholder `{name}` in a text stands for the parameter `name` and matches a whole number, with a leading minus when the parameter's schema allows a negative one (`numeric(10,-2)`). To write a column's type, the declaration picks the `written` text whose placeholders are exactly the parameters the column has, so one type can be written several ways:

```ts
import { sqlDataType } from '@internal/sql-contract/data-type';
import { type as arktype } from 'arktype';

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
  read: readNumeric,
  spell: spellNumeric,
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});
```

`readNumeric` refuses a value `numeric(10,2)` would round, and `spellNumeric` writes the value with exactly the scale's fraction digits, as PostgreSQL prints it. A column with `{ precision: 10 }` is written `numeric(10)`, and one with `{ precision: 10, scale: 2 }` is written `numeric(10,2)`. Parameters that fail the schema, or that no `written` text takes, are refused with `CONTRACT.TYPE_PARAMS_INVALID`. A placeholder is written only with an integer value; any other value is refused with the same code, so a parameter can never write other SQL into a migration. `normalize` returns the normal form of a type's parameters, so that two ways of writing the same database type compare equal: PostgreSQL reports `numeric(10)` as `numeric(10,0)`. A type without `normalize` keeps its parameters as they are. Schema verification writes the contract's side with the normal form, so every normal form needs a `written` text with exactly its parameters, and `sqlDataType` refuses a declaration whose `normalize` gives parameters that no `written` text takes.

A codec's `paramsSchema` is its data type's `params`, referenced and never restated, so a bound has one home, as `PgCharDescriptor` sets `paramsSchema = pgCharacterLengthParams` (see [Reusing generic SQL descriptors in PostgreSQL](#reusing-generic-sql-descriptors-in-postgresql)).

A codec with parameters of its own sets `paramsSchema` to `dataType.params.and(ownKeys)`, or to its own keys alone when the data type declares no `params`, as `arktype/json@1` does. `postgresCodec(...)` and `sqliteCodec(...)` take the adapted codec's params schema from the data type they are given.

A type constructor maps its arguments onto the parameters and names only the codec; the data type follows from the codec. Every argument of a type constructor is a value argument, `{ kind: 'value', dataType }`, and assembly refuses any other kind with `CONTRACT.PACK_CONTRIBUTION_INVALID`. A value argument is a value of the named data type, read and cast as an attribute argument is (ADR 254), so `Vector(1536)` reads `1536` as a `pg/int2` and casts it to `pg/int4`, and `Vector("1536")` is refused. On Postgres every length, precision, scale and SRID is a `pg/int4`, the type of a typmod. A value argument carries no bounds, because the parameter's schema checks the value it gives. Assembly refuses a value argument whose data type no component registers (`CONTRACT.DATA_TYPE_UNREGISTERED`) or that no contract source can write (`CONTRACT.DATA_TYPE_NOT_WRITABLE`). In the TypeScript builder, the pack that registers a data type declares the TypeScript value an argument of it takes as `__dataTypeArguments` in its type, such as `{ 'pg/int4': { argument: number; parameter: number } }`: `argument` is what an author passes, and `parameter` is the type parameter the data type's reader gives for it, and `contract print` writes each argument as a literal of its data type. `inferred: true` marks the constructor written for a column of the data type when no schema names one: `contract infer` and the Prisma 7 reader write it. `contract print` writes it when it produces the column's codec, and otherwise the first constructor in the stack that does, so a `timestamptz` column with the `Temporal` codec prints `TimestamptzTemporal`, which the PostgreSQL target lists before its second name `DateTime`. It is called with the fewest arguments that give the column's parameters in normal form, so a `numeric(10,0)` column is written `Numeric(10)`. The Prisma 7 reader builds a contract rather than printing PSL, so it passes every parameter the Prisma 7 column gives. At most one constructor per data type carries the mark. A data type with no marked constructor, such as `pg/tsquery`, is still recognised, but `contract infer` cannot write a column of it and fails with `CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED`.

```ts
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';

export const pgvectorAuthoringTypes = {
  pgvector: {
    Vector: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
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
import { readJsonString } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';

export const pgEnum = sqlDataType('pg/enum', {
  params: pgEnumParams,
  read: (json) => readJsonString('pg/enum', json),
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

`pgEnumParams`, `quoteIdentifier` and `qualifiedEnumName` are the Postgres target's own. `render` and `fromReported` are allowed only with `claimsKind`, and a type with `claimsKind` declares no `texts`. A migration writes what `render` returns without further checks, so `render` must quote every parameter value it writes, as `pg/enum` does with `quoteIdentifier`.

#### Casts

`casts` is keyed by the id of the type each cast takes values of. A cast is declared by the type that receives, never by the source, so there is at most one cast for any pair and the owner of a type is the only one who decides what it takes. Each cast is a pure function from the source type's stored form to this type's, and it may throw a structured error for a value it cannot convert:

```ts
const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : refuseWrongShape(value, 'a number');
```

There is no list data type. A written list on a list column is checked element by element against the column's own type. A type whose single value holds several elements takes a written list through `listCast` instead: `of` is the element types it takes, and `cast` receives their stored forms in written order.

```ts
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgInt2, pgInt4, pgInt8, pgNumeric } from '@internal/target-postgres/data-types';

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
  read: readVector,
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

A type's values can be written in PSL only when the pack contributes an **authoring entry** for it, keyed by the type's id under `authoring.dataTypes`. The entry says how a value of the type is written, reads the text into the type's stored form, and prints a stored value back; `contract infer` and the language server read the same entry.

A value is written either with a tag — a qualified name followed by a string in any of PSL's quote styles — or in one of the three plain forms the interpreter reads without a tag: a quoted string, `true`/`false`, and a number. `parse` turns the text into the stored form and throws a structured error for text it cannot read.

```ts
[pgText.id]: {
  written: { kind: 'plain', syntax: 'string', parse: (text) => text },
  print: (value) => String(value),
  documentation: 'Text.',
},
[pgJson.id]: {
  written: { kind: 'tag', tag: 'json', parse: parseJsonText },
  print: printJsonText,
  documentation: 'Reads the text as a JSON document and stores it as the default value.',
},
```

Each entry sits under the id of the type it writes. SQLite's `json` and `datetime` tags write `sqlite/json` and `sqlite/datetime`, types of their own, so a quoted string on a `Json` or `DateTime` column is refused rather than read as text:

```ts
[sqliteJson.id]: {
  written: { kind: 'tag', tag: 'json', parse: (text) => canonicalizeJson(parseJsonText(text)) },
  print: (value) => String(value),
  documentation: 'Reads the text as a JSON document and stores its JSON text as the default value.',
},
[sqliteDatetime.id]: {
  written: { kind: 'tag', tag: 'datetime', parse: sqliteDatetimeText },
  print: (value) => String(value),
  documentation: 'An instant, as in datetime`2024-01-01T00:00:00Z`.',
},
```

A number is the one plain form that yields several types, so its arm carries a classifier in place of `parse`: `classify` picks the type from the digits and returns the stored form with it, and `types` lists every data type the classifier can return. Assembly reads `types` to know those types can be written, so leaving one out turns a cast from it into an assembly error.

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

Reading a written default is then: the entry parses or classifies the text into a value of a known type; if that type is not the column's, the column's type is looked up for a cast from it, and having none is `PSL_VALUE_TYPE_INCOMPATIBLE`; the value, cast or not, is constructed through the column's type with `valueFrom` under the column's parameters, and the column's codec's `fromDataTypeValue` checks it against the codec's own limits; a refusal there is `PSL_INVALID_DEFAULT_LITERAL` with the type's or the codec's message, such as `pg/numeric JSON value must be a decimal string that numeric(10, 2) stores without rounding`; the value's `toContract` is then stored. Text the entry or a cast refuses is `PSL_INVALID_LITERAL`. A column whose data type has no authoring entry and no cast into it takes only a `` sql`...` `` default.

A data type need not be a column's type. `sql/expression` has an authoring entry that is a tag, declares no casts, and has no codec, so its values are admitted only where a position asks for that type. The SQL family defines and registers it. A family registers only a type whose definition must not differ between targets and that nothing casts from.

Checks that depend on a column's parameters belong in the data type's `read`: `vector(3)` refuses four elements, and `numeric(10,2)` refuses a third decimal place. A limit of a target's storage is the codec's to refuse: on SQLite, `sqlite/real@1` and `sql/float@1` refuse `NaN`, because SQLite cannot store it.

### Checks on the assembled stack

The control stack assembles every pack's data types, codec descriptors and authoring entries into one stack and checks them against each other. Each failure names the contributing component and the id at fault:

1. **A codec names a type nobody registers.** `CONTRACT.DATA_TYPE_UNREGISTERED`.
2. **An authoring entry, a type in a number entry's `types`, or a type some cast takes values of, is not registered.** Also `CONTRACT.DATA_TYPE_UNREGISTERED`.
3. **Two entries claim one tag or one plain form.** `CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE`. Two packs registering one type id is `CONTRACT.DATA_TYPE_DUPLICATE`, and two entries under one key is `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE`.
4. **A type some cast takes values of cannot be written.** `CONTRACT.DATA_TYPE_NOT_WRITABLE`: a cast from a type no contract source can write is never exercised. A type counts as writable when it has an authoring entry of its own, or when a number entry's `types` names it.

The reverse of the fourth is not required: a type may be reachable only through casts. These checks span packs, which is why they run at assembly — `pgvector/vector` taking `pg/numeric` values is valid only when the Postgres target that owns `pg/numeric` is in the stack. Within a pack, refer to a type by its constant rather than by string, so a misspelt id fails to compile.

Type constructors are checked at assembly too. Each failure is an `InternalError` naming the contributor and the id:

5. **A type constructor names a codec no component registers.**
6. **A type constructor maps an argument onto a parameter** that neither the codec's data type's `params` nor the codec's own parameters declare.
7. **Two type constructors of one data type are both marked `inferred`.**

The SQL family checks its stack's data types and codecs when it creates its control instance, not during assembly. So CLI commands report these failures and the language server does not. Each failure names the contributor:

8. **Two SQL data types claim the same reported type**: a claiming text of one matches a claiming text of the other, or both claim the same kind. An `InternalError`.
9. **A codec in a SQL stack represents a data type that is not a SQL data type** (declared with plain `dataType` rather than `sqlDataType`). An `InternalError` that names the codec, its data type and the data type's contributor.
10. **A data type casts from `sql/expression`.** `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`.

### A codec whose data type depends on the target

A codec the SQL family exports for several targets cannot name a data type, because the type belongs to the target that adapts it. Its descriptor extends `CodecDescriptorTemplateImpl<P>`, which is `CodecDescriptorImpl<P>` without `dataType`:

```ts
export class SqlTextDescriptor extends CodecDescriptorTemplateImpl<void> {
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => unadapted(this.codecId);
  }
}
```

The template's own factory refuses to build a codec, because a codec is built with its data type and the template names none. The target names the type when it adapts the template, alongside the JSON projection and a factory that builds the codec with that type:

```ts
import { SqlTextCodec, sqlTextDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';

export const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new SqlTextCodec(descriptor, dataType),
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
import { CastExpr, SqlCharCodec, sqlCharDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import { pgChar } from '@internal/target-postgres/data-types';

const postgresSqlCharDescriptor = postgresCodec(sqlCharDescriptor, {
  dataType: pgChar,
  jsonProjection: (expression) => CastExpr.as(expression, 'text'),
  factory: (descriptor, dataType, params) => () => new SqlCharCodec(descriptor, dataType, params),
});
```

The adapter preserves the generic codec id, traits, output renderer, and metadata, builds codecs with the `factory` it is given, takes its params schema from the data type, and adds PostgreSQL projection behavior. The projection casts the value to `text`, which drops the spaces that pad a `character` value to its length, so an include reads the value an ordinary row's `fromWire` returns. It also supplies the `dataType` the template itself cannot name — see [A codec whose data type depends on the target](#a-codec-whose-data-type-depends-on-the-target).

When PostgreSQL owns a distinct codec id, define a `PostgresCodecDescriptor` subclass and delegate only the reusable SQL behavior explicitly:

```ts
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import {
  CastExpr,
  type ProjectionExpr,
  SqlCharCodec,
  sqlCharDescriptor,
} from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { pgChar, pgCharacterLengthParams } from '@internal/target-postgres/data-types';

type LengthParams = { readonly length?: number };

class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return CastExpr.as(expression, 'text');
  }
  override readonly dataType = pgChar.id;
  override readonly codecId = 'pg/char@1' as const;
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = pgCharacterLengthParams;
  override factory(params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this, pgChar, params ?? {});
  }
}
```

This keeps target ownership explicit: adaptation is for a reusable descriptor with its existing id; target-owned subclassing is for a PostgreSQL codec with PostgreSQL identity or behavior. In both cases the result satisfies the PostgreSQL descriptor protocol and can participate in `definePostgresCodecs(...)`.

See [packages/3-targets/postgres/1-target/src/core/codecs.ts](../../packages/3-targets/postgres/1-target/src/core/codecs.ts) (`postgresSqlCharDescriptor`, `PgCharDescriptor`) for both patterns.

## Aggregate result codecs

What an aggregate returns is a declaration of its target, not a property of the input codec. That contribution surface — `SqlAggregateDescriptor` on `types.aggregateDescriptors`, a sibling of `codecTypes` — has its own reference: the [aggregate descriptor guide](./aggregate-descriptor-guide.md).

## Heterogeneous storage at the runtime layer

The framework's descriptor registry is keyed by `codecId: string` and stores type-erased descriptor instances. The canonical erasure type is `AnyCodecDescriptor` (defined in `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`). An excerpt of the SQL registry's interface (`packages/2-sql-family/4-lanes/relational-core/src/query-lane-context.ts`):

```ts
import type { CodecDescriptor } from '@internal/framework-components/codec';

interface CodecDescriptorRegistry {
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  values(): IterableIterator<CodecDescriptor<unknown>>;
}
```

Registries are built from flat descriptor lists (see `buildCodecDescriptorRegistry` in `@internal/sql-relational-core`); there is no imperative `register` on the public surface.

`CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly), so `CodecDescriptor<unknown>` is **not** assignable from concrete `CodecDescriptor<SpecificParams>` subclasses — the `<unknown>` shape would force `as` casts at every register/retrieve boundary. `AnyCodecDescriptor` is the only erasure form that admits cast-free heterogeneous storage.

Per-codec helpers don't pass through the registry — they're imported directly by extension authors and column-defining sites. The registry exists for runtime lookup (by codec id string), where types are already erased.

## Why classes work for this design

The class hierarchy does not preserve literal types; the per-codec helpers' direct calls do that. It gives codecs and descriptors their **structure**:

1. **Codec instance ↔ descriptor reference is structural.** The abstract `CodecImpl` constructor takes a `descriptor: AnyCodecDescriptor`; concrete codec subclasses pass it, with their data type and the column's parameters, via `super(descriptor, dataType, params)`. `codec.id` proxies through this reference, so a target-owned descriptor can reuse a generic codec class while preserving the target-owned codec id without object spreads or prototype loss.
2. **Subclass-based authoring is uniform within each ownership boundary.** Target-neutral descriptors extend `CodecDescriptorImpl<...>`; PostgreSQL- and SQLite-bound descriptors extend their target-owned bases. Generic descriptors cross into a target through explicit adapters such as `postgresCodec(...)`. The variance behavior remains the same: the per-codec helper handles literal preservation via direct calls, while the descriptor class or adapter declares the target shape.

## Reference implementations in the repo

- **Non-parameterized base codecs** (text, int, float, bool, etc.): `packages/2-sql-family/4-lanes/relational-core/src/ast/sql-codecs.ts`.
- **PostgreSQL target codecs and generic descriptor adapters**: `packages/3-targets/postgres/1-target/src/core/codecs.ts`.
- **SQLite target codecs and generic descriptor adapters**: `packages/3-targets/sqlite/1-target/src/core/codecs.ts`.
- **Parameterized codec with literal preservation** (pgvector): `packages/3-extensions/pgvector/src/core/codecs.ts`.
- **Parameterized codec with typed schema** (arktype-json): `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`.

## Pitfalls

- **`override` discipline.** With `noImplicitOverride`, every concrete-subclass member that touches an inherited member must carry `override`. Forgetting it surfaces as a typecheck error.
- **Don't widen the factory return at the descriptor.** Concrete descriptors should declare their factory's typed return (`(ctx) => PgVectorCodec`, not `(ctx) => Codec<...>`). The widened return loses literal preservation at consumer sites.
- **Don't extract codec types via `Parameters` / `ReturnType` of the descriptor's `factory`.** TypeScript widens method generics to their constraint in those forms. Use the per-codec helper's typed return (`ColumnSpec<R, P>`) and project with `R extends Codec<any, any, any, infer T> ? T : never`.
- **Don't reach through the codec instance for metadata.** The runtime `Codec` instance is narrow (id + four conversion methods). Read traits and meta from `descriptor` (e.g. `context.codecDescriptors.descriptorFor(codecId).traits`).

## See also

- [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — design rationale and how the codec composes across authoring, emit, and runtime dispatch.
- [ADR 204 — Single-Path Async Codec Runtime](../architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — `toWire` / `fromWire` (named `encode` / `decode` there) are uniformly Promise-returning at the public boundary.
- [ADR 207 — Codec call context](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the `CodecCallContext` (per-call signal + family-extended column metadata) threaded into every `toWire` / `fromWire` invocation.
