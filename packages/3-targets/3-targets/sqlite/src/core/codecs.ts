/**
 * Native SQLite target codecs (TML-2357). Mirrors the Postgres codec class form in `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqliteXCodec` class extending {@link CodecImpl} that wraps the encode/decode/encodeJson/decodeJson conversions inline. SQLite's runtime conversions are simple enough that there is no shared helper module; the class bodies are the single source of truth. 2. A `SqliteXDescriptor` class extending {@link SqliteCodecDescriptor} declaring the codec id, traits, target types, params schema, and canonical JSON projection. SQLite declares no per-target native type, and every SQLite codec is non-parameterized. 3. A per-codec column helper (`sqliteXColumn`) that calls `descriptor.factory()` directly and packages the result into a {@link ColumnSpec} via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor` + `ColumnHelperForStrict` (every SQLite codec's resolved type is well-defined).
 *
 * After TML-2357 this is the canonical source of SQLite codec metadata and runtime behaviour — the legacy `mkCodec` / `defineCodec` carriers (and the parallel `byScalar` / `codecDescriptorDefinitions` collection exports) retired with the deletion sweep.
 *
 * Audit: every SQLite codec is non-parameterized and parameter-stateless; `factory()` takes no params (`P = void`) and returns a fresh codec constructed solely from `this`.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import {
  CaseExpr,
  CastExpr,
  FunctionCallExpr,
  LiteralExpr,
  NullCheckExpr,
  type ProjectionExpr,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
import { defineSqliteCodecs, SqliteCodecDescriptor, sqliteCodec } from './codec-descriptor';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BIGINT_NUMBER_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from './codec-ids';
import {
  sqliteBigint,
  sqliteBlob,
  sqliteDatetime,
  sqliteInteger,
  sqliteJson,
  sqliteReal,
  sqliteText,
} from './data-types';
import { sqliteError } from './errors';

/**
 * Projects the expression unchanged, for codecs whose canonical JSON is what
 * SQLite's own JSON conversion already produces.
 *
 * Identity here is a claim about the target's behaviour, not an absence of one:
 * the codec's conformance cases are what test it, including at the boundaries
 * of the representation where a native conversion would be most likely to
 * diverge.
 */
const identityJsonProjection = (expression: ProjectionExpr): ProjectionExpr => expression;

/**
 * Projects an integer-valued expression as decimal text.
 *
 * The cast is part of the projected expression, so it applies before the JSON
 * constructor sees the value: handed an INTEGER directly, the constructor emits
 * a JSON number, and SQLite's 64-bit range does not survive being read back as
 * a double. Casting the constructor's result would be too late.
 */
const decimalTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'TEXT');

/**
 * Projects a BLOB as hexadecimal text.
 *
 * SQLite's JSON functions reject a BLOB argument outright, so the encoding has
 * to replace the native conversion rather than post-process it. `hex()` emits
 * uppercase and never wraps at any length, which is the spelling `encodeJson`
 * pins.
 *
 * `hex(NULL)` is `''` rather than NULL, and `''` is the hex of an empty blob —
 * so without the NULL check an absent blob and an empty one would both project
 * as `''`, and `decodeJson` accepts `''` because zero hex pairs is a valid
 * empty blob. The check keeps the two distinguishable.
 */
const hexJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CaseExpr.of(
    [{ condition: NullCheckExpr.isNull(expression), value: LiteralExpr.of(null) }],
    FunctionCallExpr.of('hex', [expression]),
  );

const JSON_RETAG_FN = 'json' as const;

/**
 * Re-applies SQLite's JSON subtype to a document-valued expression.
 *
 * SQLite carries "this text is JSON" as a subtype on the value rather than in
 * its type, and the subtype does not survive a derived table: a document that
 * `json_object` produced arrives one level out as plain text, so the enclosing
 * constructor embeds it as a *string containing JSON* rather than as a
 * document. `json()` re-applies the subtype, which is what makes the value nest
 * as a document again.
 *
 * The loss happens at the first derived-table boundary and does not compound, so
 * a retag is needed where the document is consumed rather than at every level it
 * passes through.
 *
 * Applying this twice is a no-op — SQLite's `json()` is idempotent, and the
 * wrapper collapses rather than nesting so the rendered SQL says so too. It is
 * safe on any valid JSON text, including scalars, and on NULL; it raises
 * `malformed JSON` on text that is not JSON, which is the correct failure for a
 * value that was never a document.
 */
export const jsonDocumentRetag = (expression: ProjectionExpr): ProjectionExpr =>
  isJsonRetag(expression) ? expression : FunctionCallExpr.of(JSON_RETAG_FN, [expression]);

