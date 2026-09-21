/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * SQLite holds whole numbers in two types and has none at all for a number past 64 bits or for a
 * non-finite one, so its classifier returns nothing for those and the value is refused. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  numeralText,
  parseJsonBody,
  printJsonBody,
  signedRange,
} from '@internal/sql-relational-core/ast';
import { sqliteBigint, sqliteInteger, sqliteJson, sqliteReal, sqliteText } from './data-types';

const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A whole number within the range a double holds exactly is an `integer`, a wider one up to 64 bits
 * is a `bigint`, and a number with a fraction is a `real`. Anything else — a whole number past 64
 * bits, or one of the three words — has no SQLite type, so it is refused.
 */
const classifySqliteNumber = createNumberClassifier({
  integers: [
    { type: sqliteInteger.id, form: 'number', min: -SAFE_INTEGER, max: SAFE_INTEGER },
    { type: sqliteBigint.id, form: 'text', ...signedRange(64) },
  ],
  fraction: { type: sqliteReal.id, form: 'number' },
});

function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

export function sqliteDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
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
        types: [sqliteInteger.id, sqliteBigint.id, sqliteReal.id],
        classify: classifySqliteNumber,
      },
      print: printNumber,
      documentation: 'A number, whose type comes from its own size and precision.',
    },
    [sqliteJson.id]: {
      written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
      print: printJsonBody,
      documentation: 'Reads the body as a JSON document and stores it as the default value.',
    },
  };
}
