import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  isDataTypeLoweringEntry,
  loweringEntryKey,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createPostgresDataTypeEntries } from '../src/core/data-type-authoring';

const entries = createPostgresDataTypeEntries();

const entry = (key: string): DataTypeAuthoringEntry => {
  const found = entries[key];
  if (found === undefined || isDataTypeLoweringEntry(found)) {
    throw new Error(`no value entry under ${key}`);
  }
  return found;
};

const classify = (text: string) => {
  const written = entry('pg/numeric').written;
  if (written.kind !== 'plain' || written.syntax !== 'number') {
    throw new Error('the numeric entry is the plain number entry');
  }
  return written.classify(text);
};

describe('the authoring entries this target contributes', () => {
  it('keys a value entry by data type and a lowering entry by its reserved key', () => {
    expect(Object.keys(entries).sort()).toEqual([
      'lowering:pg.sql',
      'lowering:sql',
      'pg/bool',
      'pg/json',
      'pg/numeric',
      'pg/text',
    ]);
  });

  it('writes text plainly, a boolean plainly, a number plainly and a document with the json tag', () => {
    const writtenAs = (key: string): string => {
      const written = entry(key).written;
      return written.kind === 'tag' ? `tag ${written.tag}` : `plain ${written.syntax}`;
    };
    expect(['pg/text', 'pg/bool', 'pg/numeric', 'pg/json'].map(writtenAs)).toEqual([
      'plain string',
      'plain boolean',
      'plain number',
      'tag json',
    ]);
  });

  it('names every type its classifier returns, so assembly knows they can be written', () => {
    const written = entry('pg/numeric').written;
    expect(
      written.kind === 'plain' && written.syntax === 'number' ? [...written.types].sort() : [],
    ).toEqual(['pg/int2', 'pg/int4', 'pg/int8', 'pg/numeric']);
  });

  it.each(['sql', 'pg.sql'])('lowers the %s tag itself', (tag) => {
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
    ['zero', '0', 'pg/int2', 0],
    ['the low bound of int2', '-32768', 'pg/int2', -32768],
    ['the high bound of int2', '32767', 'pg/int2', 32767],
    ['one below int2', '-32769', 'pg/int4', -32769],
    ['one above int2', '32768', 'pg/int4', 32768],
    ['the low bound of int4', '-2147483648', 'pg/int4', -2147483648],
    ['the high bound of int4', '2147483647', 'pg/int4', 2147483647],
    ['one below int4', '-2147483649', 'pg/int8', '-2147483649'],
    ['one above int4', '2147483648', 'pg/int8', '2147483648'],
    ['the low bound of int8', '-9223372036854775808', 'pg/int8', '-9223372036854775808'],
    ['the high bound of int8', '9223372036854775807', 'pg/int8', '9223372036854775807'],
    ['one below int8', '-9223372036854775809', 'pg/numeric', '-9223372036854775809'],
    ['one above int8', '9223372036854775808', 'pg/numeric', '9223372036854775808'],
    ['a number with a fraction', '1.5', 'pg/numeric', '1.5'],
    ['trailing zeros, which a numeric keeps', '-007.50', 'pg/numeric', '-7.50'],
    ['leading zeros, which never change a number', '007', 'pg/int2', 7],
    ['a negative zero, which is zero', '-0', 'pg/int2', 0],
    ['NaN', 'NaN', 'pg/numeric', 'NaN'],
    ['Infinity', 'Infinity', 'pg/numeric', 'Infinity'],
    ['minus Infinity', '-Infinity', 'pg/numeric', '-Infinity'],
  ])('classifies %s', (_name, text, type, value) => {
    expect(classify(text)).toEqual({ type, value });
  });

  it.each(['1e3', '', 'x', '0x10'])('classifies %o as no type at all', (text) => {
    expect(classify(text)).toBeUndefined();
  });
});

describe('what each entry reads and writes', () => {
  it('reads and writes text as itself', () => {
    const text = entry('pg/text');
    const written = text.written;
    expect([
      written.kind === 'plain' && written.syntax === 'string' ? written.parse('a b') : undefined,
      text.print('a b'),
    ]).toEqual(['a b', 'a b']);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads the boolean %s', (source, value) => {
    const written = entry('pg/bool').written;
    expect(
      written.kind === 'plain' && written.syntax === 'boolean' ? written.parse(source) : undefined,
    ).toBe(value);
  });

  it.each(['TRUE', 'yes', '1', ''])('refuses %o as a boolean', (source) => {
    const written = entry('pg/bool').written;
    if (written.kind !== 'plain' || written.syntax !== 'boolean') throw new Error('plain boolean');
    expect(() => written.parse(source)).toThrow();
  });

  it('writes a boolean as its word', () => {
    expect([entry('pg/bool').print(true), entry('pg/bool').print(false)]).toEqual([
      'true',
      'false',
    ]);
  });

  it('reads a json body as the document and writes it back', () => {
    const json = entry('pg/json');
    const written = json.written;
    if (written.kind !== 'tag') throw new Error('tag');
    expect(json.print(written.parse('{ "plan": "free" }'))).toBe('{"plan":"free"}');
  });

  it('refuses a json body that is not a document', () => {
    const written = entry('pg/json').written;
    if (written.kind !== 'tag') throw new Error('tag');
    expect(() => written.parse('{ plan }')).toThrow();
  });

  it.each([
    ['a number, without an exponent', 1e21, '1000000000000000000000'],
    ['digit text as it stands', '9223372036854775807', '9223372036854775807'],
    ['a word as it stands', 'NaN', 'NaN'],
  ])('writes %s', (_name, value, text) => {
    expect(entry('pg/numeric').print(value)).toBe(text);
  });
});
