/**
 * The data types this target owns, one per PostgreSQL type its codecs represent: the texts each
 * one is written and reported with, its parameters and their normal form, and the casts that say
 * which other types' values each one takes and how.
 *
 * A cast is declared by the type that receives, never by the source, so there is at most one cast
 * for any pair. Each one is a pure function from the source type's stored form to this type's.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  asFloat,
  asNumeralText,
  assembleDataTypes,
  type Cast,
  castUnchanged,
  type DataType,
  type DataTypeId,
  type DataTypeLookup,
  type DataTypeParams,
  type DataTypeReader,
  type DataTypeSpelling,
  type DateTimeStoredTextOptions,
  dateTimeStoredText,
  decimalTextEqualityKey,
  INT32_RANGE,
  INT64_RANGE,
  readJsonBoolean,
  readJsonFloat,
  readJsonInteger,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
  refuseJsonValue,
  refuseWrongShape,
  storedNumeralText,
} from '@internal/framework-components/codec';
import { type SqlTypeText, sqlDataType, sqlRawDataType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType } from '@internal/sql-schema-ir/types';
import { isStructuredError, structuredError } from '@internal/utils/structured-error';
import { counted, withoutTrailing } from '@internal/utils/text';
import { type as arktype } from 'arktype';
import {
  FLOAT4_MAX,
  fitsCharacterLength,
  fitsFloat4,
  intervalEqualityKey,
  pgIntervalStoredText,
  readPgByteaJson,
  spellPgByteaJson,
  storedUuid,
} from './data-type-values';
import { isoYearText } from './postgres-year-text';
import { quoteIdentifier } from './sql-utils';
import { storedInet } from './stored-inet';

const written = (text: string): SqlTypeText => ({ text, written: true });
const catalog = (text: string): SqlTypeText => ({ text, catalog: true });
const writtenAndCatalog = (text: string): SqlTypeText => ({ text, written: true, catalog: true });
const claimsOnly = (text: string): SqlTypeText => ({ text });

const anyJson: DataTypeReader = (json) => json;
const readString =
  (id: string): DataTypeReader =>
  (json) =>
    readJsonString(id, json);

/** A parameter a type declares as a whole number, or undefined when the column does not set it. */
function integerParam(params: DataTypeParams, name: string): number | undefined {
  const value = params[name];
  return typeof value === 'number' ? value : undefined;
}

/** A decimal numeral: an optional minus sign, digits, and an optional fraction. */
const DECIMAL_NUMERAL_TEXT = /^-?\d+(?:\.\d+)?$/;

/**
 * Numeric text in the form PostgreSQL *prints*, which is narrower than the form it accepts.
 *
 * `numeric` reads `+123`, `.5`, `1.`, `1e5`, `0x1f`, `1_000`, `007`, `-0` and whitespace-padded input, but prints every one of them in a single normalised form — `123`, `0.5`, `1`, `100000`, `31`, `1000`, `7`, `0`. A value in any other form is one the database never returns: `1e5` reads back as `100000`.
 *
 * `NaN`, `Infinity` and `-Infinity` are genuine `numeric` values, which PostgreSQL emits into JSON as strings.
 */
const STORED_NUMERIC_TEXT = /^(?:(?!-0(?:\.0+)?$)-?(?:0|[1-9]\d*)(?:\.\d+)?|NaN|-?Infinity)$/;

/**
 * Whether stored numeric text is a value `numeric(precision, scale)` stores without rounding: a whole number of units of 10^-scale, and at most `precision` digits once counted in those units. A negative scale rounds to tens, hundreds and so on, and a scale above the precision allows only values below 1. NaN fits; an infinity does not.
 */
function fitsNumeric(text: string, precision: number, scale: number): boolean {
  if (text === 'NaN') return true;
  if (text.endsWith('Infinity')) return false;
  const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
  const significantFraction = withoutTrailing(fraction, '0');
  const digits = `${whole}${significantFraction}`.replace(/^0+/, '');
  if (digits === '') return true;
  const shift = scale - significantFraction.length;
  if (shift >= 0) return digits.length + shift <= precision;
  const units = withoutTrailing(digits, '0');
  const droppedZeros = digits.length - units.length;
  if (droppedZeros < -shift) return false;
  return digits.length + shift <= precision;
}

