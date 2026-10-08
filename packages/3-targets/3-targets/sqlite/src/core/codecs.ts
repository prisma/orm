/**
 * Native SQLite target codecs (TML-2357). Mirrors the Postgres codec class form in `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
 *
 * Each codec ships as three artifacts:
 *
 * 1. A `SqliteXCodec` class extending {@link CodecImpl} that wraps the wire and value conversions inline. SQLite's runtime conversions are simple enough that there is no shared helper module; the class bodies are the single source of truth. 2. A `SqliteXDescriptor` class extending {@link SqliteCodecDescriptor} declaring the codec id, traits, target types, params schema, and canonical JSON projection. SQLite declares no per-target native type, and every SQLite codec is non-parameterized. 3. A per-codec column helper (`sqliteXColumn`) that calls `descriptor.factory()` directly and packages the result into a {@link ColumnSpec} via the framework {@link column} packager. The helper is tied to its descriptor with `satisfies ColumnHelperFor` + `ColumnHelperForStrict` (every SQLite codec's resolved type is well-defined).
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
  type DataTypeValue,
  floatToJson,
  readJsonFloat,
  readJsonIntegerText,
  refuseJsonValue,
  SAFE_INTEGER_BIGINT_RANGE,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { canonicalDateTime } from '@internal/sql-contract/data-type-support';
import {
  BinaryExpr,
  CaseExpr,
  CastExpr,
  FunctionCallExpr,
  LiteralExpr,
  type ProjectionExpr,
  SqlCharCodec,
  SqlFloatCodec,
  SqlIntCodec,
  SqlVarcharCodec,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';
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
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteInteger,
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
 * Projects a blob as a one-element array of its hexadecimal text.
 *
 * SQLite's JSON functions reject a BLOB argument outright, so the encoding has to replace the native
 * conversion rather than post-process it. `hex()` emits uppercase and never wraps. The array is what
 * tells a blob from text: outside a STRICT table a BLOB column may hold text, which passes through as
 * text, as a row carries it, and so does NULL and any other value.
 */
const hexJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CaseExpr.of(
    [
      {
        condition: BinaryExpr.eq(
          FunctionCallExpr.of('typeof', [expression]),
          LiteralExpr.of('blob'),
        ),
        value: FunctionCallExpr.of('json_array', [FunctionCallExpr.of('hex', [expression])]),
      },
    ],
    expression,
  );

/**
 * Projects a REAL as SQLite writes it in JSON, except an infinity, which SQLite writes as `9.0e+999` and which becomes the text `Infinity` or `-Infinity` that the codec stores. The test is equality with an infinity, so text or a blob that a REAL column holds outside a STRICT table passes through unchanged.
 */
const floatJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CaseExpr.of(
    [
      {
        condition: BinaryExpr.eq(expression, LiteralExpr.of(Number.POSITIVE_INFINITY)),
        value: LiteralExpr.of('Infinity'),
      },
      {
        condition: BinaryExpr.eq(expression, LiteralExpr.of(Number.NEGATIVE_INFINITY)),
        value: LiteralExpr.of('-Infinity'),
      },
    ],
    expression,
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

/** Renders the decimal text `sqlite/bigintnumber@1` carries, whose application type is `number`, as a number literal. */
const decimalTextNumberLiteral = (value: JsonValue): string | undefined =>
  typeof value === 'string' && DECIMAL_INTEGER.test(value) ? value : undefined;

/**
 * SQLite stores an infinity but not NaN, which it turns into NULL, so a float codec on SQLite refuses NaN wherever it writes a value: to a parameter, and to the contract.
 */
function refuseNaN(codecId: string, value: number): number {
  if (Number.isNaN(value)) {
    throw sqliteError(
      'RUNTIME.ENCODE_FAILED',
      `${codecId} value must be a number other than NaN, which SQLite cannot store`,
      { meta: { codecId, received: 'NaN' } },
    );
  }
  return value;
}

/** Reads a float's JSON form, which on SQLite has no NaN. */
function readJsonFloatWithoutNaN(codecId: string, json: JsonValue): number {
  const value = readJsonFloat(codecId, json);
  if (Number.isNaN(value)) {
    return refuseJsonValue(
      codecId,
      'a finite number or the text Infinity or -Infinity; SQLite cannot store NaN',
      json,
    );
  }
  return value;
}

/** `sql/float@1` as SQLite stores it: without NaN. */
export class SqliteFloatCodec extends SqlFloatCodec {
  override async toWire(value: number, ctx: CodecCallContext): Promise<number> {
    return super.toWire(refuseNaN(this.id, value), ctx);
  }
  override async fromWire(wire: number | string, _ctx: CodecCallContext): Promise<number> {
    return floatWire(this.id, wire);
  }
  override fromDataTypeValue(value: DataTypeValue): number {
    return readJsonFloatWithoutNaN(this.id, value.value);
  }
  override toDataTypeValue(input: number): DataTypeValue {
    return super.toDataTypeValue(refuseNaN(this.id, input));
  }
}

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
 * silently loses digits, which is the failure mode these codecs exist to refuse.
 */
const safeIntegerNumber = (
  codecId: string,
  value: number,
  code: 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED',
) => {
  if (!Number.isSafeInteger(value)) {
    throw sqliteError(
      code,
      `${codecId} value must be an integer within the safe integer range, got ${String(value)}`,
      { meta: { codecId, received: String(value) } },
    );
  }
  if (Object.is(value, -0)) return 0;
  return value;
};

/** The application value a number-flavoured integer codec writes: the JS type it reads, within the range that type holds exactly. */
const encodableSafeInteger = (codecId: string, value: number): number => {
  requireJsType(codecId, 'number', value);
  return safeIntegerNumber(codecId, value, 'RUNTIME.ENCODE_FAILED');
};

/**
 * Converts an exact `bigint` into a safe-range `number`, comparing before any
 * conversion so an out-of-range value throws rather than rounds.
 */
const safeIntegerFromBigint = (codecId: string, value: bigint): number => {
  if (value < SAFE_INTEGER_BIGINT_RANGE.min || value > SAFE_INTEGER_BIGINT_RANGE.max) {
    throw sqliteError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} value must be an integer within the safe integer range, got ${value}`,
      { meta: { codecId, received: value.toString() } },
    );
  }
  return Number(value);
};

/** `sqlite/integer`'s canonical form, read into a `number`: digit text within the safe integer range. */
const safeIntegerFromDigitText = (codecId: string, json: JsonValue): number =>
  Number(readJsonIntegerText(codecId, json, SAFE_INTEGER_BIGINT_RANGE));

/** A `number` written as `sqlite/integer`'s canonical form. */
const digitTextOfSafeInteger = (codecId: string, value: number): string =>
  String(encodableSafeInteger(codecId, value));

/**
 * Reads an INTEGER's wire value into a `number`: the number the driver returns for a row, or the decimal text an include carries, because its projection casts the integer to text so that no digit is lost in JSON.
 */
function safeIntegerWire(codecId: string, wire: number | string): number {
  if (typeof wire === 'number') return wire;
  if (!DECIMAL_INTEGER.test(wire)) {
    throw sqliteError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} wire value must be an integer or its decimal text`,
      { meta: { codecId, received: wire } },
    );
  }
  return safeIntegerFromBigint(codecId, BigInt(wire));
}

/**
 * Reads a REAL's wire value: the number the driver returns for a row, or the text `Infinity` or `-Infinity` an include carries, because JSON has no infinity.
 */
function floatWire(codecId: string, wire: number | string): number {
  if (typeof wire === 'number') return wire;
  if (wire === 'Infinity') return Number.POSITIVE_INFINITY;
  if (wire === '-Infinity') return Number.NEGATIVE_INFINITY;
  throw sqliteError(
    'RUNTIME.DECODE_FAILED',
    `${codecId} wire value must be a number, or the text Infinity or -Infinity`,
    { meta: { codecId, received: wire } },
  );
}

/** The hex text SQLite's `hex()` writes: two uppercase digits for each byte. */
const BLOB_HEX_TEXT = /^(?:[0-9A-F]{2})*$/;

/**
 * Projects a `sql/char@1` value without trailing spaces, as its `decode` reads it on a flat read, so an include reads the same value. SQLite does not pad the value; the rule is the family codec's.
 */
const unpaddedCharJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  FunctionCallExpr.of('rtrim', [expression, LiteralExpr.of(' ')]);

/**
 * SQLite does not enforce a character length, and its codec type map declares no `Char` or
 * `Varchar` type, so the two character codecs render no TypeScript type of their own.
 */
