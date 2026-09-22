import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  isDataTypeLoweringEntry,
  loweringEntryKey,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createSqliteDataTypeEntries } from '../src/core/data-type-authoring';

const entries = createSqliteDataTypeEntries();

const entry = (key: string): DataTypeAuthoringEntry => {
  const found = entries[key];
  if (found === undefined || isDataTypeLoweringEntry(found)) {
    throw new Error(`no value entry under ${key}`);
  }
  return found;
};

const classify = (text: string) => {
  const written = entry('sqlite/real').written;
  if (written.kind !== 'plain' || written.syntax !== 'number') {
    throw new Error('the real entry is the plain number entry');
  }
  return written.classify(text);
};

describe('the authoring entries this target contributes', () => {
  it('keys a value entry by data type and a lowering entry by its reserved key', () => {
    expect(Object.keys(entries).sort()).toEqual([
      'lowering:sql',
      'lowering:sqlite.sql',
      'sqlite/json',
      'sqlite/real',
      'sqlite/text',
    ]);
  });

  it('names every type its classifier returns', () => {
    const written = entry('sqlite/real').written;
    expect(
      written.kind === 'plain' && written.syntax === 'number' ? [...written.types].sort() : [],
    ).toEqual(['sqlite/bigint', 'sqlite/integer', 'sqlite/real']);
  });

  it.each(['sql', 'sqlite.sql'])('lowers the %s tag itself', (tag) => {
    const lowering = entries[loweringEntryKey(tag)];
    expect(lowering !== undefined && isDataTypeLoweringEntry(lowering) && lowering.written).toEqual(
      {
        kind: 'tag',
        tag,
      },
    );
  });
});

describe('the classifier this target contributes', () => {
  it.each([
    ['zero', '0', 'sqlite/integer', 0],
    [
      'the largest whole number a double holds exactly',
      '9007199254740991',
      'sqlite/integer',
      9007199254740991,
    ],
    ['the smallest such negative number', '-9007199254740991', 'sqlite/integer', -9007199254740991],
    ['one past it', '9007199254740992', 'sqlite/bigint', '9007199254740992'],
    ['one past it, negative', '-9007199254740992', 'sqlite/bigint', '-9007199254740992'],
    ['the high bound of 64 bits', '9223372036854775807', 'sqlite/bigint', '9223372036854775807'],
    ['the low bound of 64 bits', '-9223372036854775808', 'sqlite/bigint', '-9223372036854775808'],
    ['a number with a fraction', '1.5', 'sqlite/real', 1.5],
    ['trailing zeros, which a double does not keep', '-007.50', 'sqlite/real', -7.5],
    ['leading zeros', '007', 'sqlite/integer', 7],
    ['a negative zero', '-0', 'sqlite/integer', 0],
  ])('classifies %s', (_name, text, type, value) => {
    expect(classify(text)).toEqual({ type, value });
  });

  it.each([
    ['a whole number past 64 bits', '9223372036854775808'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['minus Infinity', '-Infinity'],
    ['an exponent, which no schema language writes', '1e3'],
  ])('holds no type for %s', (_name, text) => {
    expect(classify(text)).toBeUndefined();
  });
});
