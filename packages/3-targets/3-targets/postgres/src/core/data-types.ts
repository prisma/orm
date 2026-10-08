/**
 * The data types this target owns, one per PostgreSQL type its codecs represent: the texts each
 * one is written and reported with, its parameters and their normal form, and the casts that say
 * which other types' values each one takes and how.
 *
 * A cast is declared by the type that receives, never by the source, so there is at most one cast
 * for any pair. Each one is a pure function from the source type's canonical form to this type's.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  assembleDataTypes,
  type Cast,
  type DataType,
  type DataTypeLookup,
  type DataTypeParams,
  type DataTypeReader,
  INT32_RANGE,
  INT64_RANGE,
  isNonFiniteText,
  readJsonBoolean,
  readJsonFloat,
  readJsonInteger,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
  refuseJsonValue,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import {
  numeralText,
  type ReportedSqlType,
  type SqlTypeText,
  sqlDataType,
} from '@internal/sql-contract/data-type';
import {
  type CanonicalDateTimeOptions,
  canonicalDateTime,
  canonicalNumeralText,
  integerTextCanonicalForm,
} from '@internal/sql-contract/data-type-support';
import { isStructuredError, structuredError } from '@internal/utils/structured-error';
import { counted, withoutTrailing } from '@internal/utils/text';
import { type as arktype } from 'arktype';
import { canonicalInet } from './canonical-inet';
import {
  CANONICAL_UUID,
  canonicalUuid,
  FLOAT4_MAX,
  fitsCharacterLength,
  fitsFloat4,
  pgByteaCanonical,
  pgIntervalCanonical,
  readPgByteaJson,
} from './codec-helpers';
import { quoteIdentifier } from './sql-utils';

/** A cast between two types that store the same shape: the value is already the form this type stores. */
const unchanged: Cast = (value) => value;

function wrongShape(value: JsonValue, expected: string): never {
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `Expected ${expected}, got ${JSON.stringify(value)}.`,
    {
      why: 'A cast reads the canonical form of the type it takes values of.',
      fix: 'Hand the cast a value in the shape its source type stores.',
    },
  );
}

/** A whole number as the digit text `int8` and `numeric` store. */
const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : wrongShape(value, 'a number');

/**
 * A number as the floating-point types store it: a JSON number, or one of the three words, which
 * those types keep as text. A magnitude past what a double holds is refused rather than rounded to
 * a word: the database refuses it too, and storing `Infinity` would make a written number
 * indistinguishable from a written `Infinity`.
 */
