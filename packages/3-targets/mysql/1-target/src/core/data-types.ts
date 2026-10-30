/**
 * The data types this target owns: the MySQL integer, character, date and time types, a duration
 * stored as text, and a native `enum('A','B')` column type whose name is the text MySQL's catalog
 * prints for it.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Cast,
  type DataType,
  type DataTypeId,
  type DataTypeParams,
  type DataTypeReader,
  type DataTypeSpelling,
  dateTimeStoredText,
  INT32_RANGE,
  INT64_RANGE,
  numeralText,
  readJsonInteger,
  readJsonIntegerText,
  readJsonString,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { sqlDataType, sqlRawDataType } from '@internal/sql-contract/data-type';
import { ISO_DURATION_AS_WRITTEN } from '@internal/type-implementations/duration';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype } from 'arktype';
import { mysqlError } from './errors';
import { quoteLiteral } from './sql-utils';

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

const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : wrongShape(value, 'a number');

function integerParam(params: DataTypeParams, name: string): number | undefined {
  const value = params[name];
  return typeof value === 'number' ? value : undefined;
}

/** Text of at most `length` characters, counted as code points, as MySQL counts characters. */
function readTextOfLength(owner: string, json: JsonValue, length: number | undefined): JsonValue {
  const text = readJsonString(owner, json);
  if (length !== undefined && [...text].length > length) {
    return refuseJsonValue(
      owner,
      `a string of at most ${length} ${length === 1 ? 'character' : 'characters'}`,
      json,
    );
  }
  return json;
}

export const mysqlText = sqlDataType('mysql/text', {
  texts: [{ text: 'text', written: true, catalog: true }],
  read: (json) => readJsonString('mysql/text', json),
  casts: {},
});

const fromText: Readonly<Record<string, Cast>> = { [mysqlText.id]: unchanged };

/** A signed 32-bit integer, stored as a JSON number. */
export const mysqlInt = sqlDataType('mysql/int', {
  texts: [{ text: 'int', written: true, catalog: true }, { text: 'integer' }],
  read: (json) => readJsonInteger('mysql/int', json, INT32_RANGE),
  casts: {},
});

/** A signed 64-bit integer, stored as digit text so that no digit is lost. */
export const mysqlBigint = sqlDataType('mysql/bigint', {
  texts: [{ text: 'bigint', written: true, catalog: true }],
  read: (json) => {
    readJsonIntegerText('mysql/bigint', json, INT64_RANGE);
    return json;
  },
  casts: { [mysqlInt.id]: asNumeralText },
});

/** The length of `varchar`, which MySQL requires, up to the largest it accepts. */
export const mysqlVarcharParams = arktype({
  length: 'number.integer >= 1 & number.integer <= 65535',
});

export const mysqlVarchar = sqlDataType('mysql/varchar', {
  params: mysqlVarcharParams,
  texts: [{ text: 'varchar({length})', written: true, catalog: true }],
  read: (json, params) => readTextOfLength('mysql/varchar', json, integerParam(params, 'length')),
  casts: fromText,
});

/** The length of `char`, at most 255; a bare `char` is `char(1)`. */
export const mysqlCharParams = arktype({
  'length?': 'number.integer >= 1 & number.integer <= 255',
});

export const mysqlChar = sqlDataType('mysql/char', {
  params: mysqlCharParams,
  texts: [
    { text: 'char', written: true },
    { text: 'char({length})', written: true, catalog: true },
  ],
  read: (json, params) => readTextOfLength('mysql/char', json, integerParam(params, 'length') ?? 1),
  normalize: (params) => (params.length === undefined ? { ...params, length: 1 } : params),
  casts: fromText,
});

/** The fractional-second precision of `datetime`, `timestamp` and `time`, 0 to 6; MySQL prints a precision of 0 as the bare type. */
export const mysqlDatetimeParams = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
});

/** The years MySQL holds in a `datetime` and a `date`. */
export const MYSQL_DATETIME_RANGE = {
  earliest: '1000-01-01T00:00:00',
  latest: '9999-12-31T23:59:59.999999',
} as const;

/** The instants MySQL holds in a `timestamp`, in UTC. */
export const MYSQL_TIMESTAMP_RANGE = {
  earliest: '1970-01-01T00:00:01',
  latest: '2038-01-19T03:14:07.999999',
} as const;