/** Whether an expression is already a retag, so applying one again would only nest. */
const isJsonRetag = (expression: ProjectionExpr): boolean =>
  expression instanceof FunctionCallExpr &&
  expression.fn === JSON_RETAG_FN &&
  expression.args.length === 1;

const DECIMAL_INTEGER = /^-?\d+$/;
const UPPERCASE_HEX = /^(?:[0-9A-F]{2})*$/;

/** Renders the decimal text `sqlite/bigintnumber@1` carries, whose application type is `number`, as a number literal. */
const decimalTextNumberLiteral = (value: JsonValue): string | undefined =>
  typeof value === 'string' && DECIMAL_INTEGER.test(value) ? value : undefined;

/**
 * JSON has no spelling for an infinity or a NaN, and SQLite renders one as
 * `9.0e+999`, which reads back as `Infinity` rather than failing. A real is
 * therefore carried only where it is finite.
 */
const finiteReal = (value: number, code: 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED') => {
  if (!Number.isFinite(value)) {
    throw sqliteError(code, 'sqlite/real@1 value must be a finite number', {
      meta: { codecId: SQLITE_REAL_CODEC_ID, received: String(value) },
    });
  }
  return value;
};

const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Requires an application value to be of the JS type the codec reads.
 *
 * A range check reads a value of the wrong type as a value out of range, and
 * reports a number plainly inside the range as outside it — so the type is
 * established first and answered for on its own terms, naming what a caller
 * has to change.
 */
const requireJsType = (codecId: string, expected: 'number' | 'bigint', value: unknown): void => {
  if (typeof value === expected) return;
  throw sqliteError(
    'RUNTIME.ENCODE_FAILED',
    `${codecId} value must be a ${expected}, got ${typeof value} ${String(value)}`,
    { meta: { codecId, received: typeof value } },
  );
};

/**
 * Writes an application value as the decimal text `sqlite/bigint@1` carries as
 * its canonical JSON.
 *
 * A schema-written literal default (`BigInt @default(0)`) arrives here as a
 * `number`, since a number literal is the only integer a schema language
 * writes, and one that is a safe integer names its value exactly. Past that
 * range the literal was rounded before any of this ran, so the value written is
 * not the value meant — which this refuses rather than minting an exact-looking
 * value from it. A non-integral number is refused on the same terms.
 */
const bigintEncodeJson = (codecId: string, value: bigint | number): string => {
  if (typeof value !== 'number') {
    requireJsType(codecId, 'bigint', value);
    return value.toString();
  }
  if (!Number.isSafeInteger(value)) {
    throw sqliteError(
      'RUNTIME.ENCODE_FAILED',
      `${codecId} number literal must be an integer within the safe integer range, got ${String(value)}`,
      { meta: { codecId, received: String(value) } },
    );
  }
  return BigInt(value).toString();
};

/**
 * Requires an integer within ±(2^53 − 1), the range a JS `number` holds
 * exactly. The guard throws rather than rounding: past the boundary a `number`
 * silently loses digits, which is the failure mode this codec exists to refuse.
 */
const safeIntegerNumber = (
  value: number,
  code: 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED',
) => {
  if (!Number.isSafeInteger(value)) {
    throw sqliteError(
      code,
      `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${String(value)}`,
      { meta: { codecId: SQLITE_BIGINT_NUMBER_CODEC_ID, received: String(value) } },
    );
  }
  if (Object.is(value, -0)) return 0;
  return value;
};

/** The application value the number-flavoured integer codec writes: the JS type it reads, within the range that type holds exactly. */
const encodableSafeInteger = (value: number): number => {
  requireJsType(SQLITE_BIGINT_NUMBER_CODEC_ID, 'number', value);
  return safeIntegerNumber(value, 'RUNTIME.ENCODE_FAILED');
};

/**
 * Converts an exact `bigint` into a safe-range `number`, comparing before any
 * conversion so an out-of-range value throws rather than rounds.
 */
const safeIntegerFromBigint = (value: bigint): number => {
  if (value < MIN_SAFE_INTEGER_BIGINT || value > MAX_SAFE_INTEGER_BIGINT) {
    throw sqliteError(
      'RUNTIME.DECODE_FAILED',
      `sqlite/bigintnumber@1 value must be an integer within the safe integer range, got ${value}`,
      { meta: { codecId: SQLITE_BIGINT_NUMBER_CODEC_ID, received: value.toString() } },
    );
  }
  return Number(value);
};