const readNumeric: DataTypeReader = (json, params) => {
  if (typeof json !== 'string' || !STORED_NUMERIC_TEXT.test(json)) {
    const printed =
      typeof json === 'string' && DECIMAL_NUMERAL_TEXT.test(json)
        ? storedNumeralText(json)
        : undefined;
    return refuseJsonValue(
      'pg/numeric',
      printed === undefined ? 'a decimal string' : `"${printed}", as PostgreSQL writes this value`,
      json,
    );
  }
  const precision = integerParam(params, 'precision');
  if (precision === undefined) return json;
  const scale = integerParam(params, 'scale') ?? 0;
  if (!fitsNumeric(json, precision, scale)) {
    return refuseJsonValue(
      'pg/numeric',
      `a decimal string that numeric(${precision}, ${scale}) stores without rounding`,
      json,
    );
  }
  return json;
};

/** A value of `numeric(precision, scale)` is written as PostgreSQL prints it: with exactly `scale` fraction digits, none for a scale of 0 or below. */
const spellNumeric = (json: JsonValue, params: DataTypeParams): JsonValue => {
  const precision = integerParam(params, 'precision');
  if (precision === undefined || typeof json !== 'string' || json === 'NaN') return json;
  const scale = integerParam(params, 'scale') ?? 0;
  const [whole = '', fraction = ''] = json.split('.');
  return scale <= 0 ? whole : `${whole}.${fraction.slice(0, scale).padEnd(scale, '0')}`;
};

const readFloat4: DataTypeReader = (json) => {
  const value = readJsonFloat('pg/float4', json);
  if (Number.isFinite(value) && !fitsFloat4(value)) {
    return refuseJsonValue(
      'pg/float4',
      `a number float4 holds, at most ${FLOAT4_MAX} in magnitude and not so small that it becomes 0, or the text NaN, Infinity or -Infinity`,
      json,
    );
  }
  return json;
};

/** A `character` value is spelled without the spaces that pad it to its length, as the application reads it. */
const spellCharacter = (json: JsonValue): JsonValue =>
  typeof json === 'string' ? withoutTrailing(json, ' ') : json;

/** A `character` column holds its length in characters, and one with no length is `character(1)`; the spaces that pad a value to its length do not count. */
const readCharacter: DataTypeReader = (json, params) => {
  const length = integerParam(params, 'length') ?? 1;
  if (!fitsCharacterLength(readJsonString('pg/char', json), length, true)) {
    return refuseJsonValue(
      'pg/char',
      `a string of at most ${counted(length, 'character')} before any trailing spaces`,
      json,
    );
  }
  return json;
};

/** A `character varying` column with a length holds at most that many characters. */
const readCharacterVarying: DataTypeReader = (json, params) => {
  const length = integerParam(params, 'length');
  const text = readJsonString('pg/varchar', json);
  if (length !== undefined && !fitsCharacterLength(text, length, false)) {
    return refuseJsonValue(
      'pg/varchar',
      `a string of at most ${counted(length, 'character')}`,
      json,
    );
  }
  return json;
};

const BIT_STRING = /^[01]*$/;

/** A `bit` column holds exactly its length in bits, and one with no length is `bit(1)`. */
const readBit: DataTypeReader = (json, params) => {
  const length = integerParam(params, 'length') ?? 1;
  const bits = readJsonMatching('pg/bit', json, BIT_STRING, 'a string of 0 and 1 digits');
  if (bits.length !== length) {
    return refuseJsonValue('pg/bit', `a string of exactly ${counted(length, 'bit')}`, json);
  }
  return json;
};

/** A `bit varying` column with a length holds at most that many bits. */
const readBitVarying: DataTypeReader = (json, params) => {
  const length = integerParam(params, 'length');
  const bits = readJsonMatching('pg/varbit', json, BIT_STRING, 'a string of 0 and 1 digits');
  if (length !== undefined && bits.length > length) {
    return refuseJsonValue('pg/varbit', `a string of at most ${counted(length, 'bit')}`, json);
  }
  return json;
};

