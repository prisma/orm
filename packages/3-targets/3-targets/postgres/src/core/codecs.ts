/**
 * Native Postgres target codecs (TML-2357). Mirrors the SQL base codec form in `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`.
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `PgXCodec` class extending {@link CodecImpl} that wraps the module-level encode/decode/encodeJson/decodeJson constants exported from `codec-helpers.ts` (the single source of truth for non-trivial runtime conversions; trivial identity passthroughs are inlined). 2. A `PgXDescriptor` class extending {@link PostgresCodecDescriptor} declaring the codec id, traits, target types, params schema, native type, canonical JSON projection, and (where applicable) the emit-path `renderOutputType`. 3. A per-codec column helper (`pgXColumn`) that calls `descriptor.factory(...)` directly and packages the result into a framework `ColumnSpec` via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor` (and `ColumnHelperForStrict` where the resolved codec type is well-defined).
 *
 * After TML-2357 this is the canonical source of Postgres codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers (and the parallel `byScalar`/`codecDescriptorDefinitions`/ `codecDescriptorList` collection exports) retired with the deletion sweep.
 *
 * Audit (parameterized codecs): every parameterized codec in this file is **parameter-stateless** — the params (`length`, `precision`, `precision`+`scale`, `values`) only inform the emit-path `renderOutputType` renderer or stay as JSON metadata. None of the runtime encode/decode/encodeJson/decodeJson conversions thread params into their behavior, so each `factory(_params)` returns a fresh codec constructed solely from
 * `this` (the descriptor).
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  renderTsLiteral,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  BinaryExpr,
  CaseExpr,
  CastExpr,
  FunctionCallExpr,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  type ProjectionExpr,
  SqlCharCodec,
  SqlFloatCodec,
  SqlIntCodec,
  SqlVarcharCodec,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlTimestampDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { definePostgresCodecs, PostgresCodecDescriptor, postgresCodec } from './codec-descriptor';
import {
  decimalTextBigintLiteral,
  type PgInterval,
  pgBigintEncode,
  pgBigintEncodeJson,
  pgByteaDecodeJson,
  pgByteaEncodeJson,
  pgDateDecode,
  pgDateDecodeJson,
  pgDateEncode,
  pgDateEncodeJson,
  pgDateTemporalDecode,
  pgDateTemporalEncode,
  pgInt8Decode,
  pgInt8NumberDecode,
  pgInt8NumberDecodeJson,
  pgInt8NumberEncode,
  pgInt8NumberEncodeJson,
  pgIntervalDecode,
  pgIntervalDecodeJson,
  pgIntervalEncodeJson,
  pgIntervalToIso,
  pgJsonbDecode,
  pgJsonbEncode,
  pgJsonDecode,
  pgJsonEncode,
  pgNumericDecode,
  pgNumericRenderOutputType,
  pgTimestampDecodeJson,
  pgTimestampEncodeJson,
  pgTimestampTemporalDecode,
  pgTimestampTemporalEncode,
  pgTimestamptzDecodeJson,
  pgTimestamptzEncodeJson,
  pgTimestamptzTemporalDecode,
  pgTimestamptzTemporalEncode,
  pgTimeTemporalDecode,
  pgTimeTemporalEncode,
  pgUnboundedIntDecode,
  renderLength,
  renderPrecision,
} from './codec-helpers';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_DATE_CODEC_ID,
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INET_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INT8_NUMBER_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UNBOUNDED_INT_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
} from './codec-ids';
import { postgresError } from './errors';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';
import { PostgresNativeEnum } from './postgres-native-enum';

type LengthParams = { readonly length?: number };
type PrecisionParams = { readonly precision?: number };
type NumericParams = { readonly precision?: number; readonly scale?: number };

const lengthParamsSchema = arktype({
  'length?': 'number.integer > 0',
}) satisfies StandardSchemaV1<LengthParams>;

const numericParamsSchema = arktype({
  'precision?': 'number.integer > 0 & number.integer <= 1000',
  'scale?': 'number.integer >= 0',
}) satisfies StandardSchemaV1<NumericParams>;

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
}) satisfies StandardSchemaV1<PrecisionParams>;

const PG_TEXT_NATIVE_TYPE = 'text';
const PG_TEXT_ARRAY_NATIVE_TYPE = 'text[]';
const PG_INT4_NATIVE_TYPE = 'integer';
const PG_INT2_NATIVE_TYPE = 'smallint';
const PG_INT8_NATIVE_TYPE = 'bigint';
const PG_FLOAT4_NATIVE_TYPE = 'real';
const PG_FLOAT8_NATIVE_TYPE = 'double precision';
const PG_NUMERIC_NATIVE_TYPE = 'numeric';
const PG_DATE_NATIVE_TYPE = 'date';
const PG_TIMESTAMP_NATIVE_TYPE = 'timestamp without time zone';
const PG_TIMESTAMPTZ_NATIVE_TYPE = 'timestamp with time zone';
const PG_TIME_NATIVE_TYPE = 'time';
const PG_TIMETZ_NATIVE_TYPE = 'timetz';
const PG_BOOL_NATIVE_TYPE = 'boolean';
const PG_BIT_NATIVE_TYPE = 'bit';
const PG_VARBIT_NATIVE_TYPE = 'bit varying';
const PG_BYTEA_NATIVE_TYPE = 'bytea';
const PG_INTERVAL_NATIVE_TYPE = 'interval';
const PG_JSON_NATIVE_TYPE = 'json';
const PG_JSONB_NATIVE_TYPE = 'jsonb';

/**
 * Projects the expression unchanged, for codecs whose canonical JSON is what
 * PostgreSQL's own JSON conversion already produces.
 *
 * Identity here is a claim about the target's behaviour, not an absence of one:
 * the codec's conformance cases are what test it, including at the boundaries
 * of the representation — escaping, sign, and range — where a native conversion
 * would be most likely to diverge.
 */
/**
 * Whether a string is numeric text in the form PostgreSQL *prints*, which is
 * narrower than the form it accepts.
 *
 * `numeric` reads `+123`, `.5`, `1.`, `1e5`, `0x1f`, `1_000` and whitespace-padded
 * input, but prints every one of them in a single normalised form — `123`,
 * `0.5`, `1`, `100000`, `31`, `1000`, `12`. The projection reads the column back
 * through that printing, so accepting an input spelling here would produce an
 * application value the projection can never return: `encodeJson('1e5')` would
 * claim `1e5` where the database yields `100000`.
 *
 * `NaN`, `Infinity` and `-Infinity` are genuine `numeric` values, not error
 * states, and PostgreSQL emits them into JSON as strings — so they belong to the
 * canonical form and round-trip like any other value.
 */
const CANONICAL_NUMERIC_TEXT = /^(?:-?\d+(?:\.\d+)?|NaN|-?Infinity)$/;

const isCanonicalNumericText = (value: string): boolean => CANONICAL_NUMERIC_TEXT.test(value);

const identityJsonProjection = (expression: ProjectionExpr): ProjectionExpr => expression;

/**
 * Projects a numeric-valued expression as decimal text.
 *
 * The cast is part of the projected expression, which is what makes it correct:
 * whatever `jsonProjection` returns is the argument the JSON constructor
 * receives, so casting here happens *before* PostgreSQL builds the JSON value.
 * Handed a `numeric` or `int8` directly, the constructor emits a JSON **number**,
 * and every digit past IEEE-754's 53 bits of significand is gone by the time the
 * driver has parsed it — before any codec can intervene. A cast applied to the
 * constructor's result instead of its argument would be too late to matter.
 */
const decimalTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'text');

/**
 * Projects a `bytea` as base64 text.
 *
 * Like the decimal-text cast, the encoding is part of the projected expression:
 * PostgreSQL's own JSON conversion of a `bytea` emits its `\x`-prefixed hex
 * output form, so the base64 encoding has to replace that conversion rather
 * than post-process it.
 *
 * `encode` emits RFC 2045 base64, which carries a line break every 76
 * characters — so any value over 56 bytes arrives wrapped. The breaks are
 * removed here, because the canonical form is unwrapped base64 and
 * `decodeJson` rejects anything else. `chr(10)` rather than a newline literal
 * keeps the rendered SQL on one line.
 */
const base64JsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  FunctionCallExpr.of('translate', [
    FunctionCallExpr.of('encode', [expression, LiteralExpr.of('base64')]),
    FunctionCallExpr.of('chr', [LiteralExpr.of(10)]),
    LiteralExpr.of(''),
  ]);

/**
 * Projects a temporal value as the text PostgreSQL itself renders for it.
 *
 * This position used to hold the opposite policy. A `timestamptz` handed straight to a JSON
 * constructor renders in the session's `TimeZone`, so the same stored instant read as `+00:00`,
 * `-05:00` or `+05:30` depending on who was connected; the previous projection resolved the instant
 * to UTC and spelled it out with an explicit `to_char` format so that no session setting could move
 * it. That pinning is deliberately gone, for two reasons it could not reconcile:
 *
 * - Its format string ended in `.MS` — **milliseconds**. Every nested read silently truncated the
 *   microseconds PostgreSQL had stored, which is a live loss of data rather than a formatting
 *   preference.
 * - A flat read of the same column returns the server's own text. Pinning one path and not the
 *   other meant the two disagreed about what the value was, and having them agree is the point of
 *   this representation.
 *
 * So a nested read is now session-`TimeZone`-dependent exactly as a flat read already was. Nothing
 * downstream minds which offset the session picks: `Temporal.Instant.from()` accepts any of them
 * and resolves to the same instant, and the `*-string` codecs are handing back whatever the server
 * said by definition. Session-dependent output is a documented non-goal to hide, not a defect.
 *
 * The cast belongs inside the projection for the reason spelled out on {@link
 * decimalTextJsonProjection}: what `jsonProjection` returns is the argument the JSON constructor
 * receives, so casting here happens before PostgreSQL builds the JSON value rather than after.
 */
const serverTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'text');

const datePart = (field: string, expression: ProjectionExpr): ProjectionExpr =>
  FunctionCallExpr.of('date_part', [LiteralExpr.of(field), expression]);

const whenNonZero = (value: ProjectionExpr, rendered: ProjectionExpr): ProjectionExpr =>
  CaseExpr.of(
    [{ condition: BinaryExpr.neq(value, LiteralExpr.of(0)), value: rendered }],
    LiteralExpr.of(null),
  );

/**
 * Projects an `interval` as an ISO-8601 duration.
 *
 * An interval carries months, days and microseconds independently — `P1M` and
 * `P30D` are different intervals — so the projection reads each field with
 * `date_part` and assembles them rather than reducing the value to an epoch,
 * which would have to choose a length for a month. `IntervalStyle` decides how
 * PostgreSQL spells an interval and cannot be bound per expression, so the
 * spelling is constructed here instead of inherited.
 *
 * `concat` drops NULL arguments, so a zero component is omitted by rendering as
 * NULL; the seconds field is taken through `numeric` because a `double
 * precision` microsecond renders in scientific notation.
 *
 * That same NULL-dropping is why the whole assembly sits under an explicit NULL
 * check: for a NULL interval every field is NULL, `concat` yields `'P'`, and the
 * zero-duration fallback below would report an absent value as a zero one.
 */
const isoDurationJsonProjection = (expression: ProjectionExpr): ProjectionExpr => {
  const field = (name: string) => datePart(name, expression);
  const seconds = CastExpr.as(field('second'), 'numeric');
  const assembled = FunctionCallExpr.of('concat', [
    LiteralExpr.of('P'),
    whenNonZero(field('year'), FunctionCallExpr.of('concat', [field('year'), LiteralExpr.of('Y')])),
    whenNonZero(
      field('month'),
      FunctionCallExpr.of('concat', [field('month'), LiteralExpr.of('M')]),
    ),
    whenNonZero(field('day'), FunctionCallExpr.of('concat', [field('day'), LiteralExpr.of('D')])),
    CaseExpr.of(
      [
        {
          condition: OrExpr.of([
            BinaryExpr.neq(field('hour'), LiteralExpr.of(0)),
            BinaryExpr.neq(field('minute'), LiteralExpr.of(0)),
            BinaryExpr.neq(field('second'), LiteralExpr.of(0)),
          ]),
          value: LiteralExpr.of('T'),
        },
      ],
      LiteralExpr.of(null),
    ),
    whenNonZero(field('hour'), FunctionCallExpr.of('concat', [field('hour'), LiteralExpr.of('H')])),
    whenNonZero(
      field('minute'),
      FunctionCallExpr.of('concat', [field('minute'), LiteralExpr.of('M')]),
    ),
    whenNonZero(field('second'), FunctionCallExpr.of('concat', [seconds, LiteralExpr.of('S')])),
  ]);

  return CaseExpr.of(
    [{ condition: NullCheckExpr.isNull(expression), value: LiteralExpr.of(null) }],
    FunctionCallExpr.of('coalesce', [
      FunctionCallExpr.of('nullif', [assembled, LiteralExpr.of('P')]),
      LiteralExpr.of('PT0S'),
    ]),
  );
};

export const postgresSqlCharDescriptor = postgresCodec(sqlCharDescriptor, {
  nativeType: () => 'character',
  jsonProjection: identityJsonProjection,
});

export const postgresSqlVarcharDescriptor = postgresCodec(sqlVarcharDescriptor, {
  nativeType: () => 'character varying',
  jsonProjection: identityJsonProjection,
});

export const postgresSqlIntDescriptor = postgresCodec(sqlIntDescriptor, {
  nativeType: () => 'int4',
  jsonProjection: identityJsonProjection,
});

export const postgresSqlFloatDescriptor = postgresCodec(sqlFloatDescriptor, {
  nativeType: () => 'float8',
  jsonProjection: identityJsonProjection,
});

export const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  nativeType: () => 'text',
  jsonProjection: identityJsonProjection,
});

export const postgresSqlTimestampDescriptor = postgresCodec(sqlTimestampDescriptor, {
  nativeType: () => 'timestamp',
  jsonProjection: identityJsonProjection,
});

export class PgTextCodec extends CodecImpl<
  typeof PG_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_TEXT_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    return () => new PgTextCodec(this);
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const pgTextColumn = () =>
  column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined, 'text');

pgTextColumn satisfies ColumnHelperFor<PgTextDescriptor>;
pgTextColumn satisfies ColumnHelperForStrict<PgTextDescriptor>;

/**
 * Codec for a `pg.enum(Ref)` column bound to a native Postgres enum type.
 * Text passthrough, identical to `pg/text@1` — encode/decode do not carry the
 * enum's member values; membership is enforced by the native type itself, not
 * by this codec. `renderValueLiteral` renders a member value as its TS
 * literal, which is what drives the column's typed value-union (via
 * `renderValueSetType` reading the column's `valueSet` ref) — the codec
 * itself carries no params of its own; typing comes entirely from the
 * column's value-set, not from `pg/enum@1`.
 *
 * A distinct codec id (rather than reusing `pg/text@1` on a plain text
 * column) keeps native-enum columns independently identifiable — from a
 * column's `codecId` alone, without also inspecting `nativeType` — which
 * the managed (DDL) phase needs to target `CREATE TYPE`/`ALTER TYPE`
 * operations at exactly the columns that use one.
 */