const MYSQL_DATE_RANGE = { earliest: '1000-01-01', latest: '9999-12-31' } as const;

/**
 * The value of `mysql/datetime`: a date and time without a time zone, ISO 8601 text with a `T` and no trailing zeros in the fraction, within MySQL's range. Throws `CONTRACT.CAST_REFUSED` for text that names no such date and time.
 */
export function mysqlDatetimeText(text: string): string {
  return dateTimeStoredText(text, {
    shape: 'dateTime',
    ownerId: 'mysql/datetime',
    range: MYSQL_DATETIME_RANGE,
  });
}

/**
 * The value of `mysql/timestamp`: the UTC date and time of an instant from 1970-01-01T00:00:01 to 2038-01-19T03:14:07.999999, in the form `mysql/datetime` stores. Throws `CONTRACT.CAST_REFUSED` for text that names no such date and time.
 */
export function mysqlTimestampText(text: string): string {
  return dateTimeStoredText(text, {
    shape: 'dateTime',
    ownerId: 'mysql/timestamp',
    range: MYSQL_TIMESTAMP_RANGE,
  });
}

/** The value of `mysql/date`: a calendar date as ISO 8601 text, `2024-02-29`, in the years 1000 to 9999. Throws `CONTRACT.CAST_REFUSED` for other text. */
export function mysqlDateText(text: string): string {
  return dateTimeStoredText(text, {
    shape: 'date',
    ownerId: 'mysql/date',
    range: MYSQL_DATE_RANGE,
  });
}

/**
 * The value of `mysql/time`: a time of day from 00:00:00 to 23:59:59.999999, ISO 8601 text with no trailing zeros in the fraction. MySQL's `time` also holds a negative time and hours past 23, which name no time of day, so they are refused. Throws `CONTRACT.CAST_REFUSED` for other text.
 */
export function mysqlTimeText(text: string): string {
  return dateTimeStoredText(text, { shape: 'time', ownerId: 'mysql/time' });
}

/** The value of `mysql/duration`: an ISO 8601 duration, stored as written. Throws `CONTRACT.CAST_REFUSED` for other text. */
export function mysqlDurationText(text: string): string {
  if (ISO_DURATION_AS_WRITTEN.test(text)) return text;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `mysql/duration cannot read "${text}". Write an ISO 8601 duration, as in "PT1H30M".`,
    {
      why: 'mysql/duration holds an ISO 8601 duration as Temporal.Duration writes it: an optional sign, P, then years, months, weeks and days, then T and hours, minutes and seconds. A sign on each component instead is read too.',
      fix: 'Write the duration in ISO 8601, as in "P1Y2M3DT4H5M6.5S".',
    },
  );
}

/** What `stored` writes for `text`, or `undefined` when `stored` refuses it. */
function storedOrUndefined(stored: (text: string) => string, text: string): string | undefined {
  try {
    return stored(text);
  } catch {
    return undefined;
  }
}

function readStored(
  id: string,
  stored: (text: string) => string,
  expected: string,
): DataTypeReader {
  return (json) =>
    typeof json === 'string' && storedOrUndefined(stored, json) !== undefined
      ? json
      : refuseJsonValue(id, expected, json);
}

function spellStored(stored: (text: string) => string): DataTypeSpelling {
  return (json) => (typeof json === 'string' ? (storedOrUndefined(stored, json) ?? json) : json);
}

type PrecisionParams = typeof mysqlDatetimeParams.infer;

const withoutZeroPrecision = ({ precision, ...rest }: PrecisionParams): PrecisionParams =>
  precision === 0 ? rest : { ...rest, ...ifDefined('precision', precision) };

export const mysqlDatetime = sqlDataType('mysql/datetime', {
  params: mysqlDatetimeParams,
  texts: [
    { text: 'datetime', written: true, catalog: true },
    { text: 'datetime({precision})', written: true, catalog: true },
  ],
  read: readStored(
    'mysql/datetime',
    mysqlDatetimeText,
    'ISO 8601 date and time text without a UTC offset, as in "2024-01-01T00:00:00"',
  ),
  spell: spellStored(mysqlDatetimeText),
  normalize: withoutZeroPrecision,
  casts: {},
});