/** A `text[]` may hold NULL elements, which PostgreSQL writes as JSON `null`. */
const readTextArray: DataTypeReader = (json) => {
  const expected = 'an array of strings and nulls';
  if (!Array.isArray(json)) return refuseJsonValue('pg/text-array', expected, json);
  for (const entry of json) {
    if (entry !== null && typeof entry !== 'string') {
      return refuseJsonValue('pg/text-array', expected, entry);
    }
  }
  return json;
};

/** Reads a UUID in any spelling PostgreSQL reads; `spellUuid` gives it the one it stores. */
const readUuid: DataTypeReader = (json) =>
  typeof json === 'string' && storedUuid(json) !== undefined
    ? json
    : refuseJsonValue(
        'pg/uuid',
        'a UUID in a spelling PostgreSQL reads: 32 hexadecimal digits in either case, with or without a hyphen after any group of four, optionally in braces',
        json,
      );

/** A UUID is stored as PostgreSQL prints it: lower case, hyphenated 8-4-4-4-12. */
const spellUuid: DataTypeSpelling = (json) =>
  typeof json === 'string' ? (storedUuid(json) ?? json) : json;

/** Reads an address in any spelling PostgreSQL reads; `spellInet` gives it the one it stores. */
const readInet: DataTypeReader = (json) =>
  typeof json === 'string' && storedInet(json) !== undefined
    ? json
    : refuseJsonValue(
        'pg/inet',
        'an IP address or network in a spelling PostgreSQL reads, as in 10.0.0.1 or 2001:db8::/32',
        json,
      );

/** An address is stored as PostgreSQL prints it. */
const spellInet: DataTypeSpelling = (json) =>
  typeof json === 'string' ? (storedInet(json) ?? json) : json;

/** The fraction digits of a second the date, time and interval types hold when a column sets no precision: microseconds. */
const MICROSECOND_DIGITS = 6;

/**
 * A value with more fraction digits of a second than the column's `precision`, or than microseconds when it sets none, which PostgreSQL would round, is refused rather than rounded. Trailing zeros of a fraction are not digits of the value.
 */
function refuseFinerThanPrecision(
  typeId: string,
  json: JsonValue,
  fraction: string | undefined,
  params: DataTypeParams,
): JsonValue {
  const precision = integerParam(params, 'precision') ?? MICROSECOND_DIGITS;
  if (withoutTrailing(fraction ?? '', '0').length <= precision) {
    return json;
  }
  return refuseJsonValue(
    typeId,
    `a value with at most ${counted(precision, 'fraction digit')} of a second, which precision ${precision} holds without rounding`,
    json,
  );
}

/** What `storedText` writes for `text`, or why it cannot read it. */
function storedSpelling(
  storedText: (text: string) => string,
  text: string,
): { readonly stored: string } | { readonly reason: string } {
  try {
    return { stored: storedText(text) };
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') {
      return { reason: error.message };
    }
    throw error;
  }
}

/**
 * Reads a value of a date or time type (ADR 254, "Date and time types") in any spelling its tag reads, and refuses other text. A value with more fraction digits than the column's precision is refused rather than rounded. `spellStoredDateTime` gives the value its one stored spelling.
 */
const readStoredDateTime =
  (
    typeId: string,
    storedText: (text: string) => string,
    description: string,
    fraction: RegExp,
  ): DataTypeReader =>
  (json, params) => {
    if (typeof json !== 'string') return refuseJsonValue(typeId, description, json);
    const spelling = storedSpelling(storedText, json);
    if ('reason' in spelling)
      return refuseJsonValue(typeId, `${description}: ${spelling.reason}`, json);
    refuseFinerThanPrecision(typeId, json, fraction.exec(spelling.stored)?.[1], params);
    return json;
  };

