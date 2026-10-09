/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * SQLite stores every whole number of up to 64 bits as an `integer` and has no type at all for a
 * wider one or for a non-finite number, so its classifier returns nothing for those and the value is
 * refused. A JSON document is stored as text, so the `json` tag yields `sqlite/text`. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { type DataTypeAuthoringEntry, tagEntryKey } from '@internal/framework-components/authoring';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { numeralText } from '@internal/sql-contract/data-type';
import {
  createNumberClassifier,
  parseJsonText,
  signedRange,
} from '@internal/sql-contract/data-type-support';
import { sqliteInteger, sqliteReal, sqliteText } from './data-types';

const classifySqliteNumber = createNumberClassifier({
  integers: [{ type: sqliteInteger.id, form: 'text', ...signedRange(64) }],
  fraction: { type: sqliteReal.id, form: 'number' },
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
    [tagEntryKey('json')]: {
      written: {
        kind: 'tag',
        tag: 'json',
        type: sqliteText.id,
        parse: (text) => canonicalizeJson(parseJsonText(text)),
      },
      print: (value) => String(value),
      documentation:
        'Reads the text as a JSON document and stores its JSON text as the default value.',
    },
  };
}