/** An instant from 1970 to 2038, which MySQL converts between the session's time zone and UTC; every session runs in UTC. */
export const mysqlTimestamp = sqlDataType('mysql/timestamp', {
  params: mysqlDatetimeParams,
  texts: [
    { text: 'timestamp', written: true, catalog: true },
    { text: 'timestamp({precision})', written: true, catalog: true },
  ],
  read: readStored(
    'mysql/timestamp',
    mysqlTimestampText,
    'ISO 8601 date and time text in UTC without a UTC offset, from 1970-01-01T00:00:01 to 2038-01-19T03:14:07.999999',
  ),
  spell: spellStored(mysqlTimestampText),
  normalize: withoutZeroPrecision,
  casts: {},
});

export const mysqlDate = sqlDataType('mysql/date', {
  texts: [{ text: 'date', written: true, catalog: true }],
  read: readStored('mysql/date', mysqlDateText, 'ISO 8601 date text, as in "2024-02-29"'),
  spell: spellStored(mysqlDateText),
  casts: {},
});

export const mysqlTime = sqlDataType('mysql/time', {
  params: mysqlDatetimeParams,
  texts: [
    { text: 'time', written: true, catalog: true },
    { text: 'time({precision})', written: true, catalog: true },
  ],
  read: readStored(
    'mysql/time',
    mysqlTimeText,
    'ISO 8601 time of day text from 00:00:00 to 23:59:59.999999, as in "09:30:00"',
  ),
  spell: spellStored(mysqlTimeText),
  normalize: withoutZeroPrecision,
  casts: {},
});

/** A length of time, stored in a `text` column as the ISO 8601 duration it was written as, `PT1H30M`. MySQL has no interval type, and equal durations can be written differently, `P1D` and `PT24H`, so a duration keeps its spelling. ADR 315. */
export const mysqlDuration = sqlDataType('mysql/duration', {
  storedAs: mysqlText.id,
  read: readStored('mysql/duration', mysqlDurationText, 'an ISO 8601 duration, as in "PT1H30M"'),
  casts: {},
});

/** The members of a native enum column, in the order they are declared. */
export const mysqlEnumParams = arktype({
  'values?': 'string[]',
});

/** `enum('A','B')`, the text MySQL's catalog prints for the column type, with each member a quoted literal. */
export function renderMysqlEnumType(values: readonly string[] | undefined): string {
  if (values === undefined || values.length === 0) {
    throw mysqlError(
      'CONTRACT.TYPE_PARAMS_INVALID',
      'A MySQL enum column type needs at least one member.',
      {
        why: 'A native enum column is written with its members, and this column has none.',
        fix: 'Type the column with a PSL enum or an enumType() that declares its members.',
        meta: { dataType: 'mysql/enum' },
      },
    );
  }
  return `enum(${values.map(quoteLiteral).join(',')})`;
}

const readEnumMember: DataTypeReader = (json, params) => {
  const member = readJsonString('mysql/enum', json);
  const values = params['values'];
  if (Array.isArray(values) && !values.includes(member)) {
    return refuseJsonValue('mysql/enum', `one of the members ${values.join(', ')}`, json);
  }
  return json;
};

/**
 * A native MySQL enum. Its name is the catalog text `enum('A','B')`, so `db verify` compares the members and their order with what MySQL reports (ADR 273). A column's members are its value set's, written into its parameters by the target's namespace (see `mysql-database.ts`).
 */
export const mysqlEnum = sqlDataType('mysql/enum', {
  params: mysqlEnumParams,
  nameIsCatalogText: true,
  render: ({ values }) => renderMysqlEnumType(values),
  read: readEnumMember,
  casts: fromText,
});

/** Every data type this target registers. */
export const mysqlDataTypes: readonly DataType[] = [
  mysqlText,
  mysqlInt,
  mysqlBigint,
  mysqlVarchar,
  mysqlChar,
  mysqlDatetime,
  mysqlTimestamp,
  mysqlDate,
  mysqlTime,
  mysqlDuration,
  mysqlEnum,
  sqlRawDataType,
];

/** MySQL's text data types, which a SQL discriminator column may have. */
export const mysqlTextDataTypes: readonly DataTypeId[] = [
  mysqlText.id,
  mysqlVarchar.id,
  mysqlChar.id,
];
