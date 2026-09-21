/**
 * How PSL writes values of this target's data types: which syntax each type is written in, how the
 * text is read into the type's canonical form, and how a stored value is written back.
 *
 * A number is the one plain form that yields several types, so one entry carries the classifier for
 * all of them, keyed under the type a number falls back to. The `sql` and `pg.sql` tags lower their
 * own bodies and name no type, so they sit under reserved keys.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { sqlDefaultLiteralTagEntry } from '@internal/family-sql/control';
import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import { loweringEntryKey } from '@internal/framework-components/authoring';
import {
  createNumberClassifier,
  numeralText,
  parseJsonBody,
  printJsonBody,
  signedRange,
} from '@internal/sql-relational-core/ast';
import {
  pgBool,
  pgInt2,
  pgInt4,
  pgInt8,
  pgJson,
  pgNumeric,
  pgText,
} from '@internal/target-postgres/data-types';
import { structuredError } from '@internal/utils/structured-error';

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
  throw structuredError('CONTRACT.INVALID_DEFAULT_LITERAL', `"${text}" is not a boolean.`, {
    why: 'A boolean is written as true or false.',
    fix: 'Write true or false.',
  });
}

/** The text of a number-shaped stored value: a number written out, or text taken as it stands. */
function printNumber(value: JsonValue): string {
  return typeof value === 'number' ? numeralText(value) : String(value);
}

function loweringEntry(tag: string): AuthoringDataTypeEntry {
  const lowering = sqlDefaultLiteralTagEntry(`${tag}\`...\``);
  return {
    written: { kind: 'tag', tag },
    documentation: lowering.documentation,
    lower: lowering.lower,
  };
}

export function createPostgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
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
    [loweringEntryKey('sql')]: loweringEntry('sql'),
    [loweringEntryKey('pg.sql')]: loweringEntry('pg.sql'),
  };
}
