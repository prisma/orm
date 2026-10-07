import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { tagEntryKey } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { sqliteDataTypeEntries } from '../src/core/data-type-entries';

const entries = sqliteDataTypeEntries();

const entry = (key: string): DataTypeAuthoringEntry => {
  const found = entries[key];
  if (found === undefined) throw new Error(`no entry under ${key}`);
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
  it('keys a value entry by data type and the json entry by its tag', () => {
    expect(Object.keys(entries).sort()).toEqual(['sqlite/real', 'sqlite/text', 'tag:json']);
  });
  it('names every type its classifier returns', () => {
    const written = entry('sqlite/real').written;
    expect(
      written.kind === 'plain' && written.syntax === 'number' ? [...written.types].sort() : [],
    ).toEqual(['sqlite/integer', 'sqlite/real']);
  });
});

describe('the classifier this target contributes', () => {
  it.each([
    ['zero', '0', 'sqlite/integer', '0'],
    [
      'the largest whole number a double holds exactly',
      '9007199254740991',
      'sqlite/integer',
      '9007199254740991',
    ],
    ['one past it', '9007199254740992', 'sqlite/integer', '9007199254740992'],
    ['one past it, negative', '-9007199254740992', 'sqlite/integer', '-9007199254740992'],
    ['the high bound of 64 bits', '9223372036854775807', 'sqlite/integer', '9223372036854775807'],
    ['the low bound of 64 bits', '-9223372036854775808', 'sqlite/integer', '-9223372036854775808'],
    ['a number with a fraction', '1.5', 'sqlite/real', 1.5],
    ['trailing zeros, which a double does not keep', '-007.50', 'sqlite/real', -7.5],
    ['leading zeros', '007', 'sqlite/integer', '7'],
    ['a negative zero', '-0', 'sqlite/integer', '0'],
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

describe('the json tag this target contributes', () => {
  const json = entry(tagEntryKey('json'));
  const parse = (body: string) => {
    if (json.written.kind !== 'tag') throw new Error('the json entry is a tag entry');
    return json.written.parse(body);
  };

  it('reads a body as the JSON text of its document, keys sorted and without spaces', () => {
    expect(parse('{ "b": [1, 2], "a": { "d": null, "c": "x" } }')).toBe(
      '{"a":{"c":"x","d":null},"b":[1,2]}',
    );
  });

  it('reads a scalar document as its JSON text', () => {
    expect(parse(' "plain" ')).toBe('"plain"');
  });

  it('refuses a body that is not a document', () => {
    expect(() => parse('hello')).toThrow(
      expect.objectContaining({ code: 'CONTRACT.INVALID_JSON_LITERAL' }),
    );
  });

  it('prints the stored text as the body', () => {
    expect(json.print('{"a":1}')).toBe('{"a":1}');
  });
});
