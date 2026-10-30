/**
 * Native Postgres target codecs (TML-2357). Mirrors the SQL base codec form in `packages/2-sql-family/4-lanes/relational-core/src/ast/sql-codecs.ts`.
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `PgXCodec` class extending {@link CodecImpl} that wraps the module-level conversions exported from `codec-helpers.ts` (the single source of truth for non-trivial runtime conversions; trivial identity passthroughs are inlined). 2. A `PgXDescriptor` class extending {@link PostgresCodecDescriptor} declaring the codec id, traits, target types, params schema, native type, and canonical JSON projection. A column type that depends on type parameters, such as `Char<36>`, comes from the pack's type function in `exports/codec-types.ts`. 3. A per-codec column helper (`pgXColumn`) that calls `descriptor.factory(...)` directly and packages the result into a framework `ColumnSpec` via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor` (and `ColumnHelperForStrict` where the resolved codec type is well-defined).
 *
 * After TML-2357 this is the canonical source of Postgres codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers (and the parallel `byScalar`/`codecDescriptorDefinitions`/ `codecDescriptorList` collection exports) retired with the deletion sweep.
 *
 * A parameterized codec is built with its column's parameters of its data type, and the data type, not the codec, refuses a value those parameters exclude (ADR 254).
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  decimalTextBigintLiteral,
  decimalTextNumberLiteral,
  floatNumberLiteral,
  floatToJson,
  isNonFiniteText,
  readJsonFloat,
  readJsonIntegerText,
  renderTsLiteral,
  storedNumeralText,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlRawDataType } from '@internal/sql-contract/data-type';
import {
  CaseExpr,
  CastExpr,
  FunctionCallExpr,
  LiteralExpr,
  NullCheckExpr,
  type ProjectionExpr,
  SqlCharCodec,
  SqlFloatCodec,
  SqlIntCodec,
  SqlRawCodec,
  SqlTextCodec,
  SqlVarcharCodec,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlRawDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { definePostgresCodecs, PostgresCodecDescriptor, postgresCodec } from './codec-descriptor';
import {
  type PrecisionParams,
  pgBigintDigits,
  pgBigintEncode,
  pgByteaDecodeWire,
  pgByteaFromBase64,
  pgByteaToBase64,
  pgFloatEncode,
  pgInt8Decode,
  pgInt8NumberDecode,
  pgInt8NumberEncode,
  pgInt8NumberFromDigits,
  pgIntervalDecode,
  pgIntervalFromIso,
  pgIntervalToIso,
  pgJsonbDecode,
  pgJsonbEncode,
  pgJsonDecode,
  pgJsonEncode,
  pgNumericDecode,
  pgUnboundedIntDecode,
} from './codec-helpers';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
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
  PG_MONEY_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_OID_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_TSQUERY_CODEC_ID,
  PG_UNBOUNDED_INT_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  PG_XML_CODEC_ID,
} from './codec-ids';
import type { PgInterval } from './data-type-values';
import {
  isPgOid,
  pgBit,
  pgBitLengthParams,
  pgBool,
  pgBytea,
  pgChar,
  pgCharacterLengthParams,
  pgEnum,
  pgEnumParams,
  pgFloat4,
  pgFloat8,
  pgInet,
  pgInt2,
  pgInt4,
  pgInt8,
  pgInterval,
  pgJson,
  pgJsonb,
  pgJsonbEnumRefusal,
  pgMoney,
  pgMoneyStoredText,
  pgNumeric,
  pgNumericParams,
  pgOid,
  pgPrecisionParams,
  pgText,
  pgTextArray,
  pgTimetz,
  pgTsquery,
  pgUuid,
  pgVarbit,
  pgVarchar,
  pgXml,
} from './data-types';
import { pgTimestampDateDescriptor, pgTimestamptzDateDescriptor } from './date-codecs';
import { type DateTimeWireReading, storedTextFromWire } from './date-time-wire-text';
import { errorLcMonetaryNotC, postgresError } from './errors';
import { pgIntervalStringDescriptor } from './interval-string-codec';
import { parsePostgresListText } from './list-decoder';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';
import { PostgresNativeEnum } from './postgres-native-enum';
import {
  pgDateTemporalDescriptor,
  pgTimestampInstantDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
} from './temporal-codecs';
import {
  pgDateStringDescriptor,
  pgTimeStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from './temporal-string-codecs';

type LengthParams = { readonly length?: number };
type NumericParams = { readonly precision?: number; readonly scale?: number };

/** A decimal numeral: an optional minus sign, digits, and an optional fraction. */
const DECIMAL_NUMERAL_TEXT = /^-?\d+(?:\.\d+)?$/;

/** A decimal numeral is written as PostgreSQL prints it, without leading zeros or a minus sign on zero; other spellings PostgreSQL reads, such as `1e5`, are refused. */
function numericJson(value: string): string {
  if (typeof value !== 'string' || isNonFiniteText(value)) return value;
  if (DECIMAL_NUMERAL_TEXT.test(value)) return storedNumeralText(value);
  throw postgresError(
    'RUNTIME.ENCODE_FAILED',
    'pg/numeric@1 application value must be numeric text: an optionally negated decimal numeral, or NaN, Infinity or -Infinity',
    { meta: { codecId: PG_NUMERIC_CODEC_ID, received: value } },
  );
}