export class PgEnumCodec extends CodecImpl<
  typeof PG_ENUM_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<
      string,
      'text codec: a native-enum member value is stored as its wire string form'
    >(json);
  }
}

export type PgEnumParams = { readonly typeName: string };

/**
 * Narrows codec `typeParams` to {@link PgEnumParams} — the shape that binds a
 * column to a named database type (a native enum's `CREATE TYPE` name).
 */
export function isPgEnumParams(value: unknown): value is PgEnumParams {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'typeName' in value &&
    typeof value.typeName === 'string'
  );
}

const pgEnumParamsSchema = arktype({
  typeName: 'string',
}) satisfies StandardSchemaV1<PgEnumParams>;

export class PgEnumDescriptor extends PostgresCodecDescriptor<PgEnumParams> {
  protected override nativeType(params: PgEnumParams): string {
    return params.typeName;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_ENUM_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = pgEnumParamsSchema satisfies StandardSchemaV1<PgEnumParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(_params: PgEnumParams): (ctx: CodecInstanceContext) => PgEnumCodec {
    return () => new PgEnumCodec(this);
  }

  /**
   * Authoring-time hook a `pg.enum(<ref>)` type constructor calls once it has
   * resolved its ref argument to the referenced `native_enum` entity:
   * produces this codec's per-column `typeParams` and native type from the
   * entity's bare type name. Schema-qualification (`auth.aal_level` for a
   * named non-default schema) is not this hook's concern — the field's
   * namespace isn't known at this call site for every authoring path (the TS
   * builder resolves a column before it knows its model's namespace), so it is
   * applied later, at contract construction, by {@link qualifyNativeType} via
   * the target's `authoring.qualifyColumnType` hook. `nativeType` mirrors
   * `typeParams.typeName` — the same value `nativeTypeFor` derives at render
   * time — so the column's declared native type and the render-time cast
   * agree. Returns `undefined` if `entity` is not a `PostgresNativeEnum` (a
   * contributor bug, not a user-schema error — the caller decides how to
   * report it).
   */
  columnFromEntity(
    entity: object,
  ): { readonly typeParams: PgEnumParams; readonly nativeType: string } | undefined {
    if (!PostgresNativeEnum.is(entity)) return undefined;
    return { typeParams: { typeName: entity.typeName }, nativeType: entity.typeName };
  }

  /**
   * Schema-qualifies this native enum type's name for the namespace the
   * consuming column lives in: `${namespaceId}.${typeName}` for a named
   * non-default schema, bare for the target's default schema (`public`) or
   * the late-bound unbound sentinel (whose schema `search_path` resolves at
   * runtime). Postgres's `format_type()` reports the bare name for a
   * public-schema type, so a public column's declared native type must stay
   * bare to match. Owned here because the codec owns its native type.
   */
  qualifyNativeType(typeName: string, namespaceId: string): string {
    return namespaceId === DEFAULT_NAMESPACE_ID || namespaceId === UNBOUND_NAMESPACE_ID
      ? typeName
      : `${namespaceId}.${typeName}`;
  }
}

export const pgEnumDescriptor = new PgEnumDescriptor();

/**
 * Contract-construction-time column-type qualifier the Postgres target
 * contributes through `authoring.qualifyColumnType`.
 * `buildSqlContractFromDefinition` calls this for every column as it is
 * constructed, passing the column's bare type info and its owning
 * `namespaceId`; a native-enum column (`pg/enum@1`) gets its type name
 * schema-qualified for that namespace (via
 * {@link PgEnumDescriptor.qualifyNativeType}), keeping `nativeType` and
 * `typeParams.typeName` in sync. Every other codec passes through unchanged.
 * Both the PSL `pg.enum(Ref)` path and the TS `pg.enum(handle)` path route
 * through here — the dispatch keys off the codec id, not authoring surface.
 */
export function postgresQualifyColumnType(
  input: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
  },
  namespaceId: string,
): { readonly nativeType: string; readonly typeParams?: Record<string, unknown> } {
  if (input.codecId !== PG_ENUM_CODEC_ID) return input;
  const bareTypeName = input.typeParams?.['typeName'];
  if (typeof bareTypeName !== 'string') return input;
  const qualified = pgEnumDescriptor.qualifyNativeType(bareTypeName, namespaceId);
  return { nativeType: qualified, typeParams: { ...input.typeParams, typeName: qualified } };
}

/**
 * Postgres `text[]` codec. Encode is an identity pass-through: the pg wire
 * driver serialises a JS `string[]` to a Postgres array literal under the
 * `$N::text[]` cast the renderer emits from this codec's `text[]` native type,
 * and decode reads it back as a JS array. Used by the control plane to write
 * the marker's `invariants` column. Not a user-facing scalar — it is not part
 * of the authorable `CodecTypes` surface, only the runtime codec registry.
 */
export class PgTextArrayCodec extends CodecImpl<
  typeof PG_TEXT_ARRAY_CODEC_ID,
  readonly ['equality'],
  readonly string[],
  readonly string[]
> {
  async encode(value: readonly string[], _ctx: CodecCallContext): Promise<readonly string[]> {
    return value;
  }
  async decode(wire: readonly string[], _ctx: CodecCallContext): Promise<readonly string[]> {
    return wire;
  }
  encodeJson(value: readonly string[]): JsonValue {
    return [...value];
  }
  decodeJson(json: JsonValue): readonly string[] {
    return Array.isArray(json) ? json.map((entry) => String(entry)) : [];
  }
}

export class PgTextArrayDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_TEXT_ARRAY_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_TEXT_ARRAY_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['text[]'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgTextArrayCodec {
    return () => new PgTextArrayCodec(this);
  }
}

export const pgTextArrayDescriptor = new PgTextArrayDescriptor();

export class PgInt4Codec extends CodecImpl<
  typeof PG_INT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INT4_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_INT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int4'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt4Codec {
    return () => new PgInt4Codec(this);
  }
}

export const pgInt4Descriptor = new PgInt4Descriptor();

export const pgInt4Column = () =>
  column(pgInt4Descriptor.factory(), pgInt4Descriptor.codecId, undefined, 'int4');

pgInt4Column satisfies ColumnHelperFor<PgInt4Descriptor>;
pgInt4Column satisfies ColumnHelperForStrict<PgInt4Descriptor>;

export class PgInt2Codec extends CodecImpl<
  typeof PG_INT2_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgInt2Descriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INT2_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_INT2_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int2'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt2Codec {
    return () => new PgInt2Codec(this);
  }
}

export const pgInt2Descriptor = new PgInt2Descriptor();

export const pgInt2Column = () =>
  column(pgInt2Descriptor.factory(), pgInt2Descriptor.codecId, undefined, 'int2');

pgInt2Column satisfies ColumnHelperFor<PgInt2Descriptor>;
pgInt2Column satisfies ColumnHelperForStrict<PgInt2Descriptor>;

/**
 * A Postgres `int8` spans the full signed 64-bit range, which a JS `number`
 * cannot hold past 2^53. Application values are `bigint` and the canonical JSON
 * is decimal text; the wire form is the decimal string `pg` reads and writes for
 * this type.
 */
