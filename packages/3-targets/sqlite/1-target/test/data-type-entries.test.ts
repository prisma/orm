import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
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
  it('keys every entry by the data type it reads', () => {
    expect(Object.keys(entries).sort()).toEqual([
      'sqlite/blob',
      'sqlite/date',
      'sqlite/datetime',
      'sqlite/duration',
      'sqlite/json',
      'sqlite/real',
      'sqlite/text',
      'sqlite/time',
    ]);
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
    ['Infinity, which a real holds', 'Infinity', 'sqlite/real', 'Infinity'],
    ['minus Infinity, which a real holds', '-Infinity', 'sqlite/real', '-Infinity'],
    ['NaN, which the real type and its codecs then refuse', 'NaN', 'sqlite/real', 'NaN'],
  ])('classifies %s', (_name, text, type, value) => {
    expect(classify(text)).toEqual({ type, value });
  });

  it.each([
    ['a whole number past 64 bits', '9223372036854775808'],
    ['an exponent, which no schema language writes', '1e3'],
  ])('holds no type for %s', (_name, text) => {
    expect(classify(text)).toBeUndefined();
  });
});

describe('the json tag this target contributes', () => {
  const json = entry('sqlite/json');
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

describe('the datetime tag this target contributes', () => {
  const datetime = entry('sqlite/datetime');
  const parse = (body: string) => {
    if (datetime.written.kind !== 'tag') throw new Error('the datetime entry is a tag entry');
    return datetime.written.parse(body);
  };

  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01 01:00:00.5+01:00', '2024-01-01T00:00:00.500Z'],
    ['2024-01-01T00:00:00.123Z', '2024-01-01T00:00:00.123Z'],
  ])('reads %s as the instant with three fraction digits, %s', (body, stored) => {
    expect(parse(body)).toBe(stored);
  });

  it('refuses a body with no UTC offset', () => {
    expect(() => parse('2024-01-01 00:00:00')).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });

  it('prints the stored text as the body', () => {
    expect(datetime.print('2024-01-01T00:00:00.000Z')).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('the blob tag this target contributes', () => {
  const blob = entry('sqlite/blob');
  const parse = (body: string) => {
    if (blob.written.kind !== 'tag') throw new Error('the blob entry is a tag entry');
    return blob.written.parse(body);
  };

  it('reads a body of hex digits as the upper-case hex sqlite/blob stores', () => {
    expect({ lower: parse('68656c6c6f'), upper: parse('68656C6C6F'), empty: parse('') }).toEqual({
      lower: '68656C6C6F',
      upper: '68656C6C6F',
      empty: '',
    });
  });

  it.each([
    ['an odd number of digits', '686'],
    ['a character that is not hex', '6g'],
    ['a prefix', "X'68'"],
  ])('refuses %s, saying how to write bytes', (_case, body) => {
    expect(() => parse(body)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: `"${body}" is not hex text: write two hexadecimal digits for each byte, as in blob\`68656c6c6f\`.`,
      }),
    );
  });

  it('prints the stored hex as the body, in lower case', () => {
    expect(blob.print('68656C6C6F')).toBe('68656c6c6f');
  });
});

describe('how each entry prints a stored value', () => {
  it('prints each stored value as PSL writes it back', () => {
    expect({
      text: entry('sqlite/text').print('hello'),
      integer: entry('sqlite/real').print('42'),
      real: entry('sqlite/real').print(1.5),
      json: entry('sqlite/json').print('{"a":1}'),
      blob: entry('sqlite/blob').print('6869'),
      datetime: entry('sqlite/datetime').print('2024-01-01T00:00:00.000Z'),
    }).toEqual({
      text: 'hello',
      integer: '42',
      real: '1.5',
      json: '{"a":1}',
      blob: '6869',
      datetime: '2024-01-01T00:00:00.000Z',
    });
  });

  it('reads plain text as itself', () => {
    const written = entry('sqlite/text').written;
    expect(
      written.kind === 'plain' && written.syntax === 'string' ? written.parse('a b') : '',
    ).toBe('a b');
  });
});