/**
 * Projects the expression unchanged, for codecs whose canonical JSON is what
 * PostgreSQL's own JSON conversion already produces.
 *
 * Identity here is a claim about the target's behaviour, not an absence of one:
 * the codec's conformance cases are what test it, including at the boundaries
 * of the representation — escaping, sign, and range — where a native conversion
 * would be most likely to diverge.
 */
const identityJsonProjection = (expression: ProjectionExpr): ProjectionExpr => expression;

/**
 * Projects a `character` value as text, which drops the trailing spaces that pad it to its length and nothing else, so an include reads the value a flat read's `decode` returns.
 */
const unpaddedCharJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'text');

const decodePostgresNumberWire = (wire: string | number): number =>
  typeof wire === 'string' ? Number(wire) : wire;

const decodePostgresBooleanWire = (wire: string | boolean): boolean => {
  if (typeof wire === 'boolean') return wire;
  if (wire === 't' || wire === 'true') return true;
  if (wire === 'f' || wire === 'false') return false;
  throw postgresError('RUNTIME.DECODE_FAILED', 'pg/bool@1 wire value must be boolean text', {
    meta: { codecId: PG_BOOL_CODEC_ID, received: wire },
  });
};

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
 * Projects the text PostgreSQL prints for the value, which is the value the runtime driver returns
 * for an ordinary row, so `fromWire` reads an included value as it reads a row (ADR 254, "Rows the
 * database returns as JSON"). PostgreSQL's own JSON conversion would write another value: a `bytea`
 * as its hex text but a `jsonb` document as the document itself, which `fromWire` cannot tell from
 * the document's JSON text when the document is a string.
 */
const printedTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'text');

export const postgresSqlCharDescriptor = postgresCodec(sqlCharDescriptor, {
  dataType: pgChar,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: unpaddedCharJsonProjection,
  factory: (descriptor, dataType, params) => () => new SqlCharCodec(descriptor, dataType, params),
});

export const postgresSqlVarcharDescriptor = postgresCodec(sqlVarcharDescriptor, {
  dataType: pgVarchar,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: identityJsonProjection,
  factory: (descriptor, dataType, params) => () =>
    new SqlVarcharCodec(descriptor, dataType, params),
});

export const postgresSqlIntDescriptor = postgresCodec(sqlIntDescriptor, {
  dataType: pgInt4,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: identityJsonProjection,
  factory: (descriptor, dataType) => () => new PgIntCodec(descriptor, dataType),
});

export const postgresSqlFloatDescriptor = postgresCodec(sqlFloatDescriptor, {
  dataType: pgFloat8,
  renderValueLiteral: floatNumberLiteral,
  jsonProjection: identityJsonProjection,
  factory: (descriptor, dataType) => () => new PgFloatCodec(descriptor, dataType),
});

export const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: identityJsonProjection,
  factory: (descriptor, dataType) => () => new SqlTextCodec(descriptor, dataType),
});

/**
 * Projects a raw value as the text its type's output function prints, which a flat read returns
 * too, so an include reads the same value. Postgres' JSON form of `integer` or `boolean` would be a
 * number or a boolean, and a cast to `text` does not always print the output form: `true::text` is
 * `true` where the output is `t`. `format('%s', …)` prints through the output function, and turns
 * NULL into an empty string, so NULL is kept apart.
 */
const outputFunctionJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CaseExpr.of(
    [{ condition: NullCheckExpr.isNull(expression), value: LiteralExpr.of(null) }],
    FunctionCallExpr.of('format', [LiteralExpr.of('%s'), expression]),
  );

export const postgresSqlRawDescriptor = postgresCodec(sqlRawDescriptor, {
  dataType: sqlRawDataType,
  jsonProjection: outputFunctionJsonProjection,
  factory: (descriptor, dataType, params) => () => new SqlRawCodec(descriptor, dataType, params),
});

export class PgTextCodec extends CodecImpl<
  typeof PG_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgText.id;
  override readonly codecId = PG_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    return () => new PgTextCodec(this, pgText);
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const pgTextColumn = () =>
  column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined);

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
 * column's `codecId` alone, without also inspecting its data type — which
 * the managed (DDL) phase needs to target `CREATE TYPE`/`ALTER TYPE`
 * operations at exactly the columns that use one.
 *
 * Not `textual`, although its values are strings: Postgres has no `LIKE`,
 * `ILIKE` or `to_tsvector` over an enum type.
 */
export class PgEnumCodec extends CodecImpl<
  typeof PG_ENUM_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
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

export class PgEnumDescriptor extends PostgresCodecDescriptor<PgEnumParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgEnum.id;
  override readonly codecId = PG_ENUM_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly enumRefusal =
    'A pg/enum codec types the column of a native enum, whose values the database enforces with an enum type of its own. Declare a native enum instead: native_enum in PSL, or nativeEnum in TypeScript.';
  override readonly paramsSchema = pgEnumParams satisfies StandardSchemaV1<PgEnumParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: PgEnumParams): (ctx: CodecInstanceContext) => PgEnumCodec {
    return () => new PgEnumCodec(this, pgEnum, params);
  }

  /**
   * Authoring-time hook a `pg.enum(<ref>)` type constructor calls once it has
   * resolved its ref argument to the referenced `native_enum` entity:
   * produces this codec's per-column `typeParams` from the entity's bare type
   * name. Schema-qualification (`auth.aal_level` for a
   * named non-default schema) is not this hook's concern — the field's
   * namespace isn't known at this call site for every authoring path (the TS
   * builder resolves a column before it knows its model's namespace), so it is
   * applied later, at contract construction, by {@link qualifyNativeType} via
   * the target's `authoring.qualifyColumnType` hook. Returns `undefined` if `entity` is not a `PostgresNativeEnum` (a
   * contributor bug, not a user-schema error — the caller decides how to
   * report it).
   */
  columnFromEntity(entity: unknown): { readonly typeParams: PgEnumParams } | undefined {
    if (!PostgresNativeEnum.is(entity)) return undefined;
    return { typeParams: { typeName: entity.typeName } };
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
 * {@link PgEnumDescriptor.qualifyNativeType}), which rewrites only
 * `typeParams.typeName`. Every other codec passes through unchanged.
 * Both the PSL `pg.enum(Ref)` path and the TS `pg.enum(handle)` path route
 * through here — the dispatch keys off the codec id, not authoring surface.
 */