export class PgInt8Codec extends CodecImpl<
  typeof PG_INT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number | bigint,
  bigint
> {
  async encode(value: bigint, _ctx: CodecCallContext): Promise<string> {
    return pgBigintEncode(PG_INT8_CODEC_ID, value);
  }
  async decode(wire: string | number | bigint, _ctx: CodecCallContext): Promise<bigint> {
    return pgInt8Decode(wire);
  }
  encodeJson(value: bigint): JsonValue {
    return pgBigintEncodeJson(PG_INT8_CODEC_ID, value);
  }
  decodeJson(json: JsonValue): bigint {
    if (typeof json !== 'string') {
      throw postgresError(
        'RUNTIME.DECODE_FAILED',
        'pg/int8@1 database JSON value must be a decimal string',
        { meta: { codecId: PG_INT8_CODEC_ID, received: typeof json } },
      );
    }
    return pgInt8Decode(json);
  }
}

export class PgInt8Descriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INT8_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly codecId = PG_INT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['int8'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextBigintLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt8Codec {
    return () => new PgInt8Codec(this);
  }
}

export const pgInt8Descriptor = new PgInt8Descriptor();

export const pgInt8Column = () =>
  column(pgInt8Descriptor.factory(), pgInt8Descriptor.codecId, undefined, 'int8');

pgInt8Column satisfies ColumnHelperFor<PgInt8Descriptor>;
pgInt8Column satisfies ColumnHelperForStrict<PgInt8Descriptor>;

/**
 * A Postgres `int8` decoded as a JS `number`, for columns whose values stay
 * within the safe integer range ±(2^53 − 1). Both directions guard rather than
 * round: decode (wire and JSON) and encode throw a structured error on
 * out-of-range or non-integral input. The canonical JSON is a JSON number —
 * the deliberate exception to the decimal-text rule for 64-bit integers, and
 * the codec's purpose. The descriptor claims no target type, so `int8` in type
 * position stays `pg/int8@1`.
 */
export class PgInt8NumberCodec extends CodecImpl<
  typeof PG_INT8_NUMBER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number | bigint,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<string> {
    return pgInt8NumberEncode(value);
  }
  async decode(wire: string | number | bigint, _ctx: CodecCallContext): Promise<number> {
    return pgInt8NumberDecode(wire);
  }
  encodeJson(value: number): JsonValue {
    return pgInt8NumberEncodeJson(value);
  }
  decodeJson(json: JsonValue): number {
    return pgInt8NumberDecodeJson(json);
  }
}

export class PgInt8NumberDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INT8_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_INT8_NUMBER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt8NumberCodec {
    return () => new PgInt8NumberCodec(this);
  }
}

export const pgInt8NumberDescriptor = new PgInt8NumberDescriptor();

export const pgInt8NumberColumn = () =>
  column(pgInt8NumberDescriptor.factory(), pgInt8NumberDescriptor.codecId, undefined, 'int8');

pgInt8NumberColumn satisfies ColumnHelperFor<PgInt8NumberDescriptor>;
pgInt8NumberColumn satisfies ColumnHelperForStrict<PgInt8NumberDescriptor>;

export class PgFloat4Codec extends CodecImpl<
  typeof PG_FLOAT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgFloat4Descriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_FLOAT4_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_FLOAT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float4'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgFloat4Codec {
    return () => new PgFloat4Codec(this);
  }
}

export const pgFloat4Descriptor = new PgFloat4Descriptor();

export const pgFloat4Column = () =>
  column(pgFloat4Descriptor.factory(), pgFloat4Descriptor.codecId, undefined, 'float4');

pgFloat4Column satisfies ColumnHelperFor<PgFloat4Descriptor>;
pgFloat4Column satisfies ColumnHelperForStrict<PgFloat4Descriptor>;

export class PgFloat8Codec extends CodecImpl<
  typeof PG_FLOAT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

export class PgFloat8Descriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_FLOAT8_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_FLOAT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['float8'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgFloat8Codec {
    return () => new PgFloat8Codec(this);
  }
}

export const pgFloat8Descriptor = new PgFloat8Descriptor();

export const pgFloat8Column = () =>
  column(pgFloat8Descriptor.factory(), pgFloat8Descriptor.codecId, undefined, 'float8');

pgFloat8Column satisfies ColumnHelperFor<PgFloat8Descriptor>;
pgFloat8Column satisfies ColumnHelperForStrict<PgFloat8Descriptor>;

export class PgBoolCodec extends CodecImpl<
  typeof PG_BOOL_CODEC_ID,
  readonly ['equality', 'boolean'],
  boolean,
  boolean
> {
  async encode(value: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return value;
  }
  async decode(wire: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return wire;
  }
  encodeJson(value: boolean): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): boolean {
    return json as boolean;
  }
}

export class PgBoolDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_BOOL_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_BOOL_CODEC_ID;
  override readonly traits = ['equality', 'boolean'] as const;
  override readonly targetTypes = ['bool'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgBoolCodec {
    return () => new PgBoolCodec(this);
  }
}

export const pgBoolDescriptor = new PgBoolDescriptor();

export const pgBoolColumn = () =>
  column(pgBoolDescriptor.factory(), pgBoolDescriptor.codecId, undefined, 'bool');

pgBoolColumn satisfies ColumnHelperFor<PgBoolDescriptor>;
pgBoolColumn satisfies ColumnHelperForStrict<PgBoolDescriptor>;

export class PgNumericCodec extends CodecImpl<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string | number, _ctx: CodecCallContext): Promise<string> {
    return pgNumericDecode(wire);
  }
  encodeJson(value: string): JsonValue {
    if (!isCanonicalNumericText(value)) {
      throw postgresError(
        'RUNTIME.ENCODE_FAILED',
        'pg/numeric@1 application value must be canonical numeric text: an optionally negated decimal numeral, or NaN, Infinity or -Infinity',
        { meta: { codecId: PG_NUMERIC_CODEC_ID, received: value } },
      );
    }
    return value;
  }
  decodeJson(json: JsonValue): string {
    if (typeof json !== 'string') {
      throw postgresError(
        'RUNTIME.DECODE_FAILED',
        'pg/numeric@1 database JSON value must be a decimal string',
        { meta: { codecId: PG_NUMERIC_CODEC_ID, received: typeof json } },
      );
    }
    return json;
  }
}