const asFloat: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return wrongShape(value, 'a number or numeral text');
  if (isNonFiniteText(value)) return value;
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${value} is out of range: no double holds a number that large.`,
    {
      why: 'The floating-point types store a double, which holds magnitudes up to about 1.8e308.',
      fix: 'Use a number a double holds, or a numeric column.',
    },
  );
};

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
const CANONICAL_NUMERIC_TEXT = /^(?:(?!-0(?:\.0+)?$)-?(?:0|[1-9]\d*)(?:\.\d+)?|NaN|-?Infinity)$/;

/**
 * Whether canonical numeric text is a value `numeric(precision, scale)` stores without rounding: a whole number of units of 10^-scale, and at most `precision` digits once counted in those units. A negative scale rounds to tens, hundreds and so on, and a scale above the precision allows only values below 1. NaN fits; an infinity does not.
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
  if (typeof json !== 'string' || !CANONICAL_NUMERIC_TEXT.test(json)) {
    const printed =
      typeof json === 'string' && DECIMAL_NUMERAL_TEXT.test(json)
        ? canonicalNumeralText(json)
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

const readUuid: DataTypeReader = (json) =>
  readJsonMatching(
    'pg/uuid',
    json,
    CANONICAL_UUID,
    'a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12',
  );

const readInet: DataTypeReader = (json) => {
  const printed = typeof json === 'string' ? canonicalInet(json) : undefined;
  if (printed !== undefined && printed === json) return json;
  return refuseJsonValue(
    'pg/inet',
    printed === undefined
      ? 'an IP address as PostgreSQL writes it'
      : `"${printed}", as PostgreSQL writes this address`,
    json,
  );
};

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

/** What `canonical` writes for `text`, or `undefined` for text it cannot read. */
function storedSpelling(canonical: (text: string) => string, text: string): string | undefined {
  try {
    return canonical(text);
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') return undefined;
    throw error;
  }
}

/**
 * Reads the stored form of a date or time type (ADR 254, "Date and time types"), which is the only spelling of a value: other text, such as the text PostgreSQL prints, is refused, naming the stored form when the text names a value. `fraction` finds a value's fraction digits of a second, which the column's precision limits.
 */
const readStoredDateTime =
  (
    typeId: string,
    canonical: (text: string) => string,
    description: string,
    fraction: RegExp,
  ): DataTypeReader =>
  (json, params) => {
    const stored = typeof json === 'string' ? storedSpelling(canonical, json) : undefined;
    if (stored !== json) {
      return refuseJsonValue(
        typeId,
        stored === undefined ? description : `"${stored}", as ${typeId} stores this value`,
        json,
      );
    }
    return refuseFinerThanPrecision(typeId, json, fraction.exec(stored)?.[1], params);
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
function qualifiedEnumName(reported: ReportedSqlType): string {
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
  casts: { [pgInt2.id]: unchanged },
});

export const pgInt8 = sqlDataType('pg/int8', {
  texts: [written('int8'), catalog('bigint')],
  read: (json) => {
    readJsonIntegerText('pg/int8', json, INT64_RANGE);
    return json;
  },
  toCanonicalForm: integerTextCanonicalForm,
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
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
  casts: {
    [pgInt2.id]: asNumeralText,
    [pgInt4.id]: asNumeralText,
    [pgInt8.id]: unchanged,
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

export const pgJsonb = namedOnly('pg/jsonb', 'jsonb', anyJson, { [pgJson.id]: unchanged });

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: unchanged };

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
  if (typeof value !== 'string') return wrongShape(value, 'text');
  const uuid = canonicalUuid(value);
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

const POSTGRES_YEAR = /^(\d{4,6})(-.*?)( BC)?$/;

/**
 * Text PostgreSQL prints, in ISO 8601. A year with a ` BC` suffix becomes the ISO year, one higher
 * than its negative, so 1 BC is 0000 and 44 BC is -000043. A year of five or six digits becomes a
 * signed six-digit year. 0 BC does not exist, so it stays as written and the reader refuses it.
 */
function isoFromPostgresText(text: string): string {
  const match = POSTGRES_YEAR.exec(text);
  if (match === null) return text;
  const [, digits = '', rest = '', bc] = match;
  const year = Number(digits);
  if (bc !== undefined) {
    if (year === 0) return text;
    const astronomical = 1 - year;
    return astronomical === 0 ? `0000${rest}` : `-${String(-astronomical).padStart(6, '0')}${rest}`;
  }
  return digits.length > 4 ? `+${String(year).padStart(6, '0')}${rest}` : text;
}

const INFINITIES: ReadonlySet<string> = new Set(['infinity', '-infinity']);

/**
 * The canonical form of a date or time type (ADR 254), from ISO 8601 or the text PostgreSQL prints.
 * `infinity` and `-infinity` are values of the types that hold them.
 */
function postgresDateTime(
  options: CanonicalDateTimeOptions,
  holdsInfinity: boolean,
): (text: string) => string {
  return (text) =>
    holdsInfinity && INFINITIES.has(text)
      ? text
      : canonicalDateTime(isoFromPostgresText(text), options, text);
}

/**
 * Each range is what PostgreSQL and every codec of the type hold: PostgreSQL starts at 4714-11-24
 * BC, and the `Temporal` and `Date` codecs end at +275760-09-13.
 */
export const pgDateCanonical = postgresDateTime(
  {
    shape: 'date',
    ownerId: 'pg/date',
    range: { earliest: '-004713-11-24', latest: '+275760-09-13' },
  },
  true,
);
export const pgTimeCanonical = postgresDateTime({ shape: 'time', ownerId: 'pg/time' }, false);
export const pgTimetzCanonical = postgresDateTime(
  { shape: 'timeWithOffset', ownerId: 'pg/timetz', maxOffsetHours: 15 },
  false,
);
export const pgTimestampCanonical = postgresDateTime(
  {
    shape: 'dateTime',
    ownerId: 'pg/timestamp',
    range: { earliest: '-004713-11-24T00:00:00', latest: '+275760-09-13T23:59:59.999999' },
  },
  true,
);
export const pgTimestamptzCanonical = postgresDateTime(
  {
    shape: 'instant',
    ownerId: 'pg/timestamptz',
    range: { earliest: '-004713-11-24T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
  },
  true,
);

/** The canonical-form function of a type whose values are written as text. */
const canonicalFromText =
  (canonical: (text: string) => string): ToCanonicalForm =>
  (value) =>
    typeof value === 'string' ? canonical(value) : wrongShape(value, 'text');

/** A type whose canonical form reads text: that canonical form, and the same function as its cast from text. */
function typeCanonicalFromText(
  id: string,
  canonical: (text: string) => string,
  spec: {
    readonly texts: readonly SqlTypeText[];
    readonly params?: typeof pgPrecisionParams;
    readonly read: DataTypeReader;
  },
) {
  const toCanonicalForm = canonicalFromText(canonical);
  return sqlDataType(id, { ...spec, toCanonicalForm, casts: { [pgText.id]: toCanonicalForm } });
}

export const pgTimetz = typeCanonicalFromText('pg/timetz', pgTimetzCanonical, {
  read: readStoredDateTime(
    'pg/timetz',
    pgTimetzCanonical,
    'a time of day with its UTC offset, as in "12:34:56+02:00" or "12:34:56Z"',
    SECONDS_FRACTION,
  ),
  params: pgPrecisionParams,
  texts: [
    written('timetz'),
    written('timetz({precision})'),
    catalog('time with time zone'),
    catalog('time({precision}) with time zone'),
  ],
});

export const pgInterval = typeCanonicalFromText('pg/interval', pgIntervalCanonical, {
  read: readStoredDateTime(
    'pg/interval',
    pgIntervalCanonical,
    'an ISO 8601 duration, as in "P1Y2M3DT4H5M6.5S"',
    INTERVAL_SECONDS_FRACTION,
  ),
  params: pgPrecisionParams,
  texts: [writtenAndCatalog('interval'), writtenAndCatalog('interval({precision})')],
});

export const pgBytea = typeCanonicalFromText('pg/bytea', pgByteaCanonical, {
  read: (json) => readPgByteaJson('pg/bytea', json),
  texts: [writtenAndCatalog('bytea')],
});

/** Text PostgreSQL reads as an IP address, written the way PostgreSQL writes it, so the contract holds the value the database reports. */
function pgInetCanonical(text: string): string {
  const inet = canonicalInet(text);
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

export const pgInet = typeCanonicalFromText('pg/inet', pgInetCanonical, {
  read: readInet,
  texts: [writtenAndCatalog('inet')],
});

export const pgDate = typeCanonicalFromText('pg/date', pgDateCanonical, {
  read: readStoredDateTime(
    'pg/date',
    pgDateCanonical,
    'a date, as in "2024-01-01", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  texts: [writtenAndCatalog('date')],
});

export const pgTime = typeCanonicalFromText('pg/time', pgTimeCanonical, {
  read: readStoredDateTime(
    'pg/time',
    pgTimeCanonical,
    'a time of day, as in "12:34:56"',
    SECONDS_FRACTION,
  ),
  params: pgPrecisionParams,
  texts: [
    written('time'),
    written('time({precision})'),
    catalog('time without time zone'),
    catalog('time({precision}) without time zone'),
  ],
});

export const pgTimestamp = typeCanonicalFromText('pg/timestamp', pgTimestampCanonical, {
  read: readStoredDateTime(
    'pg/timestamp',
    pgTimestampCanonical,
    'a date and time of day, as in "2024-01-01T12:34:56", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  params: pgPrecisionParams,
  texts: [
    written('timestamp'),
    written('timestamp({precision})'),
    catalog('timestamp without time zone'),
    catalog('timestamp({precision}) without time zone'),
  ],
});

export const pgTimestamptz = typeCanonicalFromText('pg/timestamptz', pgTimestamptzCanonical, {
  read: readStoredDateTime(
    'pg/timestamptz',
    pgTimestamptzCanonical,
    'an instant in UTC, as in "2024-01-01T00:00:00Z", or infinity or -infinity',
    SECONDS_FRACTION,
  ),
  params: pgPrecisionParams,
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
];

/** A lookup of the data types this target registers. */
export function createPostgresBuiltinDataTypeLookup(): DataTypeLookup {
  return assembleDataTypes([{ id: 'postgres', dataTypes: postgresDataTypes }]).lookup;
}