export function postgresQualifyColumnType(
  input: {
    readonly codecId: string;
    readonly typeParams?: Record<string, unknown>;
  },
  namespaceId: string,
): { readonly typeParams?: Record<string, unknown> } {
  if (input.codecId !== PG_ENUM_CODEC_ID) return input;
  const bareTypeName = input.typeParams?.['typeName'];
  if (typeof bareTypeName !== 'string') return input;
  const qualified = pgEnumDescriptor.qualifyNativeType(bareTypeName, namespaceId);
  return { typeParams: { ...input.typeParams, typeName: qualified } };
}

/** The elements of the `text[]` text PostgreSQL prints, each a string or NULL. */
function readTextArrayWire(wire: string): readonly (string | null)[] {
  return parsePostgresListText(wire).map((element) => {
    if (element === null || typeof element === 'string') return element;
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      `pg/text-array@1 reads a one-dimensional text[], and ${wire} has more dimensions`,
      { meta: { codecId: PG_TEXT_ARRAY_CODEC_ID, received: wire } },
    );
  });
}

/**
 * Postgres `text[]` control codec. Encode is an identity pass-through: the pg
 * wire driver serialises a JS `string[]` to a Postgres array literal under the
 * `$N::text[]` cast emitted from this codec's native type. Decode reads the
 * array text the driver returns, or an array a driver has already parsed. Not a
 * user-facing scalar — it is not part of the authorable `CodecTypes` surface,
 * only the runtime codec registry.
 */
export class PgTextArrayCodec extends CodecImpl<
  typeof PG_TEXT_ARRAY_CODEC_ID,
  readonly ['equality'],
  string | readonly (string | null)[],
  readonly (string | null)[]
> {
  async toWire(
    value: readonly (string | null)[],
    _ctx: CodecCallContext,
  ): Promise<readonly (string | null)[]> {
    return value;
  }
  async fromWire(
    wire: string | readonly (string | null)[],
    _ctx: CodecCallContext,
  ): Promise<readonly (string | null)[]> {
    return typeof wire === 'string' ? readTextArrayWire(wire) : wire;
  }
  fromDataTypeValue(value: DataTypeValue<readonly (string | null)[]>): readonly (string | null)[] {
    return value.value;
  }
  toDataTypeValue(input: readonly (string | null)[]): DataTypeValue {
    return this.dataTypeValueOf([...input]);
  }
}

export class PgTextArrayDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'array' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return printedTextJsonProjection(expression);
  }
  override readonly dataType = pgTextArray.id;
  override readonly codecId = PG_TEXT_ARRAY_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgTextArrayCodec {
    return () => new PgTextArrayCodec(this, pgTextArray);
  }
}

export const pgTextArrayDescriptor = new PgTextArrayDescriptor();

export class PgInt4Codec extends CodecImpl<
  typeof PG_INT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<number>): number {
    return value.value;
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgInt4.id;
  override readonly codecId = PG_INT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt4Codec {
    return () => new PgInt4Codec(this, pgInt4);
  }
}

export const pgInt4Descriptor = new PgInt4Descriptor();

export const pgInt4Column = () =>
  column(pgInt4Descriptor.factory(), pgInt4Descriptor.codecId, undefined);

pgInt4Column satisfies ColumnHelperFor<PgInt4Descriptor>;
pgInt4Column satisfies ColumnHelperForStrict<PgInt4Descriptor>;

export class PgInt2Codec extends CodecImpl<
  typeof PG_INT2_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<number>): number {
    return value.value;
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgInt2Descriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgInt2.id;
  override readonly codecId = PG_INT2_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt2Codec {
    return () => new PgInt2Codec(this, pgInt2);
  }
}

export const pgInt2Descriptor = new PgInt2Descriptor();

export const pgInt2Column = () =>
  column(pgInt2Descriptor.factory(), pgInt2Descriptor.codecId, undefined);

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
  async toWire(value: bigint, _ctx: CodecCallContext): Promise<string> {
    return pgBigintEncode(PG_INT8_CODEC_ID, value);
  }
  async fromWire(wire: string | number | bigint, _ctx: CodecCallContext): Promise<bigint> {
    return pgInt8Decode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): bigint {
    return BigInt(value.value);
  }
  toDataTypeValue(input: bigint): DataTypeValue {
    return this.dataTypeValueOf(pgBigintDigits(PG_INT8_CODEC_ID, input));
  }
}

export class PgInt8Descriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = pgInt8.id;
  override readonly codecId = PG_INT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextBigintLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt8Codec {
    return () => new PgInt8Codec(this, pgInt8);
  }
}

export const pgInt8Descriptor = new PgInt8Descriptor();

export const pgInt8Column = () =>
  column(pgInt8Descriptor.factory(), pgInt8Descriptor.codecId, undefined);