export class PgNumericDescriptor extends PostgresCodecDescriptor<NumericParams> {
  protected override nativeType(): string {
    return PG_NUMERIC_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly codecId = PG_NUMERIC_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['numeric', 'decimal'] as const;
  override readonly paramsSchema = numericParamsSchema satisfies StandardSchemaV1<NumericParams>;
  override renderOutputType(params: NumericParams): string | undefined {
    return pgNumericRenderOutputType(params);
  }
  override factory(_params: NumericParams): (ctx: CodecInstanceContext) => PgNumericCodec {
    return () => new PgNumericCodec(this);
  }
}

export const pgNumericDescriptor = new PgNumericDescriptor();

export const pgNumericColumn = (params: NumericParams = {}) =>
  column(pgNumericDescriptor.factory(params), pgNumericDescriptor.codecId, params, 'numeric');

pgNumericColumn satisfies ColumnHelperFor<PgNumericDescriptor>;
pgNumericColumn satisfies ColumnHelperForStrict<PgNumericDescriptor>;

/**
 * A genuinely unbounded integer over unconstrained Postgres `numeric` storage.
 * Application values are `bigint` and the canonical JSON is decimal text, like
 * `pg/int8@1`; decode rejects non-integral values. The descriptor claims no
 * target type, so `numeric` and `decimal` in type position stay `pg/numeric@1`.
 */
export class PgUnboundedIntCodec extends CodecImpl<
  typeof PG_UNBOUNDED_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number | bigint,
  bigint
> {
  async encode(value: bigint, _ctx: CodecCallContext): Promise<string> {
    return pgBigintEncode(PG_UNBOUNDED_INT_CODEC_ID, value);
  }
  async decode(wire: string | number | bigint, _ctx: CodecCallContext): Promise<bigint> {
    return pgUnboundedIntDecode(wire);
  }
  encodeJson(value: bigint): JsonValue {
    return pgBigintEncodeJson(PG_UNBOUNDED_INT_CODEC_ID, value);
  }
  decodeJson(json: JsonValue): bigint {
    if (typeof json !== 'string') {
      throw postgresError(
        'RUNTIME.DECODE_FAILED',
        'pg/unboundedint@1 database JSON value must be a decimal string',
        { meta: { codecId: PG_UNBOUNDED_INT_CODEC_ID, received: typeof json } },
      );
    }
    return pgUnboundedIntDecode(json);
  }
}

export class PgUnboundedIntDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_NUMERIC_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly codecId = PG_UNBOUNDED_INT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextBigintLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgUnboundedIntCodec {
    return () => new PgUnboundedIntCodec(this);
  }
}

export const pgUnboundedIntDescriptor = new PgUnboundedIntDescriptor();

export const pgUnboundedIntColumn = () =>
  column(
    pgUnboundedIntDescriptor.factory(),
    pgUnboundedIntDescriptor.codecId,
    undefined,
    'numeric',
  );

pgUnboundedIntColumn satisfies ColumnHelperFor<PgUnboundedIntDescriptor>;
pgUnboundedIntColumn satisfies ColumnHelperForStrict<PgUnboundedIntDescriptor>;

/**
 * A Postgres `date` has no time-of-day or timezone component. This codec
 * canonicalizes its JS-level value as a `Date` at UTC midnight, so its
 * round-trip is independent of the process's local timezone — see
 * `pgDateEncode`/`pgDateDecode` in `codec-helpers.ts`.
 */
export class PgDateCodec extends CodecImpl<
  typeof PG_DATE_CODEC_ID,
  readonly ['equality', 'order'],
  Date | string,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
    return pgDateEncode(value);
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return pgDateDecode(wire);
  }
  encodeJson(value: Date): JsonValue {
    return pgDateEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return pgDateDecodeJson(json);
  }
}

export class PgDateDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_DATE_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['date'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgDateCodec {
    return () => new PgDateCodec(this);
  }
}

export const pgDateDescriptor = new PgDateDescriptor();

export const pgDateColumn = () =>
  column(pgDateDescriptor.factory(), pgDateDescriptor.codecId, undefined, 'date');

pgDateColumn satisfies ColumnHelperFor<PgDateDescriptor>;
pgDateColumn satisfies ColumnHelperForStrict<PgDateDescriptor>;

export class PgTimestampCodec extends CodecImpl<
  typeof PG_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<Date> {
    return value;
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return wire;
  }
  encodeJson(value: Date): JsonValue {
    return pgTimestampEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return pgTimestampDecodeJson(json);
  }
}

export class PgTimestampDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMP_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_TIMESTAMP_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamp'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timestamp', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestampCodec {
    return () => new PgTimestampCodec(this);
  }
}

export const pgTimestampDescriptor = new PgTimestampDescriptor();

export const pgTimestampColumn = (params: PrecisionParams = {}) =>
  column(pgTimestampDescriptor.factory(params), pgTimestampDescriptor.codecId, params, 'timestamp');

pgTimestampColumn satisfies ColumnHelperFor<PgTimestampDescriptor>;
pgTimestampColumn satisfies ColumnHelperForStrict<PgTimestampDescriptor>;

export class PgTimestamptzCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
> {
  async encode(value: Date, _ctx: CodecCallContext): Promise<Date> {
    return value;
  }
  async decode(wire: Date, _ctx: CodecCallContext): Promise<Date> {
    return wire;
  }
  encodeJson(value: Date): JsonValue {
    return pgTimestamptzEncodeJson(value);
  }
  decodeJson(json: JsonValue): Date {
    return pgTimestamptzDecodeJson(json);
  }
}

export class PgTimestamptzDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMPTZ_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamptz'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timestamptz', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimestamptzCodec {
    return () => new PgTimestamptzCodec(this);
  }
}

export const pgTimestamptzDescriptor = new PgTimestamptzDescriptor();

export const pgTimestamptzColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzDescriptor.factory(params),
    pgTimestamptzDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzColumn satisfies ColumnHelperFor<PgTimestamptzDescriptor>;
pgTimestamptzColumn satisfies ColumnHelperForStrict<PgTimestamptzDescriptor>;

export class PgTimeCodec extends CodecImpl<
  typeof PG_TIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTimeDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIME_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_TIME_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['time'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Time', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeCodec {
    return () => new PgTimeCodec(this);
  }
}

export const pgTimeDescriptor = new PgTimeDescriptor();

export const pgTimeColumn = (params: PrecisionParams = {}) =>
  column(pgTimeDescriptor.factory(params), pgTimeDescriptor.codecId, params, 'time');

pgTimeColumn satisfies ColumnHelperFor<PgTimeDescriptor>;
pgTimeColumn satisfies ColumnHelperForStrict<PgTimeDescriptor>;

export class PgTimetzCodec extends CodecImpl<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgTimetzDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMETZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_TIMETZ_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timetz'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Timetz', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimetzCodec {
    return () => new PgTimetzCodec(this);
  }
}

export const pgTimetzDescriptor = new PgTimetzDescriptor();

export const pgTimetzColumn = (params: PrecisionParams = {}) =>
  column(pgTimetzDescriptor.factory(params), pgTimetzDescriptor.codecId, params, 'timetz');

pgTimetzColumn satisfies ColumnHelperFor<PgTimetzDescriptor>;
pgTimetzColumn satisfies ColumnHelperForStrict<PgTimetzDescriptor>;

/**
 * Representation-explicit temporal codecs whose application value is PostgreSQL's own text.
 *
 * Every direction is identity: a value is bound exactly as the application supplied it, and the
 * server's rendering is returned exactly as it arrived. PostgreSQL alone decides which inputs are
 * valid and how an accepted value is normalised, so these codecs neither validate, normalise, nor
 * canonicalise. That is what makes them the lossless escape hatch for values with no counterpart in
 * a richer temporal representation — `infinity`, BC and expanded-year dates, microsecond precision —
 * and what makes session settings such as `DateStyle` and `TimeZone` observable rather than hidden.
 *
 * `targetTypes` is empty on all four: introspection ownership of `date` / `timestamp` /
 * `timestamptz` / `time` belongs to the codecs that carry the richer representation, and these are
 * selected explicitly by the schema author instead.
 */
export class PgDateStringCodec extends CodecImpl<
  typeof PG_DATE_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'date-string columns serialize to JSON as their wire string form'>(
      json,
    );
  }
}

/**
 * Alone among the four, this descriptor carries no `renderOutputType`, so a `date` column reads as
 * plain `string` rather than a branded `DateString`. Two reasons, both structural: the emitter only
 * consults `renderOutputType` for a column with non-empty type params, and a `date` has no
 * precision to carry — so a renderer here would never be called. Branding the codec's own type
 * instead would reach the declaration, but it would also make the *write* side branded, and a
 * plain string literal is no longer assignable to it. The asymmetry is the honest shape; please
 * don't tidy it away.
 */
