/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * SQLite stores every whole number of up to 64 bits as an `integer` and has no type at all for a
 * wider one or for a non-finite number, so its classifier returns nothing for those and the value is
 * refused. The `json` tag yields `sqlite/json`, and the `datetime`, `date`, `time` and `duration`
 * tags yield `sqlite/datetime`, `sqlite/date`, `sqlite/time` and `sqlite/duration`, each stored as
 * text. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  numeralText,
  parseJsonText,
  signedRange,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import {
  sqliteBlob,
  sqliteBlobFromHexText,
  sqliteDate,
  sqliteDateText,
  sqliteDatetime,
  sqliteDatetimeText,
  sqliteDuration,
  sqliteDurationText,
  sqliteInteger,
  sqliteJson,
  sqliteReal,
  sqliteText,
  sqliteTime,
  sqliteTimeText,
} from './data-types';

const classifySqliteNumber = createNumberClassifier({
  integers: [{ type: sqliteInteger.id, form: 'text', ...signedRange(64) }],
  fraction: { type: sqliteReal.id, form: 'number' },
  words: { type: sqliteReal.id, form: 'text' },
});

function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

export function sqliteDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>> {
  return {
    [sqliteText.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [sqliteReal.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [sqliteInteger.id, sqliteReal.id],
        classify: classifySqliteNumber,
      },
      print: printNumber,
      documentation: 'A number, whose type comes from its own size and precision.',
    },
    [sqliteJson.id]: {
      written: {
        kind: 'tag',
        tag: 'json',
        parse: (text) => canonicalizeJson(parseJsonText(text)),
      },
      print: (value) => String(value),
      documentation:
        'Reads the text as a JSON document and stores its JSON text as the default value.',
    },
    [sqliteBlob.id]: {
      written: { kind: 'tag', tag: 'blob', parse: sqliteBlobFromHexText },
      print: (value) => String(value).toLowerCase(),
      documentation:
        'Bytes, written as hex text, two digits for each byte, as in blob`68656c6c6f`.',
    },
    [sqliteDatetime.id]: {
      written: { kind: 'tag', tag: 'datetime', parse: sqliteDatetimeText },
      print: (value) => String(value),
      documentation:
        'An instant, as in datetime`2024-01-01T00:00:00Z`. Reads ISO 8601 with a UTC offset and stores the instant in UTC with three fraction digits, the text every row holds.',
    },
    [sqliteDate.id]: {
      written: { kind: 'tag', tag: 'date', parse: sqliteDateText },
      print: (value) => String(value),
      documentation:
        'A calendar date, as in date`2024-02-29`, in the years 0000 to 9999, stored as the text every row holds.',
    },
    [sqliteTime.id]: {
      written: { kind: 'tag', tag: 'time', parse: sqliteTimeText },
      print: (value) => String(value),
      documentation:
        'A time of day without a UTC offset, as in time`09:30:00`. Stores it with three fraction digits, as in 09:30:00.000, the text every row holds.',
    },
    [sqliteDuration.id]: {
      written: { kind: 'tag', tag: 'duration', parse: sqliteDurationText },
      print: (value) => String(value),
      documentation:
        'A length of time, as in duration`PT1H30M`. Reads an ISO 8601 duration and stores it as written.',
    },
  };
}