pgInt8Column satisfies ColumnHelperFor<PgInt8Descriptor>;
pgInt8Column satisfies ColumnHelperForStrict<PgInt8Descriptor>;

/**
 * A Postgres `int8` decoded as a JS `number`, for columns whose values stay
 * within the safe integer range ±(2^53 − 1). Both directions guard rather than
 * round: decode (wire and JSON) and encode throw a structured error on
 * out-of-range or non-integral input. The canonical JSON is the decimal text
 * `pg/int8` carries, which every codec of that data type shares. The descriptor
 * claims no target type, so `int8` in type position stays `pg/int8@1`.
 */
export class PgInt8NumberCodec extends CodecImpl<
  typeof PG_INT8_NUMBER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number | bigint,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<string> {
    return pgInt8NumberEncode(value);
  }
  async fromWire(wire: string | number | bigint, _ctx: CodecCallContext): Promise<number> {
    return pgInt8NumberDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): number {
    return pgInt8NumberFromDigits(value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(pgInt8NumberEncode(input));
  }
}

export class PgInt8NumberDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = pgInt8.id;
  override readonly codecId = PG_INT8_NUMBER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInt8NumberCodec {
    return () => new PgInt8NumberCodec(this, pgInt8);
  }
}

export const pgInt8NumberDescriptor = new PgInt8NumberDescriptor();

export const pgInt8NumberColumn = () =>
  column(pgInt8NumberDescriptor.factory(), pgInt8NumberDescriptor.codecId, undefined);

pgInt8NumberColumn satisfies ColumnHelperFor<PgInt8NumberDescriptor>;
pgInt8NumberColumn satisfies ColumnHelperForStrict<PgInt8NumberDescriptor>;

export class PgFloat4Codec extends CodecImpl<
  typeof PG_FLOAT4_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<string | number> {
    return pgFloatEncode(value);
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): number {
    return readJsonFloat(this.id, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(floatToJson(input));
  }
}

export class PgFloat4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgFloat4.id;
  override readonly codecId = PG_FLOAT4_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return floatNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgFloat4Codec {
    return () => new PgFloat4Codec(this, pgFloat4);
  }
}

export const pgFloat4Descriptor = new PgFloat4Descriptor();

export const pgFloat4Column = () =>
  column(pgFloat4Descriptor.factory(), pgFloat4Descriptor.codecId, undefined);

pgFloat4Column satisfies ColumnHelperFor<PgFloat4Descriptor>;
pgFloat4Column satisfies ColumnHelperForStrict<PgFloat4Descriptor>;

export class PgFloat8Codec extends CodecImpl<
  typeof PG_FLOAT8_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<string | number> {
    return pgFloatEncode(value);
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): number {
    return readJsonFloat(this.id, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(floatToJson(input));
  }
}

export class PgFloat8Descriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgFloat8.id;
  override readonly codecId = PG_FLOAT8_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return floatNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgFloat8Codec {
    return () => new PgFloat8Codec(this, pgFloat8);
  }
}

export const pgFloat8Descriptor = new PgFloat8Descriptor();

export const pgFloat8Column = () =>
  column(pgFloat8Descriptor.factory(), pgFloat8Descriptor.codecId, undefined);

pgFloat8Column satisfies ColumnHelperFor<PgFloat8Descriptor>;
pgFloat8Column satisfies ColumnHelperForStrict<PgFloat8Descriptor>;

export class PgBoolCodec extends CodecImpl<
  typeof PG_BOOL_CODEC_ID,
  readonly ['equality', 'boolean'],
  string | boolean,
  boolean
> {
  async toWire(value: boolean, _ctx: CodecCallContext): Promise<boolean> {
    return value;
  }
  async fromWire(wire: string | boolean, _ctx: CodecCallContext): Promise<boolean> {
    return decodePostgresBooleanWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<boolean>): boolean {
    return value.value;
  }
  toDataTypeValue(input: boolean): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgBoolDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'boolean' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgBool.id;
  override readonly codecId = PG_BOOL_CODEC_ID;
  override readonly traits = ['equality', 'boolean'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgBoolCodec {
    return () => new PgBoolCodec(this, pgBool);
  }
}

export const pgBoolDescriptor = new PgBoolDescriptor();

export const pgBoolColumn = () =>
  column(pgBoolDescriptor.factory(), pgBoolDescriptor.codecId, undefined);

pgBoolColumn satisfies ColumnHelperFor<PgBoolDescriptor>;
pgBoolColumn satisfies ColumnHelperForStrict<PgBoolDescriptor>;

export class PgNumericCodec extends CodecImpl<
  typeof PG_NUMERIC_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  string | number,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<string> {
    return pgNumericDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(numericJson(input));
  }
}

export class PgNumericDescriptor extends PostgresCodecDescriptor<NumericParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = pgNumeric.id;
  override readonly codecId = PG_NUMERIC_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly keepsWrittenForm = true as const;
  override readonly paramsSchema = pgNumericParams satisfies StandardSchemaV1<NumericParams>;
  override factory(params: NumericParams): (ctx: CodecInstanceContext) => PgNumericCodec {
    return () => new PgNumericCodec(this, pgNumeric, params ?? {});
  }
}

export const pgNumericDescriptor = new PgNumericDescriptor();

