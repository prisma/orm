import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteIntegerDescriptor,
  sqliteRealDescriptor,
  sqliteSqlFloatDescriptor,
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

describe('sqlite/integer@1 decodeJson', () => {
  const codec = sqliteIntegerDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
    ['a boolean', true],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/integer@1 JSON value must be an integer from -9007199254740991 to 9007199254740991',
    );
  });

  it.each([
    ['a number with a fraction', 1.5],
    ['a number past the safe integer range', 9007199254740992],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/integer@1 JSON value must be an integer from -9007199254740991 to 9007199254740991',
    );
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
