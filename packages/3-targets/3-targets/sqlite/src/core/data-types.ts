/**
 * The data types this target owns, with the casts that say which other types' values each one takes.
 *
 * SQLite's storage classes are shared by several logical types, so the target declares the types it
 * distinguishes rather than one per storage class: `sqlite/integer` and `sqlite/bigint` are
 * distinct although both store as INTEGER, and `sqlite/text`, `sqlite/datetime` and `sqlite/json`
 * are distinct although all store as TEXT.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { type Cast, type DataType, dataType } from '@internal/framework-components/codec';
import { numeralText } from '@internal/sql-relational-core/ast';
import { structuredError } from '@internal/utils/structured-error';

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

const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : wrongShape(value, 'a number');

/**
 * A number as `real` stores it. A magnitude past what a double holds is refused rather than
 * rounded, for the reason the target's other numeric casts give.
 */
const asReal: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return wrongShape(value, 'a number or digit text');
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${value} is out of range: no double holds a number that large.`,
    {
      why: 'A real stores a double, which holds magnitudes up to about 1.8e308.',
      fix: 'Use a number a double holds.',
    },
  );
};

export const sqliteText: DataType = dataType('sqlite/text', {});
export const sqliteJson: DataType = dataType('sqlite/json', {});
export const sqliteInteger: DataType = dataType('sqlite/integer', {});

export const sqliteDatetime: DataType = dataType('sqlite/datetime', {
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteBlob: DataType = dataType('sqlite/blob', {
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteBigint: DataType = dataType('sqlite/bigint', {
  casts: { [sqliteInteger.id]: asNumeralText },
});

export const sqliteReal: DataType = dataType('sqlite/real', {
  casts: { [sqliteInteger.id]: asReal, [sqliteBigint.id]: asReal },
});

/** Every data type this target registers. */
export const sqliteDataTypes: readonly DataType[] = [
  sqliteText,
  sqliteJson,
  sqliteInteger,
  sqliteDatetime,
  sqliteBlob,
  sqliteBigint,
  sqliteReal,
];
