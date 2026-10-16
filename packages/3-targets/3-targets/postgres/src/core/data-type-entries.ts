/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * One declaration serves both directions: the target contributes these to the assembled stack, so
 * the interpreter reads a written default through them, and `contract infer` prints a stored value
 * back through the same ones. The `sql` tag is not here: it writes `sql/expression`, which the SQL
 * family defines and registers itself.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { numeralText } from '@internal/sql-contract/data-type';
import {
  createNumberClassifier,
  parseJsonText,
  printJsonText,
  signedRange,
} from '@internal/sql-contract/data-type-support';
import { structuredError } from '@internal/utils/structured-error';
import { pgByteaFromHexText, pgByteaHexText, pgIntervalStoredText } from './data-type-values';
import {
  pgBool,
  pgBytea,
  pgDate,
  pgDateStoredText,
  pgInt2,
  pgInt4,
  pgInt8,
  pgInterval,
  pgJson,
  pgNumeric,
  pgText,
  pgTime,
  pgTimeStoredText,
  pgTimestamp,
  pgTimestampStoredText,
  pgTimestamptz,
  pgTimestamptzStoredText,
  pgTimetz,
  pgTimetzStoredText,
} from './data-types';

/**
 * PostgreSQL's own rule for a written number: a whole number takes the narrowest of `int2`, `int4`
 * and `int8` that holds it, and anything else — a larger whole number, a number with a fraction, or
 * one of the three words — is a `numeric`.
 */
const classifyPostgresNumber = createNumberClassifier({
  integers: [
    { type: pgInt2.id, form: 'number', ...signedRange(16) },
    { type: pgInt4.id, form: 'number', ...signedRange(32) },
    { type: pgInt8.id, form: 'text', ...signedRange(64) },
  ],
  largerWhole: { type: pgNumeric.id, form: 'text' },
  fraction: { type: pgNumeric.id, form: 'text' },
  words: { type: pgNumeric.id, form: 'text' },
});

function readBoolean(text: string): JsonValue {
  if (text === 'true' || text === 'false') return text === 'true';
  throw structuredError('CONTRACT.CAST_REFUSED', `"${text}" is not a boolean.`, {
    why: 'The only text a boolean reads is true or false.',
    fix: 'Use true or false.',
  });
}

/** A tag whose body is a date or time in ISO 8601 or the text PostgreSQL prints, read into the value its type stores. */
function dateTimeTag(
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

/** The text of a number-shaped stored value: a number written out, or text taken as it stands. */
function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

export function postgresDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>> {
  return {
    [pgText.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [pgBool.id]: {
      written: { kind: 'plain', syntax: 'boolean', parse: readBoolean },
      print: (value) => String(value),
      documentation: 'A boolean, written true or false.',
    },
    [pgNumeric.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
        classify: classifyPostgresNumber,
      },
      print: printNumber,
      documentation: 'A number, whose type comes from its own size and precision.',
    },
    [pgJson.id]: {
      written: { kind: 'tag', tag: 'json', parse: parseJsonText },
      print: printJsonText,
      documentation: 'Reads the text as a JSON document and stores it as the default value.',
    },
    [pgDate.id]: dateTimeTag(
      'date',
      pgDateStoredText,
      'A date, as in date`2024-01-01`. Reads ISO 8601 and the text PostgreSQL prints, such as 0044-03-15 BC, infinity and -infinity.',
    ),
    [pgTime.id]: dateTimeTag(
      'time',
      pgTimeStoredText,
      'A time of day without a UTC offset, as in time`12:34:56`.',
    ),
    [pgTimetz.id]: dateTimeTag(
      'timetz',
      pgTimetzStoredText,
      'A time of day with its UTC offset, as in timetz`12:34:56+02:00`.',
    ),
    [pgTimestamp.id]: dateTimeTag(
      'timestamp',
      pgTimestampStoredText,
      'A date and time of day without a UTC offset, as in timestamp`2024-01-01 12:34:56`. Reads ISO 8601 and the text PostgreSQL prints, including infinity and -infinity.',
    ),
    [pgTimestamptz.id]: dateTimeTag(
      'timestamptz',
      pgTimestamptzStoredText,
      'An instant, as in timestamptz`2024-01-01T00:00:00Z`, stored in UTC. Reads ISO 8601 and the text PostgreSQL prints, including infinity and -infinity.',
    ),
    [pgInterval.id]: dateTimeTag(
      'interval',
      pgIntervalStoredText,
      'A duration, as in interval`P1Y2M3DT4H5M6S` or interval`1 year 2 mons`, stored as an ISO 8601 duration.',
    ),
    [pgBytea.id]: {
      written: { kind: 'tag', tag: 'bytea', parse: pgByteaFromHexText },
      print: (value) => pgByteaHexText(String(value)),
      documentation:
        'Bytes, written as the hex text PostgreSQL prints, as in bytea`\\x68656c6c6f`.',
    },
  };
}
