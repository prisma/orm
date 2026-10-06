/**
 * The data types this target owns: the text a migration writes for each one, its parameters and
 * their normal form, and the casts that say which other types' values each one takes.
 *
 * SQLite's storage classes are shared by several logical types, so the target declares the types it
 * distinguishes rather than one per storage class: `sqlite/integer` and `sqlite/bigint` are
 * distinct although both store as INTEGER, and `sqlite/text`, `sqlite/datetime` and `sqlite/json`
 * are distinct although all store as TEXT. No text is marked as the catalog's, so none of them
 * claims a type the database reports.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { Cast, DataType, ToCanonicalForm } from '@internal/framework-components/codec';
import { numeralText, sqlDataType } from '@internal/sql-contract/data-type';
import {
  canonicalDateTime,
  integerTextCanonicalForm,
} from '@internal/sql-contract/data-type-support';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';

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

/** A type written by `name` and nothing else. */
const writtenAs = (id: string, name: string, casts: Readonly<Record<string, Cast>> = {}) =>
  sqlDataType(id, { texts: [{ text: name, written: true }], casts });

export const sqliteText = writtenAs('sqlite/text', 'text');
export const sqliteJson = writtenAs('sqlite/json', 'text');
export const sqliteInteger = writtenAs('sqlite/integer', 'integer');

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

export const sqliteDatetime = sqlDataType('sqlite/datetime', {
  texts: [{ text: 'text', written: true }],
  toCanonicalForm: datetimeCanonicalForm,
  casts: { [sqliteText.id]: datetimeCanonicalForm },
});

export const sqliteBlob = writtenAs('sqlite/blob', 'blob', { [sqliteText.id]: unchanged });

export const sqliteBigint = sqlDataType('sqlite/bigint', {
  texts: [{ text: 'integer', written: true }],
  toCanonicalForm: integerTextCanonicalForm,
  casts: { [sqliteInteger.id]: asNumeralText },
});

export const sqliteReal = writtenAs('sqlite/real', 'real', {
  [sqliteInteger.id]: asReal,
  [sqliteBigint.id]: asReal,
});

/** The length of `character` and `character varying`, which SQLite accepts and does not enforce. */
export const sqliteCharacterLengthParams = arktype({ 'length?': 'number.integer >= 1' });

/** A character type is written without its length, so its normal form has none. */
const withoutLength = <Params extends { readonly length?: number }>({
  length: _length,
  ...rest
}: Params) => rest;

export const sqliteCharacter = sqlDataType('sqlite/character', {
  params: sqliteCharacterLengthParams,
  texts: [{ text: 'character', written: true }],
  normalize: withoutLength,
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteCharacterVarying = sqlDataType('sqlite/character-varying', {
  params: sqliteCharacterLengthParams,
  texts: [{ text: 'character varying', written: true }],
  normalize: withoutLength,
  casts: { [sqliteText.id]: unchanged },
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
  sqliteCharacter,
  sqliteCharacterVarying,
];
