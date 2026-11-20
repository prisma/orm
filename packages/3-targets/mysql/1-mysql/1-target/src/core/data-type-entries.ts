/**
 * How PSL writes a value of each of this target's data types. A quoted string is `mysql/text`; `true` and `false` are `mysql/boolean`; a whole number is the narrowest of `mysql/int` and `mysql/bigint` that holds it, and any other number, a larger whole number or one with digits after the point, is `mysql/decimal`. The `longblob` tag yields bytes from hex text and the `json` tag a JSON document. The `datetime`, `timestamp`, `date`, `time` and `duration` tags yield the data types of those names, each read into the value its type stores. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  numeralText,
  parseJsonText,
  printJsonText,
  signedRange,
} from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import {
  mysqlBigint,
  mysqlBoolean,
  mysqlDate,
  mysqlDateText,
  mysqlDatetime,
  mysqlDatetimeText,
  mysqlDecimal,
  mysqlDuration,
  mysqlDurationText,
  mysqlInt,
  mysqlJson,
  mysqlLongblob,
  mysqlLongblobFromHexText,
  mysqlText,
  mysqlTime,
  mysqlTimestamp,
  mysqlTimestampText,
  mysqlTimeText,
} from './data-types';

const classifyMysqlNumber = createNumberClassifier({
  integers: [
    { type: mysqlInt.id, form: 'number', ...signedRange(32) },
    { type: mysqlBigint.id, form: 'text', ...signedRange(64) },
  ],
  largerWhole: { type: mysqlDecimal.id, form: 'text' },
  fraction: { type: mysqlDecimal.id, form: 'text' },
});

/** A tag whose body is a date, time or duration in ISO 8601, read into the value its type stores. */
function storedTextTag(
  tag: string,
  parse: (text: string) => string,
  documentation: string,
): DataTypeAuthoringEntry {
  return {
    written: { kind: 'tag', tag, parse },
    print: (value) => String(value),
    documentation,
  };
}

function readBoolean(text: string): JsonValue {
  if (text === 'true' || text === 'false') return text === 'true';
  throw structuredError('CONTRACT.CAST_REFUSED', `"${text}" is not a boolean.`, {
    why: 'The only text a boolean reads is true or false.',
    fix: 'Use true or false.',
  });
}

function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

export function mysqlDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>> {
  return {
    [mysqlText.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [mysqlBigint.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [mysqlInt.id, mysqlBigint.id, mysqlDecimal.id],
        classify: classifyMysqlNumber,
      },
      print: printNumber,
      documentation:
        'A number. A whole number is of the narrowest MySQL integer type that holds it, and any other number is a decimal.',
    },
    [mysqlBoolean.id]: {
      written: { kind: 'plain', syntax: 'boolean', parse: readBoolean },
      print: (value) => String(value),
      documentation: 'A boolean, written true or false.',
    },
    [mysqlLongblob.id]: {
      written: { kind: 'tag', tag: 'longblob', parse: mysqlLongblobFromHexText },
      print: (value) => String(value),
      documentation:
        'Bytes, written as hex text, two digits for each byte, as in longblob`68656c6c6f`.',
    },
    [mysqlJson.id]: {
      written: { kind: 'tag', tag: 'json', parse: parseJsonText },
      print: printJsonText,
      documentation: 'Reads the text as a JSON document and stores it as the default value.',
    },
    [mysqlDatetime.id]: storedTextTag(
      'datetime',
      mysqlDatetimeText,
      'A date and time in UTC without an offset, as in datetime`2024-01-01T00:00:00`, in the years 1000 to 9999.',
    ),
    [mysqlTimestamp.id]: storedTextTag(
      'timestamp',
      mysqlTimestampText,
      'A date and time in UTC without an offset, as in timestamp`2024-01-01T00:00:00`, from 1970-01-01T00:00:01 to 2038-01-19T03:14:07.999999.',
    ),
    [mysqlDate.id]: storedTextTag(
      'date',
      mysqlDateText,
      'A calendar date, as in date`2024-02-29`, in the years 1000 to 9999.',
    ),
    [mysqlTime.id]: storedTextTag(
      'time',
      mysqlTimeText,
      'A time of day without a UTC offset, as in time`09:30:00`, from 00:00:00 to 23:59:59.999999.',
    ),
    [mysqlDuration.id]: storedTextTag(
      'duration',
      mysqlDurationText,
      'A length of time, as in duration`PT1H30M`. Reads an ISO 8601 duration and stores it as written.',
    ),
  };
}
