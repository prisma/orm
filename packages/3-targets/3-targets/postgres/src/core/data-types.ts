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

/** A cast between two types that store the same shape: the value is already the form this type stores. */
const unchanged: Cast = (value) => value;

/** A whole number as the digit text `int8` and `numeral` store. */
const asNumeralText: Cast = (value) => (typeof value === 'number' ? numeralText(value) : value);

/**
 * A number as the floating-point types store it: a JSON number, or one of the three words when the
 * magnitude is past what a double holds.
 */
const asFloat: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  if (isNonFiniteText(value)) return value;
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  return value.startsWith('-') ? '-Infinity' : 'Infinity';
};

export const pgText: DataType = dataType('pg/text', {});
export const pgTextArray: DataType = dataType('pg/text-array', {});
export const pgEnum: DataType = dataType('pg/enum', {});
export const pgInt2: DataType = dataType('pg/int2', {});
export const pgBool: DataType = dataType('pg/bool', {});
export const pgJson: DataType = dataType('pg/json', {});

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

const floatCasts: Readonly<Record<string, Cast>> = {
  [pgInt2.id]: asFloat,
  [pgInt4.id]: asFloat,
  [pgInt8.id]: asFloat,
  [pgNumeric.id]: asFloat,
};

export const pgFloat4: DataType = dataType('pg/float4', { casts: floatCasts });
export const pgFloat8: DataType = dataType('pg/float8', { casts: floatCasts });

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

/** The value a cast may be handed, for readers of the table above. */
export type PostgresCanonicalValue = JsonValue;
