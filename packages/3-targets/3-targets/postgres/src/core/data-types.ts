/**
 * The data types this target owns, one per PostgreSQL type its codecs represent, with the casts
 * that say which other types' values each one takes and how.
 *
 * A cast is declared by the type that receives, never by the source, so there is at most one cast
 * for any pair. Each one is a pure function from the source type's canonical form to this type's.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { type Cast, type DataType, dataType } from '@internal/framework-components/codec';
import { isNonFiniteText, numeralText } from '@internal/sql-relational-core/ast';
import { structuredError } from '@internal/utils/structured-error';

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

export const pgText: DataType = dataType('pg/text', {});
export const pgTextArray: DataType = dataType('pg/text-array', {});
export const pgEnum: DataType = dataType('pg/enum', {});
export const pgInt2: DataType = dataType('pg/int2', {});
export const pgBool: DataType = dataType('pg/bool', {});
export const pgJson: DataType = dataType('pg/json', {});
export const pgTsquery: DataType = dataType('pg/tsquery', {});

export const pgInt4: DataType = dataType('pg/int4', { casts: { [pgInt2.id]: unchanged } });

export const pgInt8: DataType = dataType('pg/int8', {
  casts: { [pgInt2.id]: asNumeralText, [pgInt4.id]: asNumeralText },
});

export const pgNumeric: DataType = dataType('pg/numeric', {
  casts: {
    [pgInt2.id]: asNumeralText,
    [pgInt4.id]: asNumeralText,
    [pgInt8.id]: unchanged,
  },
});

/** `float4` stores a single-precision float, so a magnitude past about 3.4e38 does not fit. */
const asFloat4: Cast = (value) => {
  const converted = asFloat(value);
  if (typeof converted !== 'number' || Number.isFinite(Math.fround(converted))) return converted;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${converted} is out of range: no float4 holds a number that large.`,
    {
      why: 'float4 stores a single-precision float, which holds magnitudes up to about 3.4e38.',
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

export const pgFloat4: DataType = dataType('pg/float4', { casts: floatCastsOf(asFloat4) });
export const pgFloat8: DataType = dataType('pg/float8', { casts: floatCastsOf(asFloat) });

export const pgJsonb: DataType = dataType('pg/jsonb', { casts: { [pgJson.id]: unchanged } });

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: unchanged };

export const pgChar: DataType = dataType('pg/char', { casts: fromText });
export const pgVarchar: DataType = dataType('pg/varchar', { casts: fromText });
export const pgUuid: DataType = dataType('pg/uuid', { casts: fromText });
export const pgInet: DataType = dataType('pg/inet', { casts: fromText });
export const pgBit: DataType = dataType('pg/bit', { casts: fromText });
export const pgVarbit: DataType = dataType('pg/varbit', { casts: fromText });
export const pgTimetz: DataType = dataType('pg/timetz', { casts: fromText });
export const pgInterval: DataType = dataType('pg/interval', { casts: fromText });
export const pgBytea: DataType = dataType('pg/bytea', { casts: fromText });
export const pgDate: DataType = dataType('pg/date', { casts: fromText });
export const pgTime: DataType = dataType('pg/time', { casts: fromText });
export const pgTimestamp: DataType = dataType('pg/timestamp', { casts: fromText });
export const pgTimestamptz: DataType = dataType('pg/timestamptz', { casts: fromText });

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