/** The stored spelling of a date or time value: what `storedText` writes. */
const spellStoredDateTime =
  (storedText: (text: string) => string): DataTypeSpelling =>
  (json) => {
    if (typeof json !== 'string') return json;
    const spelling = storedSpelling(storedText, json);
    return 'stored' in spelling ? spelling.stored : json;
  };

const SECONDS_FRACTION = /:\d{2}\.(\d+)/;
const INTERVAL_SECONDS_FRACTION = /\d\.(\d+)S$/;

/** The precision and scale of `numeric`. PostgreSQL 15 and later take a negative scale and one above the precision. */
export const pgNumericParams = arktype({
  'precision?': 'number.integer >= 1 & number.integer <= 1000',
  'scale?': 'number.integer >= -1000 & number.integer <= 1000',
}).narrow(
  (params, ctx) =>
    params.scale === undefined ||
    params.precision !== undefined ||
    ctx.reject({ path: ['scale'], message: 'scale requires a precision' }),
);

/** The length of `char` and `varchar`. */
export const pgCharacterLengthParams = arktype({
  'length?': 'number.integer >= 1 & number.integer <= 10485760',
});

/** The length of `bit` and `bit varying`. */
export const pgBitLengthParams = arktype({
  'length?': 'number.integer >= 1 & number.integer <= 83886080',
});

/** The fractional-second precision of the time, timestamp and interval types. */
export const pgPrecisionParams = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

/** PostgreSQL stores microseconds whether a precision of 6 is declared or omitted, so an omitted precision is 6. */
const withDefaultPrecision = <Params extends { readonly precision?: number }>(params: Params) =>
  params.precision === undefined ? { ...params, precision: 6 } : params;

/** PostgreSQL's catalog prints a precision only where one was declared. */
const precisionAsWritten = <Params extends { readonly precision?: number }>(params: Params) =>
  params;

export const pgEnumParams = arktype({ typeName: 'string > 0' });

/** A type with no parameters that is written and reported by its own name. */
const namedOnly = (
  id: string,
  name: string,
  read: DataTypeReader,
  casts: Readonly<Record<string, Cast>> = {},
) => sqlDataType(id, { texts: [writtenAndCatalog(name)], read, casts });

const withDefaultLength = <Params extends { readonly length?: number }>(params: Params) =>
  params.length === undefined ? { ...params, length: 1 } : params;

export const pgText = namedOnly('pg/text', 'text', readString('pg/text'));
export const pgTextArray = sqlDataType('pg/text-array', { read: readTextArray });

/** The enum's `typeName`: its name in `public` or with no schema, its schema-qualified name elsewhere. */
export function qualifiedEnumName(reported: Pick<ReportedSqlType, 'schema' | 'name'>): string {
  const name = reported.name ?? '';
  return reported.schema === undefined || reported.schema === 'public'
    ? name
    : `${reported.schema}.${name}`;
}

export const pgEnum = sqlDataType('pg/enum', {
  params: pgEnumParams,
  read: readString('pg/enum'),
  claimsKind: 'enum',
  render: ({ typeName }) => {
    const dot = typeName.indexOf('.');
    return dot === -1
      ? quoteIdentifier(typeName)
      : `${quoteIdentifier(typeName.slice(0, dot))}.${quoteIdentifier(typeName.slice(dot + 1))}`;
  },
  fromReported: (reported) => ({ typeName: qualifiedEnumName(reported) }),
});

export const pgInt2 = sqlDataType('pg/int2', {
  texts: [written('int2'), catalog('smallint')],
  read: (json) => readJsonInteger('pg/int2', json, { min: -32768, max: 32767 }),
});

export const pgBool = sqlDataType('pg/bool', {
  texts: [written('bool'), catalog('boolean')],
  read: (json) => readJsonBoolean('pg/bool', json),
});
export const pgJson = namedOnly('pg/json', 'json', anyJson);
export const pgTsquery = namedOnly('pg/tsquery', 'tsquery', readString('pg/tsquery'));

export const pgInt4 = sqlDataType('pg/int4', {
  texts: [written('int4'), catalog('integer'), claimsOnly('int')],
  read: (json) => readJsonInteger('pg/int4', json, INT32_RANGE),
  casts: { [pgInt2.id]: castUnchanged },
});