export const pgNumericColumn = (params: NumericParams = {}) =>
  column(pgNumericDescriptor.factory(params), pgNumericDescriptor.codecId, params);

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
  async toWire(value: bigint, _ctx: CodecCallContext): Promise<string> {
    return pgBigintEncode(PG_UNBOUNDED_INT_CODEC_ID, value);
  }
  async fromWire(wire: string | number | bigint, _ctx: CodecCallContext): Promise<bigint> {
    return pgUnboundedIntDecode(wire);
  }
  /** A `bigint` holds only a whole number, so a value with a fraction, or `NaN` or an infinity, is refused. */
  fromDataTypeValue(value: DataTypeValue<string>): bigint {
    return readJsonIntegerText(this.id, value.value);
  }
  toDataTypeValue(input: bigint): DataTypeValue {
    return this.dataTypeValueOf(pgBigintDigits(PG_UNBOUNDED_INT_CODEC_ID, input));
  }
}

export class PgUnboundedIntDescriptor extends PostgresCodecDescriptor<NumericParams> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = pgNumeric.id;
  override readonly codecId = PG_UNBOUNDED_INT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = pgNumericParams satisfies StandardSchemaV1<NumericParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextBigintLiteral(value);
  }
  override factory(params?: NumericParams): (ctx: CodecInstanceContext) => PgUnboundedIntCodec {
    return () => new PgUnboundedIntCodec(this, pgNumeric, params ?? {});
  }
}

export const pgUnboundedIntDescriptor = new PgUnboundedIntDescriptor();

export const pgUnboundedIntColumn = () =>
  column(pgUnboundedIntDescriptor.factory(), pgUnboundedIntDescriptor.codecId, undefined);

pgUnboundedIntColumn satisfies ColumnHelperFor<PgUnboundedIntDescriptor>;
pgUnboundedIntColumn satisfies ColumnHelperForStrict<PgUnboundedIntDescriptor>;

const TIMETZ_READING: DateTimeWireReading = {
  shape: 'timeWithOffset',
  holdsInfinity: false,
  maxOffsetHours: 15,
};

export class PgTimetzCodec extends CodecImpl<
  typeof PG_TIMETZ_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return storedTextFromWire(this.id, TIMETZ_READING, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.storedDataTypeValueOf(input);
  }
}

export class PgTimetzDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgTimetz.id;
  override readonly codecId = PG_TIMETZ_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgTimetzCodec {
    return () => new PgTimetzCodec(this, pgTimetz, params ?? {});
  }
}

export const pgTimetzDescriptor = new PgTimetzDescriptor();

export const pgTimetzColumn = (params: PrecisionParams = {}) =>
  column(pgTimetzDescriptor.factory(params), pgTimetzDescriptor.codecId, params);

pgTimetzColumn satisfies ColumnHelperFor<PgTimetzDescriptor>;
pgTimetzColumn satisfies ColumnHelperForStrict<PgTimetzDescriptor>;

export class PgBitCodec extends CodecImpl<
  typeof PG_BIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgBitDescriptor extends PostgresCodecDescriptor<LengthParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgBit.id;
  override readonly codecId = PG_BIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgBitLengthParams satisfies StandardSchemaV1<LengthParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: LengthParams): (ctx: CodecInstanceContext) => PgBitCodec {
    return () => new PgBitCodec(this, pgBit, params ?? {});
  }
}

export const pgBitDescriptor = new PgBitDescriptor();

export const pgBitColumn = (params: LengthParams = {}) =>
  column(pgBitDescriptor.factory(params), pgBitDescriptor.codecId, params);

pgBitColumn satisfies ColumnHelperFor<PgBitDescriptor>;
pgBitColumn satisfies ColumnHelperForStrict<PgBitDescriptor>;

export class PgVarbitCodec extends CodecImpl<
  typeof PG_VARBIT_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgVarbitDescriptor extends PostgresCodecDescriptor<LengthParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgVarbit.id;
  override readonly codecId = PG_VARBIT_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = pgBitLengthParams satisfies StandardSchemaV1<LengthParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: LengthParams): (ctx: CodecInstanceContext) => PgVarbitCodec {
    return () => new PgVarbitCodec(this, pgVarbit, params ?? {});
  }
}

export const pgVarbitDescriptor = new PgVarbitDescriptor();

export const pgVarbitColumn = (params: LengthParams = {}) =>
  column(pgVarbitDescriptor.factory(params), pgVarbitDescriptor.codecId, params);

pgVarbitColumn satisfies ColumnHelperFor<PgVarbitDescriptor>;
pgVarbitColumn satisfies ColumnHelperForStrict<PgVarbitDescriptor>;

export class PgXmlCodec extends CodecImpl<typeof PG_XML_CODEC_ID, readonly [], string, string> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgXmlDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgXml.id;
  override readonly codecId = PG_XML_CODEC_ID;
  override readonly traits = [] as const;
  override readonly enumRefusal =
    'The xml type has no equality operator, so no CHECK can compare a value with the members. No enum can use an xml codec; use a text enum instead.';
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgXmlCodec {
    return () => new PgXmlCodec(this, pgXml);
  }
}

export const pgXmlDescriptor = new PgXmlDescriptor();

export const pgXmlColumn = () =>
  column(pgXmlDescriptor.factory(), pgXmlDescriptor.codecId, undefined);

pgXmlColumn satisfies ColumnHelperFor<PgXmlDescriptor>;
pgXmlColumn satisfies ColumnHelperForStrict<PgXmlDescriptor>;

