/**
 * How PSL writes a value of each of this target's data types. A quoted string is `mysql/text`; a
 * whole number is the narrowest of `mysql/int` and `mysql/bigint` that holds it, and anything else
 * has no MySQL type in this target and is refused. The `datetime`, `timestamp`, `date`, `time` and
 * `duration` tags yield the data types of those names, each read into the value its type stores.
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  numeralText,
  signedRange,
} from '@internal/framework-components/codec';
import {
  mysqlBigint,
  mysqlDate,
  mysqlDateText,
  mysqlDatetime,
  mysqlDatetimeText,
  mysqlDuration,
  mysqlDurationText,
  mysqlInt,
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
        types: [mysqlInt.id, mysqlBigint.id],
        classify: classifyMysqlNumber,
      },
      print: printNumber,
      documentation:
        'A whole number, whose type is the narrowest MySQL integer type that holds it.',
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