export const pgInt8 = sqlDataType('pg/int8', {
  texts: [written('int8'), catalog('bigint')],
  read: (json) => {
    readJsonIntegerText('pg/int8', json, INT64_RANGE);
    return json;
  },
  casts: { [pgInt2.id]: asNumeralText, [pgInt4.id]: asNumeralText },
});

export const pgNumeric = sqlDataType('pg/numeric', {
  params: pgNumericParams,
  texts: [
    writtenAndCatalog('numeric'),
    written('numeric({precision})'),
    writtenAndCatalog('numeric({precision},{scale})'),
    claimsOnly('decimal'),
    claimsOnly('decimal({precision})'),
    claimsOnly('decimal({precision},{scale})'),
  ],
  read: readNumeric,
  spell: spellNumeric,
  equalityKey: decimalTextEqualityKey,
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
  casts: {
    [pgInt2.id]: asNumeralText,
    [pgInt4.id]: asNumeralText,
    [pgInt8.id]: castUnchanged,
  },
});

/** `float4` stores a single-precision float, so a magnitude past about 3.4e38, or one it would round to 0, does not fit. */
const asFloat4: Cast = (value) => {
  const converted = asFloat(value);
  if (typeof converted !== 'number' || fitsFloat4(converted)) return converted;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${converted} is out of range: float4 holds a nonzero magnitude from about 1.4e-45 to 3.4e38.`,
    {
      why: 'float4 stores a single-precision float, which overflows past about 3.4e38 and rounds a magnitude below about 1.4e-45 to 0.',
      fix: 'Use a number float4 holds, or a float8 or numeric column.',
    },
  );
};

const floatCastsOf = (cast: Cast): Readonly<Record<string, Cast>> => ({
  [pgInt2.id]: cast,
  [pgInt4.id]: cast,
  [pgInt8.id]: cast,
  [pgNumeric.id]: cast,
});

export const pgFloat4 = sqlDataType('pg/float4', {
  texts: [written('float4'), catalog('real')],
  read: readFloat4,
  casts: floatCastsOf(asFloat4),
});

export const pgFloat8 = sqlDataType('pg/float8', {
  texts: [written('float8'), catalog('double precision'), claimsOnly('float')],
  read: (json) => {
    readJsonFloat('pg/float8', json);
    return json;
  },
  casts: floatCastsOf(asFloat),
});

export const pgJsonb = namedOnly('pg/jsonb', 'jsonb', anyJson, { [pgJson.id]: castUnchanged });

/** Why no enum can use a codec of `pg/jsonb`, which every such codec gives as its `enumRefusal`. */
export const pgJsonbEnumRefusal =
  'A CHECK lists a string member as SQL text, which PostgreSQL reads as the JSON text of a document rather than as a string, and a number member as a number, which PostgreSQL cannot compare with jsonb, so no CHECK can compare a value with the members. No enum can use a jsonb codec; use a text enum instead.';

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: castUnchanged };

export const pgChar = sqlDataType('pg/char', {
  params: pgCharacterLengthParams,
  texts: [
    written('character'),
    writtenAndCatalog('character({length})'),
    claimsOnly('char'),
    claimsOnly('char({length})'),
  ],
  read: readCharacter,
  spell: spellCharacter,
  normalize: withDefaultLength,
  casts: fromText,
});

export const pgVarchar = sqlDataType('pg/varchar', {
  params: pgCharacterLengthParams,
  texts: [
    writtenAndCatalog('character varying'),
    writtenAndCatalog('character varying({length})'),
    claimsOnly('varchar'),
    claimsOnly('varchar({length})'),
  ],
  read: readCharacterVarying,
  casts: fromText,
});

/** Text in any form PostgreSQL reads as a UUID, written the way PostgreSQL writes it, so the contract holds the value the database reports. */
const asUuid: Cast = (value) => {
  if (typeof value !== 'string') return refuseWrongShape(value, 'text');
  const uuid = storedUuid(value);
  if (uuid !== undefined) return uuid;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${JSON.stringify(value)} is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.`,
    {
      why: 'A uuid column takes only text PostgreSQL reads as a UUID.',
      fix: 'Write a UUID such as a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.',
    },
  );
};

