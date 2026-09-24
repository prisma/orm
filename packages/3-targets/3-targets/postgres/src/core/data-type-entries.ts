/**
 * How PSL writes a value of each of this target's data types, and how it reads the text back.
 *
 * One declaration serves both directions: the adapter contributes these to the assembled stack, so
 * the interpreter reads a written default through them, and `contract infer` prints a stored value
 * back through the same ones. The `sql` and `pg.sql` tags lower their own bodies and name no data
 * type, so they sit beside these in the adapter, where the family's lowering entry is reachable.
 *
 * ADR 254.
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
import { structuredError } from '@internal/utils/structured-error';
import { pgBool, pgInt2, pgInt4, pgInt8, pgJson, pgNumeric, pgText } from './data-types';

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

/** The text of a number-shaped stored value: a number written out, or text taken as it stands. */
function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

export function postgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
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
      written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
      print: printJsonBody,
      documentation: 'Reads the body as a JSON document and stores it as the default value.',
    },
  };
}