export const sqliteSqlCharDescriptor = sqliteCodec(sqlCharDescriptor, {
  dataType: sqliteText.id,
  jsonProjection: identityJsonProjection,
});

export const sqliteSqlVarcharDescriptor = sqliteCodec(sqlVarcharDescriptor, {
  dataType: sqliteText.id,
  jsonProjection: identityJsonProjection,
});

export const sqliteSqlIntDescriptor = sqliteCodec(sqlIntDescriptor, {
  dataType: sqliteInteger.id,
  jsonProjection: identityJsonProjection,
});

export const sqliteSqlFloatDescriptor = sqliteCodec(sqlFloatDescriptor, {
  dataType: sqliteReal.id,
  jsonProjection: identityJsonProjection,
});

export class SqliteTextCodec extends CodecImpl<
  typeof SQLITE_TEXT_CODEC_ID,
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

export class SqliteTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteText.id;
  override readonly codecId = SQLITE_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteTextCodec {
    return () => new SqliteTextCodec(this);
  }
}

export const sqliteTextDescriptor = new SqliteTextDescriptor();

export const sqliteTextColumn = () =>
  column(sqliteTextDescriptor.factory(), sqliteTextDescriptor.codecId, undefined, 'text');

sqliteTextColumn satisfies ColumnHelperFor<SqliteTextDescriptor>;
sqliteTextColumn satisfies ColumnHelperForStrict<SqliteTextDescriptor>;

export class SqliteIntegerCodec extends CodecImpl<
  typeof SQLITE_INTEGER_CODEC_ID,
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
    if (typeof json !== 'number') {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/integer@1 database JSON value must be a number',
        { meta: { codecId: SQLITE_INTEGER_CODEC_ID, received: typeof json } },
      );
    }
    if (!Number.isSafeInteger(json)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        `sqlite/integer@1 value must be an integer within the safe integer range, got ${String(json)}`,
        { meta: { codecId: SQLITE_INTEGER_CODEC_ID, received: String(json) } },
      );
    }
    return json;
  }
}

export class SqliteIntegerDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteInteger.id;
  override readonly codecId = SQLITE_INTEGER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['integer'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteIntegerCodec {
    return () => new SqliteIntegerCodec(this);
  }
}

export const sqliteIntegerDescriptor = new SqliteIntegerDescriptor();

export const sqliteIntegerColumn = () =>
  column(sqliteIntegerDescriptor.factory(), sqliteIntegerDescriptor.codecId, undefined, 'integer');

sqliteIntegerColumn satisfies ColumnHelperFor<SqliteIntegerDescriptor>;
sqliteIntegerColumn satisfies ColumnHelperForStrict<SqliteIntegerDescriptor>;

export class SqliteRealCodec extends CodecImpl<
  typeof SQLITE_REAL_CODEC_ID,
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
    return finiteReal(value, 'RUNTIME.ENCODE_FAILED');
  }
  decodeJson(json: JsonValue): number {
    if (typeof json !== 'number') {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/real@1 database JSON value must be a number',
        {
          meta: { codecId: SQLITE_REAL_CODEC_ID, received: typeof json },
        },
      );
    }
    return finiteReal(json, 'RUNTIME.DECODE_FAILED');
  }
}

export class SqliteRealDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteReal.id;
  override readonly codecId = SQLITE_REAL_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['real'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteRealCodec {
    return () => new SqliteRealCodec(this);
  }
}

export const sqliteRealDescriptor = new SqliteRealDescriptor();

export const sqliteRealColumn = () =>
  column(sqliteRealDescriptor.factory(), sqliteRealDescriptor.codecId, undefined, 'real');

sqliteRealColumn satisfies ColumnHelperFor<SqliteRealDescriptor>;
sqliteRealColumn satisfies ColumnHelperForStrict<SqliteRealDescriptor>;

export class SqliteBlobCodec extends CodecImpl<
  typeof SQLITE_BLOB_CODEC_ID,
  readonly ['equality'],
  Uint8Array,
  Uint8Array
> {
  async encode(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  async decode(wire: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return wire;
  }
  encodeJson(value: Uint8Array): JsonValue {
    return Buffer.from(value).toString('hex').toUpperCase();
  }
  decodeJson(json: JsonValue): Uint8Array {
    if (typeof json !== 'string' || !UPPERCASE_HEX.test(json)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/blob@1 database JSON value must be uppercase hexadecimal text',
        { meta: { codecId: SQLITE_BLOB_CODEC_ID, received: typeof json } },
      );
    }
    return new Uint8Array(Buffer.from(json, 'hex'));
  }
}