export class PgOidCodec extends CodecImpl<
  typeof PG_OID_CODEC_ID,
  readonly ['equality', 'order'],
  string | number,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    if (isPgOid(value)) return value;
    throw postgresError(
      'RUNTIME.ENCODE_FAILED',
      'pg/oid@1 application value must be a whole number from 0 to 4294967295',
      { meta: { codecId: PG_OID_CODEC_ID, received: value } },
    );
  }
  async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<number>): number {
    return value.value;
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgOidDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgOid.id;
  override readonly codecId = PG_OID_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgOidCodec {
    return () => new PgOidCodec(this, pgOid);
  }
}

export const pgOidDescriptor = new PgOidDescriptor();

export const pgOidColumn = () =>
  column(pgOidDescriptor.factory(), pgOidDescriptor.codecId, undefined);

pgOidColumn satisfies ColumnHelperFor<PgOidDescriptor>;
pgOidColumn satisfies ColumnHelperForStrict<PgOidDescriptor>;

/** Money as PostgreSQL prints it under `lc_monetary` C: a dollar sign, a comma between each group of three digits, and a minus sign before the dollar sign. */
const C_LOCALE_MONEY_TEXT = /^(-?)\$(\d{1,3}(?:,\d{3})*)\.(\d{2})$/;

/**
 * Reads the money text PostgreSQL prints under `lc_monetary` C into the stored form, and a numeral, which is how PostgreSQL reports a default written as a number. Any other text was printed under another locale, whose currency symbol and separators the codec does not guess at.
 */
function pgMoneyDecode(wire: string): string {
  const printed = C_LOCALE_MONEY_TEXT.exec(wire);
  if (printed !== null) {
    const [, sign = '', whole = '', fraction = ''] = printed;
    const stored = pgMoneyStoredText(`${sign}${whole.replaceAll(',', '')}.${fraction}`);
    if (stored !== undefined) return stored;
  }
  if (DECIMAL_NUMERAL_TEXT.test(wire)) {
    const stored = pgMoneyStoredText(wire);
    if (stored !== undefined) return stored;
    throw postgresError(
      'RUNTIME.DECODE_FAILED',
      'pg/money@1 wire value must be an amount money holds: at most two fraction digits, from -92233720368547758.08 to 92233720368547758.07',
      { meta: { codecId: PG_MONEY_CODEC_ID, received: wire } },
    );
  }
  throw errorLcMonetaryNotC(PG_MONEY_CODEC_ID, wire);
}

export class PgMoneyCodec extends CodecImpl<
  typeof PG_MONEY_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    const stored = typeof value === 'string' ? pgMoneyStoredText(value) : undefined;
    if (stored !== undefined) return stored;
    throw postgresError(
      'RUNTIME.ENCODE_FAILED',
      'pg/money@1 application value must be decimal text with at most two fraction digits, from -92233720368547758.08 to 92233720368547758.07',
      { meta: { codecId: PG_MONEY_CODEC_ID, received: value } },
    );
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return pgMoneyDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

/**
 * A `money` column. The application value is decimal text with two fraction digits, as `pg/numeric@1` gives a decimal: `"12.50"`, `"-1234.56"`. PostgreSQL prints money in the session's `lc_monetary`, which the PostgreSQL target sets to C on every connection, so a row and an included row both read `$1,234.56`.
 */
export class PgMoneyDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgMoney.id;
  override readonly codecId = PG_MONEY_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgMoneyCodec {
    return () => new PgMoneyCodec(this, pgMoney);
  }
}

export const pgMoneyDescriptor = new PgMoneyDescriptor();

export const pgMoneyColumn = () =>
  column(pgMoneyDescriptor.factory(), pgMoneyDescriptor.codecId, undefined);

pgMoneyColumn satisfies ColumnHelperFor<PgMoneyDescriptor>;
pgMoneyColumn satisfies ColumnHelperForStrict<PgMoneyDescriptor>;

export class PgByteaCodec extends CodecImpl<
  typeof PG_BYTEA_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
> {
  async toWire(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  async fromWire(wire: Uint8Array | string, _ctx: CodecCallContext): Promise<Uint8Array> {
    return pgByteaDecodeWire(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): Uint8Array {
    return pgByteaFromBase64(value.value);
  }
  toDataTypeValue(input: Uint8Array): DataTypeValue {
    return this.dataTypeValueOf(pgByteaToBase64(input));
  }
}

export class PgByteaDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'object' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return printedTextJsonProjection(expression);
  }
  override readonly dataType = pgBytea.id;
  override readonly codecId = PG_BYTEA_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly enumRefusal =
    'The contract stores a bytea value as base64 text, which PostgreSQL reads as the bytes of that text, so no CHECK can compare a value with the members. No enum can use a bytea codec; use a text enum instead.';
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgByteaCodec {
    return () => new PgByteaCodec(this, pgBytea);
  }
}

export const pgByteaDescriptor = new PgByteaDescriptor();

export const pgByteaColumn = () =>
  column(pgByteaDescriptor.factory(), pgByteaDescriptor.codecId, undefined);

pgByteaColumn satisfies ColumnHelperFor<PgByteaDescriptor>;
pgByteaColumn satisfies ColumnHelperForStrict<PgByteaDescriptor>;

export class PgUuidCodec extends CodecImpl<
  typeof PG_UUID_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgUuidDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgUuid.id;
  override readonly codecId = PG_UUID_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgUuidCodec {
    return () => new PgUuidCodec(this, pgUuid);
  }
}

export const pgUuidDescriptor = new PgUuidDescriptor();

export const pgUuidColumn = () =>
  column(pgUuidDescriptor.factory(), pgUuidDescriptor.codecId, undefined);