export const sqliteSqlCharDescriptor = sqliteCodec(sqlCharDescriptor, {
  dataType: sqliteCharacter,
  jsonProjection: unpaddedCharJsonProjection,
  factory: (descriptor, dataType, params) => () => new SqlCharCodec(descriptor, dataType, params),
  renderTypes: false,
});

export const sqliteSqlVarcharDescriptor = sqliteCodec(sqlVarcharDescriptor, {
  dataType: sqliteCharacterVarying,
  jsonProjection: identityJsonProjection,
  factory: (descriptor, dataType, params) => () =>
    new SqlVarcharCodec(descriptor, dataType, params),
  renderTypes: false,
});

/** `sql/int@1` as SQLite stores it: its canonical form is `sqlite/integer`'s digit text. */
export class SqliteSqlIntCodec extends SqlIntCodec {
  override async fromWire(wire: number | string, _ctx: CodecCallContext): Promise<number> {
    return safeIntegerWire(this.id, wire);
  }
  override fromDataTypeValue(value: DataTypeValue): number {
    return safeIntegerFromDigitText(this.id, value.value);
  }
  override toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(digitTextOfSafeInteger(this.id, input));
  }
}

export const sqliteSqlIntDescriptor = sqliteCodec(sqlIntDescriptor, {
  dataType: sqliteInteger,
  jsonProjection: decimalTextJsonProjection,
  factory: (descriptor, dataType) => () => new SqliteSqlIntCodec(descriptor, dataType),
});

export const sqliteSqlFloatDescriptor = sqliteCodec(sqlFloatDescriptor, {
  dataType: sqliteReal,
  jsonProjection: floatJsonProjection,
  factory: (descriptor, dataType) => () => new SqliteFloatCodec(descriptor, dataType),
});

export class SqliteTextCodec extends CodecImpl<
  typeof SQLITE_TEXT_CODEC_ID,
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

export class SqliteTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteText.id;
  override readonly codecId = SQLITE_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteTextCodec {
    return () => new SqliteTextCodec(this, sqliteText);
  }
}

export const sqliteTextDescriptor = new SqliteTextDescriptor();

export const sqliteTextColumn = () =>
  column(sqliteTextDescriptor.factory(), sqliteTextDescriptor.codecId, undefined);

sqliteTextColumn satisfies ColumnHelperFor<SqliteTextDescriptor>;
sqliteTextColumn satisfies ColumnHelperForStrict<SqliteTextDescriptor>;

export class SqliteIntegerCodec extends CodecImpl<
  typeof SQLITE_INTEGER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | string,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async fromWire(wire: number | string, _ctx: CodecCallContext): Promise<number> {
    return safeIntegerWire(SQLITE_INTEGER_CODEC_ID, wire);
  }
  fromDataTypeValue(value: DataTypeValue<string>): number {
    return safeIntegerFromDigitText(SQLITE_INTEGER_CODEC_ID, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(digitTextOfSafeInteger(SQLITE_INTEGER_CODEC_ID, input));
  }
}

export class SqliteIntegerDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = sqliteInteger.id;
  override readonly codecId = SQLITE_INTEGER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteIntegerCodec {
    return () => new SqliteIntegerCodec(this, sqliteInteger);
  }
}

export const sqliteIntegerDescriptor = new SqliteIntegerDescriptor();

export const sqliteIntegerColumn = () =>
  column(sqliteIntegerDescriptor.factory(), sqliteIntegerDescriptor.codecId, undefined);

sqliteIntegerColumn satisfies ColumnHelperFor<SqliteIntegerDescriptor>;
sqliteIntegerColumn satisfies ColumnHelperForStrict<SqliteIntegerDescriptor>;

export class SqliteRealCodec extends CodecImpl<
  typeof SQLITE_REAL_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | string,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return refuseNaN(SQLITE_REAL_CODEC_ID, value);
  }
  async fromWire(wire: number | string, _ctx: CodecCallContext): Promise<number> {
    return floatWire(SQLITE_REAL_CODEC_ID, wire);
  }
  fromDataTypeValue(value: DataTypeValue<JsonValue>): number {
    return readJsonFloatWithoutNaN(SQLITE_REAL_CODEC_ID, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(floatToJson(refuseNaN(SQLITE_REAL_CODEC_ID, input)));
  }
}