export class SqliteBlobDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return hexJsonProjection(expression);
  }
  override readonly dataType = sqliteBlob.id;
  override readonly codecId = SQLITE_BLOB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['blob'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteBlobCodec {
    return () => new SqliteBlobCodec(this);
  }
}

export const sqliteBlobDescriptor = new SqliteBlobDescriptor();

export const sqliteBlobColumn = () =>
  column(sqliteBlobDescriptor.factory(), sqliteBlobDescriptor.codecId, undefined, 'blob');

sqliteBlobColumn satisfies ColumnHelperFor<SqliteBlobDescriptor>;
sqliteBlobColumn satisfies ColumnHelperForStrict<SqliteBlobDescriptor>;

export class SqliteDatetimeCodec extends CodecImpl<
  typeof SQLITE_DATETIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  // Reject `Invalid Date` (NaN-time) at every decode ingress so consumers never receive a Date object whose downstream operations silently produce NaN. Mirrors the stricter ISO-8601 validation on the postgres timestamp helpers.
  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        `sqlite/datetime@1 value must be a valid ISO-8601 string: ${value}`,
        { meta: { codecId: SQLITE_DATETIME_CODEC_ID, received: value } },
      );
    }
    return date;
  }
  async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
    return value.toISOString();
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return this.parseDate(wire);
  }
  encodeJson(value: Date): JsonValue {
    return value.toISOString();
  }
  decodeJson(json: JsonValue): Date {
    if (typeof json !== 'string') {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/datetime@1 contract value must be an ISO-8601 string',
        { meta: { codecId: SQLITE_DATETIME_CODEC_ID, received: typeof json } },
      );
    }
    return this.parseDate(json);
  }
}

export class SqliteDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteDatetime.id;
  override readonly codecId = SQLITE_DATETIME_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteDatetimeCodec {
    return () => new SqliteDatetimeCodec(this);
  }
}

export const sqliteDatetimeDescriptor = new SqliteDatetimeDescriptor();

export const sqliteDatetimeColumn = () =>
  column(sqliteDatetimeDescriptor.factory(), sqliteDatetimeDescriptor.codecId, undefined, 'text');

sqliteDatetimeColumn satisfies ColumnHelperFor<SqliteDatetimeDescriptor>;
sqliteDatetimeColumn satisfies ColumnHelperForStrict<SqliteDatetimeDescriptor>;

export class SqliteJsonCodec extends CodecImpl<
  typeof SQLITE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async encode(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return JSON.stringify(value);
  }
  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return typeof wire === 'string' ? (JSON.parse(wire) as JsonValue) : wire;
  }
  encodeJson(value: JsonValue): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): JsonValue {
    return json;
  }
}

export class SqliteJsonDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return jsonDocumentRetag(expression);
  }
  override readonly dataType = sqliteJson.id;
  override readonly codecId = SQLITE_JSON_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteJsonCodec {
    return () => new SqliteJsonCodec(this);
  }
}

export const sqliteJsonDescriptor = new SqliteJsonDescriptor();

export const sqliteJsonColumn = () =>
  column(sqliteJsonDescriptor.factory(), sqliteJsonDescriptor.codecId, undefined, 'text');

sqliteJsonColumn satisfies ColumnHelperFor<SqliteJsonDescriptor>;
sqliteJsonColumn satisfies ColumnHelperForStrict<SqliteJsonDescriptor>;

export class SqliteBigintCodec extends CodecImpl<
  typeof SQLITE_BIGINT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint | string,
  bigint
> {
  async encode(value: bigint, _ctx: CodecCallContext): Promise<number | bigint> {
    requireJsType(SQLITE_BIGINT_CODEC_ID, 'bigint', value);
    return value;
  }
  /**
   * The wire value is text wherever the value could outrun a JS number: an
   * aggregate SQLite computes leaves the database through the descriptor's cast
   * to text, because the driver reads an integer no number can hold as an error
   * rather than a value. A number-typed wire value must therefore be a safe
   * integer — past ±(2^53 − 1) it has already rounded, and converting it would
   * mint a spuriously-exact `bigint` that need not equal the stored value.
   */
  async decode(wire: number | bigint | string, _ctx: CodecCallContext): Promise<bigint> {
    if (typeof wire === 'number' && !Number.isSafeInteger(wire)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        `sqlite/bigint@1 wire number must be an integer within the safe integer range, got ${String(wire)}`,
        { meta: { codecId: SQLITE_BIGINT_CODEC_ID, received: String(wire) } },
      );
    }
    if (typeof wire === 'string' && !DECIMAL_INTEGER.test(wire)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/bigint@1 wire value must be a decimal string',
        { meta: { codecId: SQLITE_BIGINT_CODEC_ID, received: wire } },
      );
    }
    return BigInt(wire);
  }
  encodeJson(value: bigint): JsonValue {
    return bigintEncodeJson(SQLITE_BIGINT_CODEC_ID, value);
  }
  decodeJson(json: JsonValue): bigint {
    if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/bigint@1 database JSON value must be a decimal string',
        { meta: { codecId: SQLITE_BIGINT_CODEC_ID, received: typeof json } },
      );
    }
    return BigInt(json);
  }
}