pgUuidColumn satisfies ColumnHelperFor<PgUuidDescriptor>;
pgUuidColumn satisfies ColumnHelperForStrict<PgUuidDescriptor>;

export class PgInetCodec extends CodecImpl<
  typeof PG_INET_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgInetDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgInet.id;
  override readonly codecId = PG_INET_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgInetCodec {
    return () => new PgInetCodec(this, pgInet);
  }
}

export const pgInetDescriptor = new PgInetDescriptor();

export const pgInetColumn = () =>
  column(pgInetDescriptor.factory(), pgInetDescriptor.codecId, undefined);

pgInetColumn satisfies ColumnHelperFor<PgInetDescriptor>;
pgInetColumn satisfies ColumnHelperForStrict<PgInetDescriptor>;

/**
 * A `tsquery` value as the application holds it: text that only Postgres produces, when a query
 * selects one. The brand keeps a bare string from being passed where a full-text query is expected,
 * while a value read back can be passed straight back. It is not exported, so reading one back from
 * Postgres is the only way to get one.
 */
type TsqueryValue = string & { readonly __tsquery: true };

export class PgTsqueryCodec extends CodecImpl<
  typeof PG_TSQUERY_CODEC_ID,
  readonly [],
  string,
  TsqueryValue
> {
  async toWire(value: TsqueryValue, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<TsqueryValue> {
    return blindCast<TsqueryValue, 'Postgres produced this text as a tsquery value'>(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): TsqueryValue {
    return blindCast<TsqueryValue, 'a tsquery value is the text PostgreSQL writes for it'>(
      value.value,
    );
  }
  toDataTypeValue(input: TsqueryValue): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

/**
 * The type of a full-text query: what the parsers and the tag in `full-text` return, and what a
 * `tsquery` value read back from a query binds as when passed to `fullTextMatches`, `fullTextRank`
 * or `fullTextHeadline`. It has no column helper, because a contract cannot author a `tsquery`
 * column, and no traits, because comparing or ordering queries means nothing to an application.
 */
export class PgTsqueryDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgTsquery.id;
  override readonly codecId = PG_TSQUERY_CODEC_ID;
  override readonly traits = [] as const;
  override readonly enumRefusal =
    "PostgreSQL normalises the query text, so a member as written is not the value a query reads back: it prints a & b as 'a' & 'b'. No enum can use a tsquery codec; use a text enum instead.";
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgTsqueryCodec {
    return () => new PgTsqueryCodec(this, pgTsquery);
  }
}

export const pgTsqueryDescriptor = new PgTsqueryDescriptor();

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
  async toWire(value: PgInterval, _ctx: CodecCallContext): Promise<string> {
    // PostgreSQL accepts an ISO-8601 duration as interval input, so the
    // canonical rendering doubles as the wire form.
    return pgIntervalToIso(value);
  }
  async fromWire(
    wire: string | Record<string, unknown>,
    _ctx: CodecCallContext,
  ): Promise<PgInterval> {
    return pgIntervalDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): PgInterval {
    return pgIntervalFromIso(value.value);
  }
  toDataTypeValue(input: PgInterval): DataTypeValue {
    return this.dataTypeValueOf(pgIntervalToIso(input));
  }
}

export class PgIntervalDescriptor extends PostgresCodecDescriptor<PrecisionParams> {
  override readonly jsonType = 'object' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return printedTextJsonProjection(expression);
  }
  override readonly dataType = pgInterval.id;
  override readonly codecId = PG_INTERVAL_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly keepsWrittenForm = true as const;
  override readonly paramsSchema = pgPrecisionParams satisfies StandardSchemaV1<PrecisionParams>;
  override factory(params: PrecisionParams): (ctx: CodecInstanceContext) => PgIntervalCodec {
    return () => new PgIntervalCodec(this, pgInterval, params ?? {});
  }
}

export const pgIntervalDescriptor = new PgIntervalDescriptor();

export const pgIntervalColumn = (params: PrecisionParams = {}) =>
  column(pgIntervalDescriptor.factory(params), pgIntervalDescriptor.codecId, params);

pgIntervalColumn satisfies ColumnHelperFor<PgIntervalDescriptor>;
pgIntervalColumn satisfies ColumnHelperForStrict<PgIntervalDescriptor>;

export class PgJsonCodec extends CodecImpl<
  typeof PG_JSON_CODEC_ID,
  readonly [],
  string | JsonValue,
  JsonValue
> {
  async toWire(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonEncode(value);
  }
  async fromWire(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): JsonValue {
    return value.value;
  }
  toDataTypeValue(input: JsonValue): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgJsonDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'any' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return printedTextJsonProjection(expression);
  }
  override readonly dataType = pgJson.id;
  override readonly codecId = PG_JSON_CODEC_ID;
  override readonly traits = [] as const;
  override readonly enumRefusal =
    'The json type has no equality operator, so no CHECK can compare a value with the members. No enum can use a json codec; use a text enum instead.';
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgJsonCodec {
    return () => new PgJsonCodec(this, pgJson);
  }
}

export const pgJsonDescriptor = new PgJsonDescriptor();

export const pgJsonColumn = () =>
  column(pgJsonDescriptor.factory(), pgJsonDescriptor.codecId, undefined);

pgJsonColumn satisfies ColumnHelperFor<PgJsonDescriptor>;
pgJsonColumn satisfies ColumnHelperForStrict<PgJsonDescriptor>;