export class SqliteRealDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return floatJsonProjection(expression);
  }
  override readonly dataType = sqliteReal.id;
  override readonly codecId = SQLITE_REAL_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteRealCodec {
    return () => new SqliteRealCodec(this, sqliteReal);
  }
}

export const sqliteRealDescriptor = new SqliteRealDescriptor();

export const sqliteRealColumn = () =>
  column(sqliteRealDescriptor.factory(), sqliteRealDescriptor.codecId, undefined);

sqliteRealColumn satisfies ColumnHelperFor<SqliteRealDescriptor>;
sqliteRealColumn satisfies ColumnHelperForStrict<SqliteRealDescriptor>;

export class SqliteBlobCodec extends CodecImpl<
  typeof SQLITE_BLOB_CODEC_ID,
  readonly ['equality'],
  Uint8Array | readonly string[],
  Uint8Array
> {
  async toWire(value: Uint8Array, _ctx: CodecCallContext): Promise<Uint8Array> {
    return value;
  }
  /** A row carries the blob's bytes; an include carries the array of their hex text that its projection writes, because SQLite's JSON functions refuse a blob. Anything else a BLOB column holds is refused. */
  async fromWire(
    wire: Uint8Array | readonly string[],
    _ctx: CodecCallContext,
  ): Promise<Uint8Array> {
    if (wire instanceof Uint8Array) return wire;
    const [hex] = Array.isArray(wire) && wire.length === 1 ? wire : [];
    if (typeof hex !== 'string' || !BLOB_HEX_TEXT.test(hex)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries',
        { meta: { codecId: SQLITE_BLOB_CODEC_ID, received: String(wire) } },
      );
    }
    return new Uint8Array(Buffer.from(hex, 'hex'));
  }
  fromDataTypeValue(value: DataTypeValue<string>): Uint8Array {
    return new Uint8Array(Buffer.from(value.value, 'hex'));
  }
  toDataTypeValue(input: Uint8Array): DataTypeValue {
    return this.dataTypeValueOf(Buffer.from(input).toString('hex').toUpperCase());
  }
}

export class SqliteBlobDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return hexJsonProjection(expression);
  }
  override readonly dataType = sqliteBlob.id;
  override readonly codecId = SQLITE_BLOB_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteBlobCodec {
    return () => new SqliteBlobCodec(this, sqliteBlob);
  }
}

export const sqliteBlobDescriptor = new SqliteBlobDescriptor();

export const sqliteBlobColumn = () =>
  column(sqliteBlobDescriptor.factory(), sqliteBlobDescriptor.codecId, undefined);

sqliteBlobColumn satisfies ColumnHelperFor<SqliteBlobDescriptor>;
sqliteBlobColumn satisfies ColumnHelperForStrict<SqliteBlobDescriptor>;

/**
 * The canonical form of a `sqlite/datetime@1` value (ADR 254): the instant in UTC, from ISO 8601
 * text with a UTC offset. The range and the millisecond precision are those of a JavaScript `Date`,
 * the codec's value.
 */
