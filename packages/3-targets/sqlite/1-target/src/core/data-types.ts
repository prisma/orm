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
  castUnchanged,
  type DataType,
  type DataTypeId,
  type DataTypeReader,
  type DataTypeSpelling,
  dateTimeStoredText,
  INT64_RANGE,
  isoDateStringText,
  readJsonFloat,
  readJsonIntegerText,
  readJsonMatching,
  readJsonString,
  refuseJsonValue,
  refuseWrongShape,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { sqlDataType, sqlRawDataType } from '@internal/sql-contract/data-type';
import { ISO_DURATION } from '@internal/type-implementations/duration';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';

/** Digit text as `real` stores it: the nearest double, as SQLite converts an integer to a real. */
const asReal: Cast = (value) =>
  typeof value === 'string' ? Number(value) : refuseWrongShape(value, 'digit text');

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

/** The largest string length SQLite allows at compile time: `SQLITE_MAX_LENGTH`'s hard limit. */
const SQLITE_MAX_LENGTH = 2147483647;

/** The length of `character` and `character varying`, which SQLite accepts and does not enforce, up to SQLite's largest string length, so a double holds every accepted length exactly. */
export const sqliteCharacterLengthParams = arktype({
  'length?': `number.integer >= 1 & number.integer <= ${SQLITE_MAX_LENGTH}`,
});

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
  casts: { [sqliteText.id]: castUnchanged },
});

export const sqliteCharacterVarying = sqlDataType('sqlite/character-varying', {
  params: sqliteCharacterLengthParams,
  texts: [{ text: 'character varying', written: true, catalog: true }],
  read: (json) => readJsonString('sqlite/character-varying', json),
  normalize: withoutLength,
  casts: { [sqliteText.id]: castUnchanged },
});

/**
 * The value of `sqlite/datetime` (ADR 254): the text `toISOString()` writes for every row. The range and the millisecond precision are those of a JavaScript `Date`, the codec's value.
 */
export const sqliteDatetimeText = (text: string): string =>
  isoDateStringText(text, 'sqlite/datetime');

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

/** The fraction of `text` with any zeros past its third digit removed, so `09:30:00.500000` is the millisecond it names. */
function withoutZerosBelowAMillisecond(text: string): string {
  return text.replace(/(\.\d{3})0+(?!\d)/, '$1');
}

/** The fraction of stored text padded to exactly three digits, as `toISOString()` and SQLite's `%f` write it. */
function withThreeFractionDigits(text: string): string {
  return text.replace(
    /(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(?=Z?$)/,
    (_whole, clock: string, fraction?: string) => `${clock}.${(fraction ?? '').padEnd(3, '0')}`,
  );
}

/** The years SQLite's date and time functions read, which are also the years whose text sorts in date order. */
const SQLITE_DATE_RANGE = { earliest: '0000-01-01', latest: '9999-12-31' } as const;

/**
 * The value of `sqlite/date`: a calendar date as ISO 8601 text, `2024-02-29`, in the years `0000` to `9999` that SQLite's `date()` reads. Throws `CONTRACT.CAST_REFUSED` for text that names no such date.
 */
export function sqliteDateText(text: string): string {
  return dateTimeStoredText(text, {
    shape: 'date',
    ownerId: 'sqlite/date',
    range: SQLITE_DATE_RANGE,
  });
}

/**
 * The value of `sqlite/time`: a time of day with exactly three fraction digits, `09:30:00.000`, as SQLite's `strftime('%H:%M:%f')` writes it, so the text sorts in the order of the times. Zeros past the third fraction digit are dropped; any other digit there is refused. Throws `CONTRACT.CAST_REFUSED` for text that names no such time.
 */
export function sqliteTimeText(text: string): string {
  return withThreeFractionDigits(
    dateTimeStoredText(
      withoutZerosBelowAMillisecond(text),
      { shape: 'time', ownerId: 'sqlite/time', maxFractionDigits: 3 },
      text,
    ),
  );
}

/**
 * An instant as `sqlite/datetime` stores it, from ISO 8601 text with a UTC offset in which zeros past the third fraction digit are dropped. Throws `CONTRACT.CAST_REFUSED` for text that names no instant the type holds, including text with a digit below a millisecond.
 */
export function sqliteDatetimeTextAtMilliseconds(text: string): string {
  return sqliteDatetimeText(withoutZerosBelowAMillisecond(text));
}

/** The value of `sqlite/duration`: an ISO 8601 duration, stored as written. Throws `CONTRACT.CAST_REFUSED` for other text. */
export function sqliteDurationText(text: string): string {
  if (ISO_DURATION.test(text)) return text;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `sqlite/duration cannot read "${text}". Write an ISO 8601 duration, as in "PT1H30M".`,
    {
      why: 'sqlite/duration holds an ISO 8601 duration: P, then years, months and days, then T and hours, minutes and seconds.',
      fix: 'Write the duration in ISO 8601, as in "P1Y2M3DT4H5M6.5S".',
    },
  );
}

/** What `read` writes for `text`, or `undefined` when `read` refuses it. */
function storedOrUndefined(read: (text: string) => string, text: string): string | undefined {
  try {
    return read(text);
  } catch {
    return undefined;
  }
}

/** A text data type stored in one form for each value: it reads any spelling `stored` takes and spells each value in the form `stored` writes. */
function storedTextDataType(
  id: string,
  stored: (text: string) => string,
  expected: string,
  options: { readonly respell: boolean },
) {
  const read: DataTypeReader = (json) =>
    typeof json === 'string' && storedOrUndefined(stored, json) !== undefined
      ? json
      : refuseJsonValue(id, expected, json);
  const spell: DataTypeSpelling = (json) =>
    typeof json === 'string' ? (storedOrUndefined(stored, json) ?? json) : json;
  return sqlDataType(id, {
    storedAs: sqliteText.id,
    read,
    ...(options.respell ? { spell } : {}),
  });
}

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

/** A calendar date, stored as text in the form `2024-02-29`. */
export const sqliteDate = storedTextDataType(
  'sqlite/date',
  sqliteDateText,
  'ISO 8601 date text, as in "2024-02-29"',
  { respell: true },
);

/** A time of day, stored as text with three fraction digits, `09:30:00.000`. */
export const sqliteTime = storedTextDataType(
  'sqlite/time',
  sqliteTimeText,
  'ISO 8601 time of day text with at most three fraction digits, as in "09:30:00"',
  { respell: true },
);

/** A length of time, stored as the ISO 8601 duration it was written as, `PT1H30M`. Equal durations can be written differently, `P1D` and `PT24H`, so a duration keeps its spelling. */
export const sqliteDuration = storedTextDataType(
  'sqlite/duration',
  sqliteDurationText,
  'an ISO 8601 duration, as in "PT1H30M"',
  { respell: false },
);

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
  sqliteDate,
  sqliteTime,
  sqliteDuration,
  sqliteJson,
  sqlRawDataType,
];

/** SQLite's text data types: `text`, `character(n)` and `character varying(n)`. */
export const sqliteTextDataTypes: readonly DataTypeId[] = [
  sqliteText.id,
  sqliteCharacter.id,
  sqliteCharacterVarying.id,
];