export const pgUuid = sqlDataType('pg/uuid', {
  texts: [writtenAndCatalog('uuid')],
  read: readUuid,
  spell: spellUuid,
  casts: { [pgText.id]: asUuid },
});

export const pgBit = sqlDataType('pg/bit', {
  params: pgBitLengthParams,
  texts: [written('bit'), writtenAndCatalog('bit({length})')],
  read: readBit,
  normalize: withDefaultLength,
  casts: fromText,
});

export const pgVarbit = sqlDataType('pg/varbit', {
  params: pgBitLengthParams,
  texts: [
    writtenAndCatalog('bit varying'),
    writtenAndCatalog('bit varying({length})'),
    claimsOnly('varbit'),
    claimsOnly('varbit({length})'),
  ],
  read: readBitVarying,
  casts: fromText,
});

const INFINITIES: ReadonlySet<string> = new Set(['infinity', '-infinity']);

/**
 * The stored form of a date or time type (ADR 254), from ISO 8601 or the text PostgreSQL prints.
 * `infinity` and `-infinity` are values of the types that hold them.
 */
function postgresDateTime(
  options: DateTimeStoredTextOptions,
  holdsInfinity: boolean,
): (text: string) => string {
  return (text) =>
    holdsInfinity && INFINITIES.has(text)
      ? text
      : dateTimeStoredText(isoYearText(text), options, text);
}

/**
 * Each range is what PostgreSQL and every codec of the type hold: PostgreSQL starts at 4714-11-24
 * BC, and the `Temporal` and `Date` codecs end at +275760-09-13.
 */