export class PgJsonbCodec extends CodecImpl<
  typeof PG_JSONB_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async toWire(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return pgJsonbEncode(value);
  }
  async fromWire(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return pgJsonbDecode(wire);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): JsonValue {
    return value.value;
  }
  toDataTypeValue(input: JsonValue): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

export class PgJsonbDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'any' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return printedTextJsonProjection(expression);
  }
  override readonly dataType = pgJsonb.id;
  override readonly codecId = PG_JSONB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly enumRefusal = pgJsonbEnumRefusal;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgJsonbCodec {
    return () => new PgJsonbCodec(this, pgJsonb);
  }
}

export const pgJsonbDescriptor = new PgJsonbDescriptor();

export const pgJsonbColumn = () =>
  column(pgJsonbDescriptor.factory(), pgJsonbDescriptor.codecId, undefined);

pgJsonbColumn satisfies ColumnHelperFor<PgJsonbDescriptor>;
pgJsonbColumn satisfies ColumnHelperForStrict<PgJsonbDescriptor>;

// --- pg aliases for the SQL base codecs ------------------------------------
// These descriptors give a SQL-base codec a PostgreSQL identity: its own codec
// id and native type. The factories instantiate a subclass of the SQL-base codec
// class (`PgCharCodec` etc.) passing `this` (the pg-alias descriptor), so
// `codec.id` resolves to the pg-alias codec id via `CodecImpl`'s
// `descriptor.codecId` proxy.

export class PgIntCodec extends SqlIntCodec {
  override async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
}

export class PgFloatCodec extends SqlFloatCodec {
  override async fromWire(wire: string | number, _ctx: CodecCallContext): Promise<number> {
    return decodePostgresNumberWire(wire);
  }
}

export class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return unpaddedCharJsonProjection(expression);
  }
  override readonly dataType = pgChar.id;
  override readonly codecId = PG_CHAR_CODEC_ID;
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = pgCharacterLengthParams satisfies StandardSchemaV1<LengthParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this, pgChar, params ?? {});
  }
}

export const pgCharDescriptor = new PgCharDescriptor();

export const pgCharColumn = (params: LengthParams = {}) =>
  column(pgCharDescriptor.factory(params), pgCharDescriptor.codecId, params);

pgCharColumn satisfies ColumnHelperFor<PgCharDescriptor>;

export class PgVarcharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  override readonly jsonType = 'string' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgVarchar.id;
  override readonly codecId = PG_VARCHAR_CODEC_ID;
  override readonly traits = sqlVarcharDescriptor.traits;
  override readonly paramsSchema = pgCharacterLengthParams satisfies StandardSchemaV1<LengthParams>;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(params: LengthParams): (ctx: CodecInstanceContext) => SqlVarcharCodec {
    return () => new SqlVarcharCodec(this, pgVarchar, params ?? {});
  }
}

export const pgVarcharDescriptor = new PgVarcharDescriptor();

export const pgVarcharColumn = (params: LengthParams = {}) =>
  column(pgVarcharDescriptor.factory(params), pgVarcharDescriptor.codecId, params);

pgVarcharColumn satisfies ColumnHelperFor<PgVarcharDescriptor>;

export class PgIntDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgInt4.id;
  override readonly codecId = PG_INT_CODEC_ID;
  override readonly traits = sqlIntDescriptor.traits;
  override readonly paramsSchema = sqlIntDescriptor.paramsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgIntCodec {
    return () => new PgIntCodec(this, pgInt4);
  }
}

export const pgIntDescriptor = new PgIntDescriptor();

export const pgIntColumn = () =>
  column(pgIntDescriptor.factory(), pgIntDescriptor.codecId, undefined);

pgIntColumn satisfies ColumnHelperFor<PgIntDescriptor>;

export class PgFloatDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'number' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgFloat8.id;
  override readonly codecId = PG_FLOAT_CODEC_ID;
  override readonly traits = sqlFloatDescriptor.traits;
  override readonly paramsSchema = sqlFloatDescriptor.paramsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return floatNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => PgFloatCodec {
    return () => new PgFloatCodec(this, pgFloat8);
  }
}

export const pgFloatDescriptor = new PgFloatDescriptor();

export const pgFloatColumn = () =>
  column(pgFloatDescriptor.factory(), pgFloatDescriptor.codecId, undefined);

pgFloatColumn satisfies ColumnHelperFor<PgFloatDescriptor>;

// `ExtractCodecTypes` to derive `CodecTypes`. ---------------------------------------------------------------------------

export const codecDescriptors = definePostgresCodecs([
  postgresSqlCharDescriptor,
  postgresSqlVarcharDescriptor,
  postgresSqlIntDescriptor,
  postgresSqlFloatDescriptor,
  postgresSqlTextDescriptor,
  postgresSqlRawDescriptor,
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
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
  pgDateStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
  pgTimestamptzDateDescriptor,
  pgTimestampDateDescriptor,
  pgTimestampInstantDescriptor,
  pgTimeStringDescriptor,
  pgTimetzDescriptor,
  pgBoolDescriptor,
  pgBitDescriptor,
  pgVarbitDescriptor,
  pgXmlDescriptor,
  pgOidDescriptor,
  pgMoneyDescriptor,
  pgByteaDescriptor,
  pgUuidDescriptor,
  pgInetDescriptor,
  pgIntervalDescriptor,
  pgIntervalStringDescriptor,
  pgJsonDescriptor,
  pgJsonbDescriptor,
  pgTextArrayDescriptor,
  pgTsqueryDescriptor,
]);