export class SqliteBigintDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = sqliteBigint.id;
  override readonly codecId = SQLITE_BIGINT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = ['integer'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => SqliteBigintCodec {
    return () => new SqliteBigintCodec(this);
  }
}

export const sqliteBigintDescriptor = new SqliteBigintDescriptor();

export const sqliteBigintColumn = () =>
  column(sqliteBigintDescriptor.factory(), sqliteBigintDescriptor.codecId, undefined, 'integer');

sqliteBigintColumn satisfies ColumnHelperFor<SqliteBigintDescriptor>;
sqliteBigintColumn satisfies ColumnHelperForStrict<SqliteBigintDescriptor>;

/**
 * A SQLite INTEGER decoded as a JS `number`, for columns whose values stay
 * within the safe integer range ±(2^53 − 1). Both directions guard rather than
 * round: decode (wire and JSON) and encode throw a structured error on
 * out-of-range or non-integral input. The canonical JSON is the decimal text
 * `sqlite/bigint` carries, which every codec of that data type shares. The
 * descriptor claims no target type, so `integer` in type position keeps its
 * current codecs.
 */
export class SqliteBigintNumberCodec extends CodecImpl<
  typeof SQLITE_BIGINT_NUMBER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint | string,
  number
> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return encodableSafeInteger(value);
  }
  /**
   * The driver hands an INTEGER over as a `number` or, in safe-integer mode, a
   * `bigint`; a bigint (or decimal text) is range-checked exactly before any
   * conversion to `number`, so an out-of-range value throws rather than rounds.
   */
  async decode(wire: number | bigint | string, _ctx: CodecCallContext): Promise<number> {
    if (typeof wire === 'number') return safeIntegerNumber(wire, 'RUNTIME.DECODE_FAILED');
    if (typeof wire === 'string' && !DECIMAL_INTEGER.test(wire)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/bigintnumber@1 wire value must be a decimal string',
        { meta: { codecId: SQLITE_BIGINT_NUMBER_CODEC_ID, received: wire } },
      );
    }
    return safeIntegerFromBigint(BigInt(wire));
  }
  encodeJson(value: number): JsonValue {
    return String(encodableSafeInteger(value));
  }
  decodeJson(json: JsonValue): number {
    if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/bigintnumber@1 database JSON value must be decimal text',
        { meta: { codecId: SQLITE_BIGINT_NUMBER_CODEC_ID, received: typeof json } },
      );
    }
    return safeIntegerFromBigint(BigInt(json));
  }
}

export class SqliteBigintNumberDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = sqliteBigint.id;
  override readonly codecId = SQLITE_BIGINT_NUMBER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly targetTypes = [] as const;
  override readonly paramsSchema = voidParamsSchema;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteBigintNumberCodec {
    return () => new SqliteBigintNumberCodec(this);
  }
}

export const sqliteBigintNumberDescriptor = new SqliteBigintNumberDescriptor();

export const sqliteBigintNumberColumn = () =>
  column(
    sqliteBigintNumberDescriptor.factory(),
    sqliteBigintNumberDescriptor.codecId,
    undefined,
    'integer',
  );

sqliteBigintNumberColumn satisfies ColumnHelperFor<SqliteBigintNumberDescriptor>;
sqliteBigintNumberColumn satisfies ColumnHelperForStrict<SqliteBigintNumberDescriptor>;

export const codecDescriptors = defineSqliteCodecs([
  sqliteSqlCharDescriptor,
  sqliteSqlVarcharDescriptor,
  sqliteSqlIntDescriptor,
  sqliteSqlFloatDescriptor,
  sqliteTextDescriptor,
  sqliteIntegerDescriptor,
  sqliteRealDescriptor,
  sqliteBlobDescriptor,
  sqliteDatetimeDescriptor,
  sqliteJsonDescriptor,
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
]);
