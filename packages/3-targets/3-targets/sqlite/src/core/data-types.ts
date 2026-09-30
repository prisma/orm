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
import {
  type Cast,
  type DataType,
  dataType,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import { canonicalDateTime, numeralText } from '@internal/sql-relational-core/ast';
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

/**
 * The canonical form of `sqlite/datetime` (ADR 254), from ISO 8601 text with a UTC offset. The range
 * and the millisecond precision are those of a JavaScript `Date`, the codec's value.
 */
export const sqliteDatetimeCanonical = (text: string): string =>
  canonicalDateTime(text, {
    shape: 'instant',
    dataTypeId: 'sqlite/datetime',
    maxFractionDigits: 3,
    range: { earliest: '-271821-04-20T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
  });

const datetimeCanonicalForm: ToCanonicalForm = (value) =>
  typeof value === 'string' ? sqliteDatetimeCanonical(value) : wrongShape(value, 'text');

export const sqliteDatetime: DataType = dataType('sqlite/datetime', {
  toCanonicalForm: datetimeCanonicalForm,
  casts: { [sqliteText.id]: datetimeCanonicalForm },
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