export const pgDateStoredText = postgresDateTime(
  {
    shape: 'date',
    ownerId: 'pg/date',
    range: { earliest: '-004713-11-24', latest: '+275760-09-13' },
  },
  true,
);
export const pgTimeStoredText = postgresDateTime({ shape: 'time', ownerId: 'pg/time' }, false);
export const pgTimetzStoredText = postgresDateTime(
  { shape: 'timeWithOffset', ownerId: 'pg/timetz', maxOffsetHours: 15 },
  false,
);
export const pgTimestampStoredText = postgresDateTime(
  {
    shape: 'dateTime',
    ownerId: 'pg/timestamp',
    range: { earliest: '-004713-11-24T00:00:00', latest: '+275760-09-13T23:59:59.999999' },
  },
  true,
);
export const pgTimestamptzStoredText = postgresDateTime(
  {
    shape: 'instant',
    ownerId: 'pg/timestamptz',
    range: { earliest: '-004713-11-24T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
  },
  true,
);

/** A cast that takes text and gives the value `read` makes of it. */
const castFromText =
  (read: (text: string) => string): Cast =>
  (value) =>
    typeof value === 'string' ? read(value) : refuseWrongShape(value, 'text');

export const pgTimetz = sqlDataType('pg/timetz', {
  read: readStoredDateTime(
    'pg/timetz',
    pgTimetzStoredText,
    'a time of day with its UTC offset, as in "12:34:56+02:00" or "12:34:56Z"',
    SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgTimetzStoredText),
  params: pgPrecisionParams,
  normalize: withDefaultPrecision,
  catalogParams: precisionAsWritten,
  texts: [
    written('timetz'),
    written('timetz({precision})'),
    catalog('time with time zone'),
    catalog('time({precision}) with time zone'),
  ],
});

export const pgInterval = sqlDataType('pg/interval', {
  read: readStoredDateTime(
    'pg/interval',
    pgIntervalStoredText,
    'an ISO 8601 duration, as in "P1Y2M3DT4H5M6.5S"',
    INTERVAL_SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgIntervalStoredText),
  equalityKey: intervalEqualityKey,
  params: pgPrecisionParams,
  normalize: withDefaultPrecision,
  catalogParams: precisionAsWritten,
  texts: [writtenAndCatalog('interval'), writtenAndCatalog('interval({precision})')],
});

export const pgBytea = sqlDataType('pg/bytea', {
  read: (json) => readPgByteaJson('pg/bytea', json),
  spell: spellPgByteaJson,
  texts: [writtenAndCatalog('bytea')],
});

/** Text PostgreSQL reads as an IP address, written the way PostgreSQL writes it, so the contract holds the value the database reports. */
function pgInetStoredText(text: string): string {
  const inet = storedInet(text);
  if (inet !== undefined) return inet;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${JSON.stringify(text)} is not an IP address: PostgreSQL reads an IPv4 address in decimal octets or an IPv6 address in hexadecimal groups, either optionally followed by / and a prefix length.`,
    {
      why: 'An inet column takes only text PostgreSQL reads as an IP address.',
      fix: 'Write an address such as 192.168.0.1 or 2001:db8::1/64.',
    },
  );
}

export const pgInet = sqlDataType('pg/inet', {
  read: readInet,
  spell: spellInet,
  texts: [writtenAndCatalog('inet')],
  casts: { [pgText.id]: castFromText(pgInetStoredText) },
});

export const pgDate = sqlDataType('pg/date', {
  read: readStoredDateTime(
    'pg/date',
    pgDateStoredText,
    'a date, as in "2024-01-01", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgDateStoredText),
  texts: [writtenAndCatalog('date')],
});

export const pgTime = sqlDataType('pg/time', {
  read: readStoredDateTime(
    'pg/time',
    pgTimeStoredText,
    'a time of day, as in "12:34:56"',
    SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgTimeStoredText),
  params: pgPrecisionParams,
  normalize: withDefaultPrecision,
  catalogParams: precisionAsWritten,
  texts: [
    written('time'),
    written('time({precision})'),
    catalog('time without time zone'),
    catalog('time({precision}) without time zone'),
  ],
});

export const pgTimestamp = sqlDataType('pg/timestamp', {
  read: readStoredDateTime(
    'pg/timestamp',
    pgTimestampStoredText,
    'a date and time of day, as in "2024-01-01T12:34:56", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgTimestampStoredText),
  params: pgPrecisionParams,
  normalize: withDefaultPrecision,
  catalogParams: precisionAsWritten,
  texts: [
    written('timestamp'),
    written('timestamp({precision})'),
    catalog('timestamp without time zone'),
    catalog('timestamp({precision}) without time zone'),
  ],
});

export const pgTimestamptz = sqlDataType('pg/timestamptz', {
  read: readStoredDateTime(
    'pg/timestamptz',
    pgTimestamptzStoredText,
    'an instant in UTC, as in "2024-01-01T00:00:00Z", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  spell: spellStoredDateTime(pgTimestamptzStoredText),
  params: pgPrecisionParams,
  normalize: withDefaultPrecision,
  catalogParams: precisionAsWritten,
  texts: [
    written('timestamptz'),
    written('timestamptz({precision})'),
    catalog('timestamp with time zone'),
    catalog('timestamp({precision}) with time zone'),
  ],
});

/** Every data type this target registers. */
export const postgresDataTypes: readonly DataType[] = [
  pgText,
  pgTextArray,
  pgEnum,
  pgInt2,
  pgBool,
  pgJson,
  pgTsquery,
  pgInt4,
  pgInt8,
  pgNumeric,
  pgFloat4,
  pgFloat8,
  pgJsonb,
  pgChar,
  pgVarchar,
  pgUuid,
  pgInet,
  pgBit,
  pgVarbit,
  pgTimetz,
  pgInterval,
  pgBytea,
  pgDate,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  sqlRawDataType,
];

/** A lookup of the data types this target registers. */
export function createPostgresBuiltinDataTypeLookup(): DataTypeLookup {
  return assembleDataTypes([{ id: 'postgres', dataTypes: postgresDataTypes }]).lookup;
}

/** Postgres's text data types: `text`, `character(n)` and `character varying(n)`. */
export const postgresTextDataTypes: readonly DataTypeId[] = [pgText.id, pgChar.id, pgVarchar.id];