export class PgDateStringDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_DATE_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgDateStringCodec {
    return () => new PgDateStringCodec(this);
  }
}

export const pgDateStringDescriptor = new PgDateStringDescriptor();

export const pgDateStringColumn = () =>
  column(pgDateStringDescriptor.factory(), pgDateStringDescriptor.codecId, undefined, 'date');

pgDateStringColumn satisfies ColumnHelperFor<PgDateStringDescriptor>;
pgDateStringColumn satisfies ColumnHelperForStrict<PgDateStringDescriptor>;

export class PgTimestampStringCodec extends CodecImpl<
  typeof PG_TIMESTAMP_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<
      string,
      'timestamp-string columns serialize to JSON as their wire string form'
    >(json);
  }
}

export class PgTimestampStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMP_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMP_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestampString', params);
  }
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampStringCodec {
    return () => new PgTimestampStringCodec(this);
  }
}

export const pgTimestampStringDescriptor = new PgTimestampStringDescriptor();

export const pgTimestampStringColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampStringDescriptor.factory(params),
    pgTimestampStringDescriptor.codecId,
    params,
    'timestamp',
  );

pgTimestampStringColumn satisfies ColumnHelperFor<PgTimestampStringDescriptor>;
pgTimestampStringColumn satisfies ColumnHelperForStrict<PgTimestampStringDescriptor>;

export class PgTimestamptzStringCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<
      string,
      'timestamptz-string columns serialize to JSON as their wire string form'
    >(json);
  }
}

export class PgTimestamptzStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMPTZ_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimestamptzString', params);
  }
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzStringCodec {
    return () => new PgTimestamptzStringCodec(this);
  }
}

export const pgTimestamptzStringDescriptor = new PgTimestamptzStringDescriptor();

export const pgTimestamptzStringColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzStringDescriptor.factory(params),
    pgTimestamptzStringDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzStringColumn satisfies ColumnHelperFor<PgTimestamptzStringDescriptor>;
pgTimestamptzStringColumn satisfies ColumnHelperForStrict<PgTimestamptzStringDescriptor>;

export class PgTimeStringCodec extends CodecImpl<
  typeof PG_TIME_STRING_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'time-string columns serialize to JSON as their wire string form'>(
      json,
    );
  }
}

export class PgTimeStringDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIME_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIME_STRING_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('TimeString', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeStringCodec {
    return () => new PgTimeStringCodec(this);
  }
}

export const pgTimeStringDescriptor = new PgTimeStringDescriptor();

export const pgTimeStringColumn = (params: PrecisionParams = {}) =>
  column(pgTimeStringDescriptor.factory(params), pgTimeStringDescriptor.codecId, params, 'time');

pgTimeStringColumn satisfies ColumnHelperFor<PgTimeStringDescriptor>;
pgTimeStringColumn satisfies ColumnHelperForStrict<PgTimeStringDescriptor>;

/**
 * Temporal-backed temporal codecs: the application value is the `Temporal.*` type that matches the
 * column's native type, and the wire value is PostgreSQL's own text in both directions.
 *
 * `Temporal.*.from()` is the authoritative parser and the authoritative range check — these codecs
 * add only PostgreSQL's `infinity` sentinels and the named era adaptation for BC and expanded
 * years. Anything Temporal declines is reported as unrepresentable, naming the `*String` type that
 * reads the same column losslessly.
 *
 * The application type reaches the generated declaration through `TInput` rather than
 * `renderOutputType`: the emitter only consults a renderer for a column carrying non-empty type
 * params, so a bare `Timestamp` would fall through it. `Temporal` is referenced as an ambient
 * global and no polyfill type is imported, which is why these carry no `typeImports` entry.
 */
export class PgDateTemporalCodec extends CodecImpl<
  typeof PG_DATE_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDate
