/**
 * The data types this target owns: the types SQLite stores, plus the two character types a column
 * may be declared with. Each is written by one text and reported by the catalog with that text.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Cast,
  type DataType,
  type DataTypeReader,
  INT64_RANGE,
  readJsonFloat,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { integerTextCanonicalForm } from '@internal/sql-contract/data-type-support';
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

/** Digit text as `real` stores it: the nearest double, as SQLite converts an integer to a real. */
const asReal: Cast = (value) =>
  typeof value === 'string' ? Number(value) : wrongShape(value, 'digit text');

/** A type written and reported by `name` and nothing else. */
const storedAs = (
  id: string,
  name: string,
  read: DataTypeReader,
  casts: Readonly<Record<string, Cast>> = {},
) => sqlDataType(id, { texts: [{ text: name, written: true, catalog: true }], read, casts });

const readText: DataTypeReader = (json) => readJsonString('sqlite/text', json);

const UPPERCASE_HEX = /^(?:[0-9A-F]{2})*$/;

export const sqliteText = storedAs('sqlite/text', 'text', readText);
/** Digit text, which holds every 64-bit integer exactly; SQLite reads an INTEGER default back as a number. */
export const sqliteInteger = sqlDataType('sqlite/integer', {
  texts: [{ text: 'integer', written: true, catalog: true }],
  read: (json) => {
    readJsonIntegerText('sqlite/integer', json, INT64_RANGE);
    return json;
  },
  toCanonicalForm: integerTextCanonicalForm,
  casts: {},
});
/** SQLite cannot store NaN, but a codec refuses it, as ADR 254 places that limit, so the type reads it. */
export const sqliteReal = storedAs(
  'sqlite/real',
  'real',
  (json) => {
    readJsonFloat('sqlite/real', json);
    return json;
  },
  { [sqliteInteger.id]: asReal },
);
export const sqliteBlob = storedAs(
  'sqlite/blob',
  'blob',
  (json) => readJsonMatching('sqlite/blob', json, UPPERCASE_HEX, 'uppercase hexadecimal text'),
  { [sqliteText.id]: unchanged },
);

/** The length of `character` and `character varying`, which SQLite accepts and does not enforce. */
export const sqliteCharacterLengthParams = arktype({ 'length?': 'number.integer >= 1' });

/** A character type is written without its length, so its normal form has none. */
const withoutLength = <Params extends { readonly length?: number }>({
  length: _length,
  ...rest
}: Params) => rest;

export const sqliteCharacter = sqlDataType('sqlite/character', {
  params: sqliteCharacterLengthParams,
  texts: [{ text: 'character', written: true, catalog: true }],
  read: (json) => readJsonString('sqlite/character', json),
  normalize: withoutLength,
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteCharacterVarying = sqlDataType('sqlite/character-varying', {
  params: sqliteCharacterLengthParams,
  texts: [{ text: 'character varying', written: true, catalog: true }],
  read: (json) => readJsonString('sqlite/character-varying', json),
  normalize: withoutLength,
  casts: { [sqliteText.id]: unchanged },
});

/** Every data type this target registers. */
export const sqliteDataTypes: readonly DataType[] = [
  sqliteText,
  sqliteInteger,
  sqliteReal,
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
];