export const sqliteDatetimeCanonical = (text: string): string =>
  canonicalDateTime(text, {
    shape: 'instant',
    ownerId: SQLITE_DATETIME_CODEC_ID,
    maxFractionDigits: 3,
    range: { earliest: '-271821-04-20T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
  });

/**
 * Reads the text SQLite holds for an instant. Rejects `Invalid Date` (NaN-time) at every decode
 * ingress so consumers never receive a Date whose downstream operations silently produce NaN.
 */
export function decodeSqliteDatetime(value: string): Date {
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

/** The instant text names, refused when it names none. */
function datetimeOfText(text: string): Date {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return refuseJsonValue(SQLITE_DATETIME_CODEC_ID, 'a date and time string', text);
  }
  return date;
}

/** The text SQLite holds for an instant: what the codec writes for every row, and for a default. */
export function encodeSqliteDatetime(value: Date): string {
  return value.toISOString();
}

export class SqliteDatetimeCodec extends CodecImpl<
  typeof SQLITE_DATETIME_CODEC_ID,
  readonly ['equality', 'order'],
  string,
  Date
> {
  async toWire(value: Date, _ctx: CodecCallContext): Promise<string> {
    return encodeSqliteDatetime(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return decodeSqliteDatetime(wire);
  }
  /** `sqlite/text` holds any text, and a `Date` holds only text that names an instant. */
  fromDataTypeValue(value: DataTypeValue<string>): Date {
    return datetimeOfText(value.value);
  }
  toDataTypeValue(input: Date): DataTypeValue {
    return this.dataTypeValueOf(sqliteDatetimeCanonical(input.toISOString()));
  }
}

/**
 * `sqlite/text` stores this codec's values as text and declares no canonical form for them, so the
 * codec declares it: written text with a UTC offset becomes the instant in UTC.
 */
const datetimeCanonicalForm: ToCanonicalForm = (value) => {
  if (typeof value === 'string') return sqliteDatetimeCanonical(value);
  throw structuredError('CONTRACT.CAST_REFUSED', `Expected text, got ${JSON.stringify(value)}.`, {
    why: 'A SQLite datetime is stored as text.',
    fix: 'Write the date and time as text with a UTC offset, as in "2024-01-01T12:34:56Z".',
  });
};

export class SqliteDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly toCanonicalForm = datetimeCanonicalForm;
  override readonly dataType = sqliteText.id;
  override readonly codecId = SQLITE_DATETIME_CODEC_ID;
  override readonly traits = ['equality', 'order'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteDatetimeCodec {
    return () => new SqliteDatetimeCodec(this, sqliteText);
  }
}

export const sqliteDatetimeDescriptor = new SqliteDatetimeDescriptor();

export const sqliteDatetimeColumn = () =>
  column(sqliteDatetimeDescriptor.factory(), sqliteDatetimeDescriptor.codecId, undefined);

sqliteDatetimeColumn satisfies ColumnHelperFor<SqliteDatetimeDescriptor>;
sqliteDatetimeColumn satisfies ColumnHelperForStrict<SqliteDatetimeDescriptor>;

export class SqliteJsonCodec extends CodecImpl<
  typeof SQLITE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  JsonValue
> {
  async toWire(value: JsonValue, _ctx: CodecCallContext): Promise<string> {
    return JSON.stringify(value);
  }
  async fromWire(wire: string | JsonValue, _ctx: CodecCallContext): Promise<JsonValue> {
    return typeof wire === 'string'
      ? blindCast<JsonValue, 'JSON.parse of stored JSON text yields a JSON value'>(JSON.parse(wire))
      : wire;
  }
  /** `sqlite/text` holds any text, and a document is only text that parses as JSON. */
  fromDataTypeValue(value: DataTypeValue<string>): JsonValue {
    return documentOfText(value.value);
  }
  toDataTypeValue(input: JsonValue): DataTypeValue {
    return this.dataTypeValueOf(canonicalizeJson(input));
  }
}

function parseJsonText(text: string): { readonly value: JsonValue } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** The document JSON text holds, refused when the text is not JSON. */
function documentOfText(text: string): JsonValue {
  const document = parseJsonText(text);
  if (document === undefined) {
    throw sqliteError(
      'RUNTIME.DECODE_FAILED',
      'sqlite/json@1 contract value must be the JSON text of a document',
      { meta: { codecId: SQLITE_JSON_CODEC_ID, received: 'string' } },
    );
  }
  return document.value;
}

/**
 * `sqlite/text` declares no canonical form, so the codec declares the one of its values: the JSON
 * text of the document, with sorted keys and no added whitespace.
 */
const jsonTextCanonicalForm: ToCanonicalForm = (value) => {
  const document = typeof value === 'string' ? parseJsonText(value) : undefined;
  if (document === undefined) {
    throw structuredError(
      'CONTRACT.CAST_REFUSED',
      `Expected the JSON text of a document, got ${JSON.stringify(value)}.`,
      {
        why: 'A SQLite JSON column stores the JSON text of its document.',
        fix: 'Write the document as JSON text, as in {"plan": "free"}.',
      },
    );
  }
  return canonicalizeJson(document.value);
};

/**
 * The column stores the document's JSON text and the canonical form is that text, so the stored
 * value is projected as it is: a string the enclosing JSON constructor embeds as a string.
 */
export class SqliteJsonDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly toCanonicalForm = jsonTextCanonicalForm;
  override readonly dataType = sqliteText.id;
  override readonly codecId = SQLITE_JSON_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteJsonCodec {
    return () => new SqliteJsonCodec(this, sqliteText);
  }
}

export const sqliteJsonDescriptor = new SqliteJsonDescriptor();

export const sqliteJsonColumn = () =>
  column(sqliteJsonDescriptor.factory(), sqliteJsonDescriptor.codecId, undefined);

sqliteJsonColumn satisfies ColumnHelperFor<SqliteJsonDescriptor>;
sqliteJsonColumn satisfies ColumnHelperForStrict<SqliteJsonDescriptor>;

export class SqliteBigintCodec extends CodecImpl<
  typeof SQLITE_BIGINT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint | string,
  bigint
> {
  async toWire(value: bigint, _ctx: CodecCallContext): Promise<number | bigint> {
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
  async fromWire(wire: number | bigint | string, _ctx: CodecCallContext): Promise<bigint> {
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
  fromDataTypeValue(value: DataTypeValue<string>): bigint {
    return BigInt(value.value);
  }
  toDataTypeValue(input: bigint): DataTypeValue {
    return this.dataTypeValueOf(bigintEncodeJson(SQLITE_BIGINT_CODEC_ID, input));
  }
}

export class SqliteBigintDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = sqliteInteger.id;
  override readonly codecId = SQLITE_BIGINT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqliteBigintCodec {
    return () => new SqliteBigintCodec(this, sqliteInteger);
  }
}

export const sqliteBigintDescriptor = new SqliteBigintDescriptor();

export const sqliteBigintColumn = () =>
  column(sqliteBigintDescriptor.factory(), sqliteBigintDescriptor.codecId, undefined);

sqliteBigintColumn satisfies ColumnHelperFor<SqliteBigintDescriptor>;
sqliteBigintColumn satisfies ColumnHelperForStrict<SqliteBigintDescriptor>;

/**
 * A SQLite INTEGER decoded as a JS `number`, for columns whose values stay
 * within the safe integer range ±(2^53 − 1). Both directions guard rather than
 * round: decode (wire and JSON) and encode throw a structured error on
 * out-of-range or non-integral input. The canonical JSON is the decimal text
 * `sqlite/integer` carries, which every codec of that data type shares.
 */
export class SqliteBigintNumberCodec extends CodecImpl<
  typeof SQLITE_BIGINT_NUMBER_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number | bigint | string,
  number
> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return encodableSafeInteger(SQLITE_BIGINT_NUMBER_CODEC_ID, value);
  }
  /**
   * The driver hands an INTEGER over as a `number` or, in safe-integer mode, a
   * `bigint`; a bigint (or decimal text) is range-checked exactly before any
   * conversion to `number`, so an out-of-range value throws rather than rounds.
   */
  async fromWire(wire: number | bigint | string, _ctx: CodecCallContext): Promise<number> {
    if (typeof wire === 'number') {
      return safeIntegerNumber(SQLITE_BIGINT_NUMBER_CODEC_ID, wire, 'RUNTIME.DECODE_FAILED');
    }
    if (typeof wire === 'string' && !DECIMAL_INTEGER.test(wire)) {
      throw sqliteError(
        'RUNTIME.DECODE_FAILED',
        'sqlite/bigintnumber@1 wire value must be a decimal string',
        { meta: { codecId: SQLITE_BIGINT_NUMBER_CODEC_ID, received: wire } },
      );
    }
    return safeIntegerFromBigint(SQLITE_BIGINT_NUMBER_CODEC_ID, BigInt(wire));
  }
  fromDataTypeValue(value: DataTypeValue<string>): number {
    return safeIntegerFromDigitText(SQLITE_BIGINT_NUMBER_CODEC_ID, value.value);
  }
  toDataTypeValue(input: number): DataTypeValue {
    return this.dataTypeValueOf(digitTextOfSafeInteger(SQLITE_BIGINT_NUMBER_CODEC_ID, input));
  }
}

export class SqliteBigintNumberDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return decimalTextJsonProjection(expression);
  }
  override readonly dataType = sqliteInteger.id;
  override readonly codecId = SQLITE_BIGINT_NUMBER_CODEC_ID;
  override readonly traits = ['equality', 'order', 'numeric'] as const;
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return decimalTextNumberLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => SqliteBigintNumberCodec {
    return () => new SqliteBigintNumberCodec(this, sqliteInteger);
  }
}

export const sqliteBigintNumberDescriptor = new SqliteBigintNumberDescriptor();

export const sqliteBigintNumberColumn = () =>
  column(sqliteBigintNumberDescriptor.factory(), sqliteBigintNumberDescriptor.codecId, undefined);

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