> {
  async encode(value: Temporal.PlainDate, _ctx: CodecCallContext): Promise<string> {
    return pgDateTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDate> {
    return pgDateTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainDate): JsonValue {
    return pgDateTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainDate {
    return pgDateTemporalDecode(
      blindCast<string, 'date-temporal columns serialize to JSON as their wire string form'>(json),
    );
  }
}

export class PgDateTemporalDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_DATE_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_DATE_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['date'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgDateTemporalCodec {
    return () => new PgDateTemporalCodec(this);
  }
}

export const pgDateTemporalDescriptor = new PgDateTemporalDescriptor();

export const pgDateTemporalColumn = () =>
  column(pgDateTemporalDescriptor.factory(), pgDateTemporalDescriptor.codecId, undefined, 'date');

pgDateTemporalColumn satisfies ColumnHelperFor<PgDateTemporalDescriptor>;
pgDateTemporalColumn satisfies ColumnHelperForStrict<PgDateTemporalDescriptor>;

export class PgTimestampTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainDateTime
> {
  async encode(value: Temporal.PlainDateTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimestampTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainDateTime> {
    return pgTimestampTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainDateTime): JsonValue {
    return pgTimestampTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainDateTime {
    return pgTimestampTemporalDecode(
      blindCast<string, 'timestamp-temporal columns serialize to JSON as their wire string form'>(
        json,
      ),
    );
  }
}

export class PgTimestampTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMP_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMP_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamp'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestampTemporalCodec {
    return () => new PgTimestampTemporalCodec(this);
  }
}

export const pgTimestampTemporalDescriptor = new PgTimestampTemporalDescriptor();

export const pgTimestampTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestampTemporalDescriptor.factory(params),
    pgTimestampTemporalDescriptor.codecId,
    params,
    'timestamp',
  );

pgTimestampTemporalColumn satisfies ColumnHelperFor<PgTimestampTemporalDescriptor>;
pgTimestampTemporalColumn satisfies ColumnHelperForStrict<PgTimestampTemporalDescriptor>;

export class PgTimestamptzTemporalCodec extends CodecImpl<
  typeof PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.Instant
> {
  async encode(value: Temporal.Instant, _ctx: CodecCallContext): Promise<string> {
    return pgTimestamptzTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.Instant> {
    return pgTimestamptzTemporalDecode(wire);
  }
  encodeJson(value: Temporal.Instant): JsonValue {
    return pgTimestamptzTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.Instant {
    return pgTimestamptzTemporalDecode(
      blindCast<string, 'timestamptz-temporal columns serialize to JSON as their wire string form'>(
        json,
      ),
    );
  }
}

export class PgTimestamptzTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIMESTAMPTZ_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['timestamptz'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(
    _params: PrecisionParams,
  ): (ctx: CodecInstanceContext) => PgTimestamptzTemporalCodec {
    return () => new PgTimestamptzTemporalCodec(this);
  }
}

export const pgTimestamptzTemporalDescriptor = new PgTimestamptzTemporalDescriptor();

export const pgTimestamptzTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimestamptzTemporalDescriptor.factory(params),
    pgTimestamptzTemporalDescriptor.codecId,
    params,
    'timestamptz',
  );

pgTimestamptzTemporalColumn satisfies ColumnHelperFor<PgTimestamptzTemporalDescriptor>;
pgTimestamptzTemporalColumn satisfies ColumnHelperForStrict<PgTimestamptzTemporalDescriptor>;

export class PgTimeTemporalCodec extends CodecImpl<
  typeof PG_TIME_TEMPORAL_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Temporal.PlainTime
> {
  async encode(value: Temporal.PlainTime, _ctx: CodecCallContext): Promise<string> {
    return pgTimeTemporalEncode(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Temporal.PlainTime> {
    return pgTimeTemporalDecode(wire);
  }
  encodeJson(value: Temporal.PlainTime): JsonValue {
    return pgTimeTemporalEncode(value);
  }
  decodeJson(json: JsonValue): Temporal.PlainTime {
    return pgTimeTemporalDecode(
      blindCast<string, 'time-temporal columns serialize to JSON as their wire string form'>(json),
    );
  }
}

export class PgTimeTemporalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_TIME_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return serverTextJsonProjection(expression);
  }
  override readonly codecId = PG_TIME_TEMPORAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['time'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimeTemporalCodec {
    return () => new PgTimeTemporalCodec(this);
  }
}

export const pgTimeTemporalDescriptor = new PgTimeTemporalDescriptor();

export const pgTimeTemporalColumn = (params: PrecisionParams = {}) =>
  column(
    pgTimeTemporalDescriptor.factory(params),
    pgTimeTemporalDescriptor.codecId,
    params,
    'time',
  );

pgTimeTemporalColumn satisfies ColumnHelperFor<PgTimeTemporalDescriptor>;
pgTimeTemporalColumn satisfies ColumnHelperForStrict<PgTimeTemporalDescriptor>;

export class PgBitCodec extends CodecImpl<
  typeof PG_BIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgBitDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override nativeType(): string {
    return PG_BIT_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_BIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['bit'] as const;
  override readonly paramsSchema = lengthParamsSchema satisfies StandardSchemaV1<LengthParams>;
  override renderOutputType(params: LengthParams): string | undefined {
    return renderLength('Bit', params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => PgBitCodec {
    return () => new PgBitCodec(this);
  }
}

export const pgBitDescriptor = new PgBitDescriptor();

export const pgBitColumn = (params: LengthParams = {}) =>
  column(pgBitDescriptor.factory(params), pgBitDescriptor.codecId, params, 'bit');

pgBitColumn satisfies ColumnHelperFor<PgBitDescriptor>;
pgBitColumn satisfies ColumnHelperForStrict<PgBitDescriptor>;

export class PgVarbitCodec extends CodecImpl<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return json as string;
  }
}

export class PgVarbitDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override nativeType(): string {
    return PG_VARBIT_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_VARBIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['bit varying'] as const;
  override readonly paramsSchema = lengthParamsSchema satisfies StandardSchemaV1<LengthParams>;
  override renderOutputType(params: LengthParams): string | undefined {
    return renderLength('VarBit', params);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => PgVarbitCodec {
    return () => new PgVarbitCodec(this);
  }
}

export const pgVarbitDescriptor = new PgVarbitDescriptor();

export const pgVarbitColumn = (params: LengthParams = {}) =>
  column(pgVarbitDescriptor.factory(params), pgVarbitDescriptor.codecId, params, 'bit varying');

pgVarbitColumn satisfies ColumnHelperFor<PgVarbitDescriptor>;
pgVarbitColumn satisfies ColumnHelperForStrict<PgVarbitDescriptor>;

export class PgByteaCodec extends CodecImpl<
  typeof PG_BYTEA_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
> {
  async encode(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  async decode(wire: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    // Postgres node drivers commonly return Buffer instances (which extend Uint8Array) — normalize to a plain Uint8Array view so engine-agnostic consumers don't accidentally observe Buffer-specific APIs.
    return wire instanceof Uint8Array && wire.constructor === Uint8Array
      ? wire
      : new Uint8Array(wire.buffer, wire.byteOffset, wire.byteLength);
  }
  encodeJson(value: Uint8Array): JsonValue {
    return pgByteaEncodeJson(value);
  }
  decodeJson(json: JsonValue): Uint8Array {
    return pgByteaDecodeJson(json);
  }
}

export class PgByteaDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_BYTEA_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return base64JsonProjection(expression);
  }
  override readonly codecId = PG_BYTEA_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['bytea'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgByteaCodec {
    return () => new PgByteaCodec(this);
  }
}

export const pgByteaDescriptor = new PgByteaDescriptor();

export const pgByteaColumn = () =>
  column(pgByteaDescriptor.factory(), pgByteaDescriptor.codecId, undefined, 'bytea');

pgByteaColumn satisfies ColumnHelperFor<PgByteaDescriptor>;
pgByteaColumn satisfies ColumnHelperForStrict<PgByteaDescriptor>;

const PG_UUID_NATIVE_TYPE = 'uuid';

export class PgUuidCodec extends CodecImpl<
  typeof PG_UUID_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'uuid columns serialize to JSON as their wire string form'>(json);
  }
}

export class PgUuidDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_UUID_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_UUID_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['uuid'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgUuidCodec {
    return () => new PgUuidCodec(this);
  }
}

export const pgUuidDescriptor = new PgUuidDescriptor();

export const pgUuidColumn = () =>
  column(pgUuidDescriptor.factory(), pgUuidDescriptor.codecId, undefined, 'uuid');

pgUuidColumn satisfies ColumnHelperFor<PgUuidDescriptor>;
pgUuidColumn satisfies ColumnHelperForStrict<PgUuidDescriptor>;

const PG_INET_NATIVE_TYPE = 'inet';

export class PgInetCodec extends CodecImpl<
  typeof PG_INET_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return blindCast<string, 'inet columns serialize to JSON as their wire string form'>(json);
  }
}

export class PgInetDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INET_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_INET_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['inet'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgInetCodec {
    return () => new PgInetCodec(this);
  }
}

export const pgInetDescriptor = new PgInetDescriptor();

export const pgInetColumn = () =>
  column(pgInetDescriptor.factory(), pgInetDescriptor.codecId, undefined, 'inet');

pgInetColumn satisfies ColumnHelperFor<PgInetDescriptor>;
pgInetColumn satisfies ColumnHelperForStrict<PgInetDescriptor>;

/**
 * An application value is a {@link PgInterval} — the three fields PostgreSQL
 * actually stores, `{ months, days, micros }` — and its canonical JSON is the
 * ISO-8601 duration string PostgreSQL spells under
 * `IntervalStyle = 'iso_8601'`: `P1M`, `P30D`, `P1Y2M3DT4H5M6S`, `PT0S` for
 * zero, each component carrying its own sign.
 *
 * Value and representation are independent here, as they are for `pg/bytea@1`
 * (`Uint8Array` carried as base64) and `pg/int8@1` (`bigint` carried as decimal
 * text). Reading an interval hands back numbers to compute with rather than a
 * string to parse; writing one takes the same numbers.
 *
 * The fields stay independent because a month has no fixed length: `{months: 1}`
 * and `{days: 30}` are different values and neither converts to the other. The
 * ISO rendering normalises only in its own spelling — twelve months render as a
 * year — so `{months: 13}` renders `P1Y1M` and reads back as `{months: 13}`.
 */
export class PgIntervalCodec extends CodecImpl<
  typeof PG_INTERVAL_CODEC_ID,
  readonly ['equality', 'order'],
  string | Record<string, unknown>,
  PgInterval
> {
  async encode(value: PgInterval, _ctx: CodecCallContext): Promise<string> {
    // PostgreSQL accepts an ISO-8601 duration as interval input, so the
    // canonical rendering doubles as the wire form.
    return pgIntervalToIso(value);
  }
  async decode(
    wire: string | Record<string, unknown>,
    _ctx: CodecCallContext,
  ): Promise<PgInterval> {
    return pgIntervalDecode(wire);
  }
  encodeJson(value: PgInterval): JsonValue {
    return pgIntervalEncodeJson(value);
  }
  decodeJson(json: JsonValue): PgInterval {
    return pgIntervalDecodeJson(json);
  }
}

