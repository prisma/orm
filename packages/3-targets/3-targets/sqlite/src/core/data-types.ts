/**
 * The data types this target owns: the types SQLite stores, the two character types a column may be
 * declared with, each written by one text and reported by the catalog with that text, and the
 * datetime and JSON types, which are stored as text.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Cast,
  type DataType,
  type DataTypeReader,
  type DataTypeSpelling,
  INT64_RANGE,
  readJsonFloat,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { dateTimeStoredText } from '@internal/sql-contract/data-type-support';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';

const unchanged: Cast = (value) => value;

function wrongShape(value: JsonValue, expected: string): never {
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `Expected ${expected}, got ${JSON.stringify(value)}.`,
    {
      why: 'A cast reads the stored form of the type it takes values of.',
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
  {},
);

const HEX_TEXT = /^(?:[0-9A-Fa-f]{2})*$/;

/** The upper-case hex `sqlite/blob` stores for the hex text a `blob` tag holds, `68656c6c6f`. */
export function sqliteBlobFromHexText(text: string): string {
  if (!HEX_TEXT.test(text)) {
    throw structuredError(
      'CONTRACT.CAST_REFUSED',
      `"${text}" is not hex text: write two hexadecimal digits for each byte, as in blob\`68656c6c6f\`.`,
      {
        why: 'The blob tag reads bytes as hex text, two digits for each byte.',
        fix: 'Write the bytes in hex, as in blob`68656c6c6f`.',
      },
    );
  }
  return text.toUpperCase();
}

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

const DATETIME_FRACTION = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * The value of `sqlite/datetime` (ADR 254): the instant in UTC with exactly three fraction digits, the text `toISOString()` writes for every row, from ISO 8601 text with a UTC offset. The range and the millisecond precision are those of a JavaScript `Date`, the codec's value. Throws `CONTRACT.CAST_REFUSED` for text that names no instant the type holds.
 */
export function sqliteDatetimeText(text: string): string {
  const stored = dateTimeStoredText(text, {
    shape: 'instant',
    ownerId: 'sqlite/datetime',
    maxFractionDigits: 3,
    range: { earliest: '-271821-04-20T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
  });
  const match = DATETIME_FRACTION.exec(stored);
  return match === null ? stored : `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
}

/** What `sqliteDatetimeText` writes for `text`, or `undefined` when it names no instant the type holds. */
function storedDatetime(text: string): string | undefined {
  try {
    return sqliteDatetimeText(text);
  } catch {
    return undefined;
  }
}

/** Reads an instant in any spelling the `datetime` tag reads; `spellDatetime` gives it the one it stores. */
const readDatetime: DataTypeReader = (json) =>
  typeof json === 'string' && storedDatetime(json) !== undefined
    ? json
    : refuseJsonValue(
        'sqlite/datetime',
        'ISO 8601 date and time text with a UTC offset and at most three fraction digits, as in "2024-01-01T00:00:00Z"',
        json,
      );

/** An instant is stored in UTC with three fraction digits. */
const spellDatetime: DataTypeSpelling = (json) =>
  typeof json === 'string' ? (storedDatetime(json) ?? json) : json;

/** The document JSON text holds, or `undefined` when the text is not JSON. */
function documentOf(text: string): { readonly value: JsonValue } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** Reads the JSON text of a document, in any spelling; `spellJson` gives it the one it stores. */
const readJson: DataTypeReader = (json) =>
  typeof json === 'string' && documentOf(json) !== undefined
    ? json
    : refuseJsonValue('sqlite/json', 'the JSON text of a document', json);

/** A document is stored as its JSON text with sorted keys and no added whitespace. */
const spellJson: DataTypeSpelling = (json) => {
  const document = typeof json === 'string' ? documentOf(json) : undefined;
  return document === undefined ? json : canonicalizeJson(document.value);
};

/** An instant, stored as text in the form `toISOString()` writes. */
export const sqliteDatetime = sqlDataType('sqlite/datetime', {
  storedAs: sqliteText.id,
  read: readDatetime,
  spell: spellDatetime,
});

/** A JSON document, stored as its JSON text with sorted keys and no added whitespace. A column declared `JSON` would have numeric affinity and store the document `"42"` as the integer 42. */
export const sqliteJson = sqlDataType('sqlite/json', {
  storedAs: sqliteText.id,
  read: readJson,
  spell: spellJson,
});

/** Every data type this target registers. */
export const sqliteDataTypes: readonly DataType[] = [
  sqliteText,
  sqliteInteger,
  sqliteReal,
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteDatetime,
  sqliteJson,
];
