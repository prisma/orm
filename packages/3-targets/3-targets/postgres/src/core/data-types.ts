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
  isNonFiniteText,
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
  integerTextCanonicalForm,
} from '@internal/sql-contract/data-type-support';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';
import { canonicalUuid, fitsFloat4, pgIntervalCanonical } from './codec-helpers';
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
const namedOnly = (id: string, name: string, casts: Readonly<Record<string, Cast>> = {}) =>
  sqlDataType(id, { texts: [writtenAndCatalog(name)], casts });

const withDefaultLength = <Params extends { readonly length?: number }>(params: Params) =>
  params.length === undefined ? { ...params, length: 1 } : params;

export const pgText = namedOnly('pg/text', 'text');
export const pgTextArray = sqlDataType('pg/text-array', {});

/** The enum's `typeName`: its name in `public` or with no schema, its schema-qualified name elsewhere. */
function qualifiedEnumName(reported: ReportedSqlType): string {
  const name = reported.name ?? '';
  return reported.schema === undefined || reported.schema === 'public'
    ? name
    : `${reported.schema}.${name}`;
}

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

export const pgInt2 = sqlDataType('pg/int2', { texts: [written('int2'), catalog('smallint')] });

export const pgBool = sqlDataType('pg/bool', { texts: [written('bool'), catalog('boolean')] });
export const pgJson = namedOnly('pg/json', 'json');
export const pgTsquery = namedOnly('pg/tsquery', 'tsquery');

export const pgInt4 = sqlDataType('pg/int4', {
  texts: [written('int4'), catalog('integer'), claimsOnly('int')],
  casts: { [pgInt2.id]: unchanged },
});

export const pgInt8 = sqlDataType('pg/int8', {
  texts: [written('int8'), catalog('bigint')],
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
  casts: floatCastsOf(asFloat4),
});

export const pgFloat8 = sqlDataType('pg/float8', {
  texts: [written('float8'), catalog('double precision'), claimsOnly('float')],
  casts: floatCastsOf(asFloat),
});

export const pgJsonb = namedOnly('pg/jsonb', 'jsonb', { [pgJson.id]: unchanged });

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: unchanged };

export const pgChar = sqlDataType('pg/char', {
  params: pgCharacterLengthParams,
  texts: [
    written('character'),
    writtenAndCatalog('character({length})'),
    claimsOnly('char'),
    claimsOnly('char({length})'),
  ],
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
  casts: { [pgText.id]: asUuid },
});
export const pgInet = namedOnly('pg/inet', 'inet', fromText);

export const pgBit = sqlDataType('pg/bit', {
  params: pgBitLengthParams,
  texts: [written('bit'), writtenAndCatalog('bit({length})')],
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

/** A date or time type: its canonical form, and a cast from text that gives it. */
function dateTimeType(
  id: string,
  canonical: (text: string) => string,
  spec: { readonly texts: readonly SqlTypeText[]; readonly params?: typeof pgPrecisionParams },
) {
  const toCanonicalForm = canonicalFromText(canonical);
  return sqlDataType(id, { ...spec, toCanonicalForm, casts: { [pgText.id]: toCanonicalForm } });
}

export const pgTimetz = dateTimeType('pg/timetz', pgTimetzCanonical, {
  params: pgPrecisionParams,
  texts: [
    written('timetz'),
    written('timetz({precision})'),
    catalog('time with time zone'),
    catalog('time({precision}) with time zone'),
  ],
});

export const pgInterval = dateTimeType('pg/interval', pgIntervalCanonical, {
  params: pgPrecisionParams,
  texts: [writtenAndCatalog('interval'), writtenAndCatalog('interval({precision})')],
});

export const pgBytea = namedOnly('pg/bytea', 'bytea', fromText);
export const pgDate = dateTimeType('pg/date', pgDateCanonical, {
  texts: [writtenAndCatalog('date')],
});

export const pgTime = dateTimeType('pg/time', pgTimeCanonical, {
  params: pgPrecisionParams,
  texts: [
    written('time'),
    written('time({precision})'),
    catalog('time without time zone'),
    catalog('time({precision}) without time zone'),
  ],
});

export const pgTimestamp = dateTimeType('pg/timestamp', pgTimestampCanonical, {
  params: pgPrecisionParams,
  texts: [
    written('timestamp'),
    written('timestamp({precision})'),
    catalog('timestamp without time zone'),
    catalog('timestamp({precision}) without time zone'),
  ],
});

export const pgTimestamptz = dateTimeType('pg/timestamptz', pgTimestamptzCanonical, {
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