export class PgIntervalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  protected override nativeType(): string {
    return PG_INTERVAL_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return isoDurationJsonProjection(expression);
  }
  override readonly codecId = PG_INTERVAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['interval'] as const;
  override readonly paramsSchema =
    precisionParamsSchema satisfies StandardSchemaV1<PrecisionParams>;
  override renderOutputType(params: PrecisionParams): string | undefined {
    return renderPrecision('Interval', params);
  }
  override factory(_params: PrecisionParams): (ctx: CodecInstanceContext) => PgIntervalCodec {
    return () => new PgIntervalCodec(this);
  }
}

export const pgIntervalDescriptor = new PgIntervalDescriptor();

export const pgIntervalColumn = (params: PrecisionParams = {}) =>
  column(pgIntervalDescriptor.factory(params), pgIntervalDescriptor.codecId, params, 'interval');

pgIntervalColumn satisfies ColumnHelperFor<PgIntervalDescriptor>;
pgIntervalColumn satisfies ColumnHelperForStrict<PgIntervalDescriptor>;

export class PgJsonCodec extends CodecImpl<
  typeof PG_JSON_CODEC_ID,
  readonly [],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonEncode(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonDecode(wire);
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class PgJsonDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_JSON_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_JSON_CODEC_ID;
  override readonly traits = [] as const;
  override readonly targetTypes = ['json'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgJsonCodec {
    return () => new PgJsonCodec(this);
  }
}

export const pgJsonDescriptor = new PgJsonDescriptor();

export const pgJsonColumn = () =>
  column(pgJsonDescriptor.factory(), pgJsonDescriptor.codecId, undefined, 'json');

pgJsonColumn satisfies ColumnHelperFor<PgJsonDescriptor>;
pgJsonColumn satisfies ColumnHelperForStrict<PgJsonDescriptor>;

export class PgJsonbCodec extends CodecImpl<
  typeof PG_JSONB_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonbEncode(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonbDecode(wire);
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class PgJsonbDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_JSONB_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_JSONB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['jsonb'] as const;
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgJsonbCodec {
    return () => new PgJsonbCodec(this);
  }
}

export const pgJsonbDescriptor = new PgJsonbDescriptor();

export const pgJsonbColumn = () =>
  column(pgJsonbDescriptor.factory(), pgJsonbDescriptor.codecId, undefined, 'jsonb');

pgJsonbColumn satisfies ColumnHelperFor<PgJsonbDescriptor>;
pgJsonbColumn satisfies ColumnHelperForStrict<PgJsonbDescriptor>;

// --- pg aliases for the SQL base codecs ------------------------------------
// These descriptors give a SQL-base codec a PostgreSQL identity: its own codec
// id and native type. The factories instantiate the SQL-base codec class
// (`SqlCharCodec` etc.) passing `this` (the pg-alias descriptor), so `codec.id`
// resolves to the pg-alias codec id via `CodecImpl`'s `descriptor.codecId`
// proxy.

const PG_CHAR_NATIVE_TYPE = 'character';
const PG_VARCHAR_NATIVE_TYPE = 'character varying';
const PG_INT_NATIVE_TYPE = 'integer';
const PG_FLOAT_NATIVE_TYPE = 'double precision';

export class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override nativeType(): string {
    return PG_CHAR_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_CHAR_CODEC_ID;
  override readonly targetTypes = ['character'] as const;
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = sqlCharDescriptor.paramsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharDescriptor.renderOutputType(params);
  }
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}

export const pgCharDescriptor = new PgCharDescriptor();

export const pgCharColumn = (params: LengthParams = {}) =>
  column(pgCharDescriptor.factory(params), pgCharDescriptor.codecId, params, 'character');

pgCharColumn satisfies ColumnHelperFor<PgCharDescriptor>;

export class PgVarcharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override nativeType(): string {
    return PG_VARCHAR_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_VARCHAR_CODEC_ID;
  override readonly targetTypes = ['character varying'] as const;
  override readonly traits = sqlVarcharDescriptor.traits;
  override readonly paramsSchema = sqlVarcharDescriptor.paramsSchema;
  override renderOutputType(params: LengthParams): string | undefined {
    return sqlVarcharDescriptor.renderOutputType(params);
  }
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => new SqlVarcharCodec(this);
  }
}

export const pgVarcharDescriptor = new PgVarcharDescriptor();

export const pgVarcharColumn = (params: LengthParams = {}) =>
  column(
    pgVarcharDescriptor.factory(params),
    pgVarcharDescriptor.codecId,
    params,
    'character varying',
  );

pgVarcharColumn satisfies ColumnHelperFor<PgVarcharDescriptor>;

export class PgIntDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_INT_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_INT_CODEC_ID;
  override readonly targetTypes = ['int4'] as const;
  override readonly traits = sqlIntDescriptor.traits;
  override readonly paramsSchema = sqlIntDescriptor.paramsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqlIntCodec {
    return () => new SqlIntCodec(this);
  }
}

export const pgIntDescriptor = new PgIntDescriptor();

export const pgIntColumn = () =>
  column(pgIntDescriptor.factory(), pgIntDescriptor.codecId, undefined, 'int4');

pgIntColumn satisfies ColumnHelperFor<PgIntDescriptor>;

export class PgFloatDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return PG_FLOAT_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = PG_FLOAT_CODEC_ID;
  override readonly targetTypes = ['float8'] as const;
  override readonly traits = sqlFloatDescriptor.traits;
  override readonly paramsSchema = sqlFloatDescriptor.paramsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqlFloatCodec {
    return () => new SqlFloatCodec(this);
  }
}

export const pgFloatDescriptor = new PgFloatDescriptor();

export const pgFloatColumn = () =>
  column(pgFloatDescriptor.factory(), pgFloatDescriptor.codecId, undefined, 'float8');

pgFloatColumn satisfies ColumnHelperFor<PgFloatDescriptor>;

// `ExtractCodecTypes` to derive `CodecTypes`. ---------------------------------------------------------------------------

export const codecDescriptors = definePostgresCodecs([
  postgresSqlCharDescriptor,
  postgresSqlVarcharDescriptor,
  postgresSqlIntDescriptor,
  postgresSqlFloatDescriptor,
  postgresSqlTextDescriptor,
  postgresSqlTimestampDescriptor,
  pgTextDescriptor,
  pgEnumDescriptor,
  pgCharDescriptor,
  pgVarcharDescriptor,
  pgIntDescriptor,
  pgFloatDescriptor,
  pgInt4Descriptor,
  pgInt2Descriptor,
  pgInt8Descriptor,
  pgInt8NumberDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgNumericDescriptor,
  pgUnboundedIntDescriptor,
  // PSL `Date` pins this codec by ID rather than activating a second target-type mapping.
  pgDateDescriptor,
  pgTimestampDescriptor,
  pgTimestamptzDescriptor,
  pgTimeDescriptor,
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
  pgDateStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
  pgTimeStringDescriptor,
  pgTimetzDescriptor,
  pgBoolDescriptor,
  pgBitDescriptor,
  pgVarbitDescriptor,
  pgByteaDescriptor,
  pgUuidDescriptor,
  pgInetDescriptor,
  pgIntervalDescriptor,
  pgJsonDescriptor,
  pgJsonbDescriptor,
  pgTextArrayDescriptor,
]);
