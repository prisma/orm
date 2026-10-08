import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
  sqliteRealDescriptor,
  sqliteSqlFloatDescriptor,
  sqliteSqlIntDescriptor,
} from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('sqlite/bigint@1 decodeJson', () => {
  const codec = sqliteBigintDescriptor.factory()(ctx);

  it('reads digit text', () => {
    expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/bigint@1 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });
});

describe('sqlite/bigintnumber@1 digit text', () => {
  const codec = sqliteBigintNumberDescriptor.factory()(ctx);

  it.each([
    ['a positive value', 42, '42'],
    ['a negative value', -42, '-42'],
    ['the top of the safe integer range', 9007199254740991, '9007199254740991'],
  ])('round-trips %s as digit text', (_name, value, text) => {
    expect(codec.encodeJson(value)).toBe(text);
    expect(codec.decodeJson(text)).toBe(value);
  });

  it('refuses a JSON number', () => {
    expect(() => codec.decodeJson(42)).toThrow(
      'sqlite/bigintnumber@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992'], ['9007199254740993']])(
    'refuses the digit text %s, naming the limit',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        'sqlite/bigintnumber@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
      );
    },
  );

  it('refuses decimal text', () => {
    expect(() => codec.decodeJson('1.5')).toThrow(
      'sqlite/bigintnumber@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
    );
  });
});

describe.each([
  ['sqlite/integer@1', sqliteIntegerDescriptor],
  ['sql/int@1', sqliteSqlIntDescriptor],
] as const)('%s digit text', (codecId, descriptor) => {
  const codec = descriptor.factory()(ctx);

  it.each([
    ['zero', 0, '0'],
    ['a negative value', -42, '-42'],
    ['the top of the safe integer range', 9007199254740991, '9007199254740991'],
    ['the bottom of the safe integer range', -9007199254740991, '-9007199254740991'],
  ])('round-trips %s as digit text', (_name, value, text) => {
    expect(codec.encodeJson(value)).toBe(text);
    expect(codec.decodeJson(text)).toBe(value);
  });

  it.each([
    ['a JSON number', 42],
    ['decimal text', '1.5'],
    ['text with a plus sign', '+1'],
    ['a boolean', true],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `${codecId} JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991`,
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992']])(
    'refuses the digit text %s, which no number holds exactly',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        `${codecId} JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991`,
      );
    },
  );

  it.each([
    ['a number with a fraction', 1.5],
    ['a number past the safe integer range', 9007199254740992],
  ])('refuses to write %s', (_name, value) => {
    expect(() => codec.encodeJson(value)).toThrow(
      `${codecId} value must be an integer within the safe integer range`,
    );
  });
});

describe.each([
  ['sqlite/bigint@1', () => sqliteBigintDescriptor.factory()(ctx)],
  ['sqlite/bigintnumber@1', () => sqliteBigintNumberDescriptor.factory()(ctx)],
  ['sqlite/integer@1', () => sqliteIntegerDescriptor.factory()(ctx)],
  ['sql/int@1', () => sqliteSqlIntDescriptor.factory()(ctx)],
] as const)('%s digit text without leading zeros or a minus sign on zero', (codecId, build) => {
  const codec: { decodeJson(json: string): unknown } = build();

  it.each([
    ['a leading zero', '007', '7'],
    ['a negative zero', '-0', '0'],
    ['a negative number with a leading zero', '-007', '-7'],
    ['two zeros', '00', '0'],
  ])('refuses %s, naming the text to write', (_name, json, printed) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `${codecId} JSON value must be "${printed}", the integer's decimal text without leading zeros or a minus sign on zero`,
    );
  });
});

describe('sqlite/json@1 JSON text', () => {
  const codec = sqliteJsonDescriptor.factory()(ctx);

  it.each([
    [
      'an object, keys sorted',
      { b: [1, 'two'], a: { d: null, c: true } },
      '{"a":{"c":true,"d":null},"b":[1,"two"]}',
    ],
    ['a string', 'plain', '"plain"'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
  ])('writes %s as its JSON text', (_name, value, text) => {
    expect(codec.encodeJson(value)).toBe(text);
  });

  it.each([
    ['an object', '{"a":1,"b":["x"]}', { a: 1, b: ['x'] }],
    ['a string', '"plain"', 'plain'],
    ['null', 'null', null],
  ])('reads the JSON text of %s', (_name, text, value) => {
    expect(codec.decodeJson(text)).toEqual(value);
  });

  it('refuses text that is not JSON', () => {
    expect(() => codec.decodeJson('hello')).toThrow(
      'sqlite/json@1 contract value must be the JSON text of a document',
    );
  });

  it('refuses a document that is not text', () => {
    expect(() => codec.decodeJson({ a: 1 })).toThrow(
      'sqlite/json@1 contract value must be the JSON text of a document',
    );
  });
});

describe('sqlite/datetime@1 text', () => {
  const codec = sqliteDatetimeDescriptor.factory()(ctx);

  it('writes and reads an instant as its ISO text', () => {
    const instant = new Date('2026-01-02T03:04:05.678Z');
    expect(codec.encodeJson(instant)).toBe('2026-01-02T03:04:05.678Z');
    expect(codec.decodeJson('2026-01-02T03:04:05.678Z')).toEqual(instant);
  });
});

describe('sqlite/real@1 decodeJson', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/real@1 JSON value must be a finite number or the text NaN, Infinity or -Infinity',
    );
  });

  it('refuses the text NaN, which SQLite cannot store', () => {
    expect(() => codec.decodeJson('NaN')).toThrow(
      'sqlite/real@1 JSON value must be a finite number or the text Infinity or -Infinity; SQLite cannot store NaN',
    );
  });
});

describe('sqlite/real@1 encode', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  it('writes an infinity, which SQLite stores', async () => {
    expect(
      await Promise.all(
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((value) =>
          codec.encode(value, {}),
        ),
      ),
    ).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  });
});

describe.each([
  ['sqlite/real@1', sqliteRealDescriptor],
  ['sql/float@1', sqliteSqlFloatDescriptor],
] as const)('%s on SQLite, which cannot store NaN', (codecId, descriptor) => {
  const codec = descriptor.factory()(ctx);
  const refusal = expect.objectContaining({
    code: 'RUNTIME.ENCODE_FAILED',
    message: `${codecId} value must be a number other than NaN, which SQLite cannot store`,
    meta: { codecId, received: 'NaN' },
  });

  it('refuses NaN when it encodes a value to write or filter by', async () => {
    await expect(codec.encode(Number.NaN, {})).rejects.toThrow(refusal);
  });

  it('refuses NaN when it encodes a value to store in the contract', () => {
    expect(() => codec.encodeJson(Number.NaN)).toThrow(refusal);
  });

  it('refuses the text NaN in JSON', () => {
    expect(() => codec.decodeJson('NaN')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: `${codecId} JSON value must be a finite number or the text Infinity or -Infinity; SQLite cannot store NaN`,
        meta: { codecId, received: '"NaN"' },
      }),
    );
  });

  it('writes and reads the infinities, which SQLite stores', async () => {
    const infinities = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    expect({
      encoded: await Promise.all(infinities.map((value) => codec.encode(value, {}))),
      json: infinities.map((value) => codec.decodeJson(codec.encodeJson(value))),
    }).toEqual({ encoded: infinities, json: infinities });
  });
});
