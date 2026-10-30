/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * A number is the smallest MongoDB type that holds it: an `int` in 32 bits, a `long` in 64, a
 * `decimal` when a Decimal128 holds it exactly, `NaN` and the infinities included, and a `double`
 * otherwise. The `date` tag yields `mongo/date`, stored as the text `Date.toISOString()` writes; a
 * calendar date is written as a string, or as a `date` tag at midnight UTC; the `time` and `duration`
 * tags yield `mongo/time` and `mongo/duration`; the `binary` tag `mongo/binary`, written in base64 as MongoDB prints bytes; the `json` tag `mongo/json`.
 * `mongo/bson` has no entry: no position takes a BSON value written in PSL. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  type DataTypeId,
  isoDateStringText,
  numeralText,
  parseJsonText,
  printJsonText,
  signedRange,
} from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { decimal128HoldsExactly, isBase64Text } from './bson-scalar-helpers';
import {
  mongoBinary,
  mongoBool,
  mongoDate,
  mongoDecimal128,
  mongoDouble,
  mongoDuration,
  mongoDurationText,
  mongoInt32,
  mongoInt64,
  mongoJson,
  mongoString,
  mongoTime,
  mongoTimeText,
} from './data-types';

const classifyAsDecimal = createNumberClassifier({
  integers: [
    { type: mongoInt32.id, form: 'number', ...signedRange(32) },
    { type: mongoInt64.id, form: 'text', ...signedRange(64) },
  ],
  largerWhole: { type: mongoDecimal128.id, form: 'text' },
  fraction: { type: mongoDecimal128.id, form: 'text' },
  words: { type: mongoDecimal128.id, form: 'text' },
});

/** The type of a written number: a `decimal` only when a Decimal128 holds it exactly, else the `double` nearest it. */
function classifyMongoNumber(
  text: string,
): { readonly type: DataTypeId; readonly value: JsonValue } | undefined {
  const classified = classifyAsDecimal(text);
  if (classified?.type !== mongoDecimal128.id || decimal128HoldsExactly(String(classified.value))) {
    return classified;
  }
  const double = Number(text);
  return Number.isFinite(double) ? { type: mongoDouble.id, value: double } : undefined;
}

function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

function base64Text(text: string): string {
  if (isBase64Text(text)) return text;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `"${text}" is not base64 text: write the bytes in base64, as in binary\`aGVsbG8=\`.`,
    {
      why: 'The binary tag reads bytes as base64, as MongoDB prints them.',
      fix: 'Write the bytes in base64, as in binary`aGVsbG8=`.',
    },
  );
}

export function mongoDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>> {
  return {
    [mongoString.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [mongoBool.id]: {
      written: { kind: 'plain', syntax: 'boolean', parse: (text) => text === 'true' },
      print: (value) => String(value),
      documentation: 'A boolean, written true or false.',
    },
    [mongoDouble.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [mongoInt32.id, mongoInt64.id, mongoDecimal128.id, mongoDouble.id],
        classify: classifyMongoNumber,
      },
      print: printNumber,
      documentation:
        'A number: an int in 32 bits, a long in 64, a decimal when a Decimal128 holds it exactly, NaN and the infinities included, and a double otherwise.',
    },
    [mongoDate.id]: {
      written: {
        kind: 'tag',
        tag: 'date',
        parse: (text) => isoDateStringText(text, mongoDate.id),
      },
      print: (value) => String(value),
      documentation:
        'An instant, as in date`2024-01-01T00:00:00Z`. Reads ISO 8601 with a UTC offset and stores the instant in UTC with three fraction digits, as Date.toISOString() writes it.',
    },
    [mongoTime.id]: {
      written: { kind: 'tag', tag: 'time', parse: mongoTimeText },
      print: (value) => String(value),
      documentation:
        'A time of day without a UTC offset, as in time`09:30:00`. Stores it with three fraction digits, as in 09:30:00.000.',
    },
    [mongoDuration.id]: {
      written: { kind: 'tag', tag: 'duration', parse: mongoDurationText },
      print: (value) => String(value),
      documentation:
        'A length of time, as in duration`PT1H30M`. Reads an ISO 8601 duration and stores it as written.',
    },
    [mongoBinary.id]: {
      written: { kind: 'tag', tag: 'binary', parse: base64Text },
      print: (value) => String(value),
      documentation: 'Bytes, written in base64 as MongoDB prints them, as in binary`aGVsbG8=`.',
    },
    [mongoJson.id]: {
      written: { kind: 'tag', tag: 'json', parse: parseJsonText },
      print: printJsonText,
      documentation: 'Reads the text as a JSON document and stores it as the value.',
    },
  };
}
