import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  decodeJsonBoolean,
  decodeJsonFloat,
  decodeJsonInteger,
  decodeJsonIntegerText,
  decodeJsonMatching,
  decodeJsonString,
  encodeJsonFloat,
  INT32_RANGE,
  INT64_RANGE,
  isIntegerIn,
  isNonFiniteText,
  refuseJsonValue,
} from '../src/shared/decode-json';

const refusal = (codecId: string, expected: string, received: string) =>
  expect.objectContaining({
    code: 'RUNTIME.DECODE_FAILED',
    message: `${codecId} JSON value must be ${expected}`,
    meta: { codecId, received },
  });

describe('refuseJsonValue', () => {
  it('throws RUNTIME.DECODE_FAILED naming the codec and what it takes, with the value it got', () => {
    expect(() => refuseJsonValue('demo/x@1', 'a thing', [1])).toThrow(
      refusal('demo/x@1', 'a thing', '[1]'),
    );
  });

  it('keeps the first 100 characters of the value it got', () => {
    expect(() => refuseJsonValue('demo/x@1', 'a thing', 'x'.repeat(200))).toThrow(
      refusal('demo/x@1', 'a thing', `"${'x'.repeat(99)}`),
    );
  });
});

describe('decodeJsonString', () => {
  it('reads a JSON string', () => {
    expect(['text', ''].map((json) => decodeJsonString('demo/text@1', json))).toEqual(['text', '']);
  });

  it.each<readonly [JsonValue, string]>([
    [1, '1'],
    [true, 'true'],
    [null, 'null'],
    [['a'], '["a"]'],
    [{ a: 'b' }, '{"a":"b"}'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonString('demo/text@1', json)).toThrow(
      refusal('demo/text@1', 'a string', received),
    );
  });
});

describe('decodeJsonMatching', () => {
  const read = (json: JsonValue) =>
    decodeJsonMatching('demo/bits@1', json, /^[01]*$/, 'binary digits');

  it('reads a string that matches the pattern', () => {
    expect(['0101', ''].map(read)).toEqual(['0101', '']);
  });

  it.each<readonly [JsonValue, string]>([
    ['012', '"012"'],
    [101, '101'],
  ])('refuses %j', (json, received) => {
    expect(() => read(json)).toThrow(refusal('demo/bits@1', 'binary digits', received));
  });
});

describe('decodeJsonBoolean', () => {
  it('reads a JSON boolean', () => {
    expect([true, false].map((json) => decodeJsonBoolean('demo/flag@1', json))).toEqual([
      true,
      false,
    ]);
  });

  it.each<readonly [JsonValue, string]>([
    ['true', '"true"'],
    [0, '0'],
    [null, 'null'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonBoolean('demo/flag@1', json)).toThrow(
      refusal('demo/flag@1', 'a boolean', received),
    );
  });
});

describe('decodeJsonInteger', () => {
  const range = { min: -128, max: 127 };

  it('reads an integer within the range, both ends included', () => {
    expect([-128, 0, 127].map((json) => decodeJsonInteger('demo/int@1', json, range))).toEqual([
      -128, 0, 127,
    ]);
  });

  it.each<readonly [JsonValue, string]>([
    [128, '128'],
    [-129, '-129'],
    [1.5, '1.5'],
    ['1', '"1"'],
    [null, 'null'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonInteger('demo/int@1', json, range)).toThrow(
      refusal('demo/int@1', 'an integer from -128 to 127', received),
    );
  });
});

describe('decodeJsonIntegerText', () => {
  const range = { min: -128n, max: 127n };

  it('reads decimal integer text as a bigint, within the range when there is one', () => {
    expect({
      ranged: ['-128', '0', '127'].map((json) => decodeJsonIntegerText('demo/big@1', json, range)),
      unbounded: decodeJsonIntegerText('demo/big@1', '123456789012345678901234567890'),
    }).toEqual({ ranged: [-128n, 0n, 127n], unbounded: 123456789012345678901234567890n });
  });

  it.each<readonly [JsonValue, string]>([
    ['128', '"128"'],
    ['-129', '"-129"'],
    ['1.5', '"1.5"'],
    ['1e3', '"1e3"'],
    [12, '12'],
  ])('refuses %j against a range', (json, received) => {
    expect(() => decodeJsonIntegerText('demo/big@1', json, range)).toThrow(
      refusal('demo/big@1', 'a decimal integer string from -128 to 127', received),
    );
  });

  it('refuses a non-integer without a range', () => {
    expect(() => decodeJsonIntegerText('demo/big@1', '1.5')).toThrow(
      refusal('demo/big@1', 'a decimal integer string', '"1.5"'),
    );
  });
});

describe('the float pair', () => {
  it('writes a finite number as itself and NaN and the infinities as their text', () => {
    const values = [1.5, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const stored = values.map(encodeJsonFloat);
    expect({ stored, read: stored.map((json) => decodeJsonFloat('demo/float@1', json)) }).toEqual({
      stored: [1.5, -0, 'NaN', 'Infinity', '-Infinity'],
      read: values,
    });
  });

  it.each<readonly [JsonValue, string]>([
    ['1.5', '"1.5"'],
    ['nan', '"nan"'],
    ['inf', '"inf"'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [Number.NaN, 'NaN'],
    [true, 'true'],
    [null, 'null'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonFloat('demo/float@1', json)).toThrow(
      refusal('demo/float@1', 'a finite number or the text NaN, Infinity or -Infinity', received),
    );
  });
});

describe('isNonFiniteText', () => {
  it('names the three words a float JSON form writes for NaN and the infinities, and nothing else', () => {
    expect(
      ['NaN', 'Infinity', '-Infinity', 'nan', 'inf', '+Infinity', '1', ''].filter(isNonFiniteText),
    ).toEqual(['NaN', 'Infinity', '-Infinity']);
  });
});

describe('the integer ranges', () => {
  it('bound a signed 32-bit and a signed 64-bit integer', () => {
    expect({ INT32_RANGE, INT64_RANGE }).toEqual({
      INT32_RANGE: { min: -2147483648, max: 2147483647 },
      INT64_RANGE: { min: -9223372036854775808n, max: 9223372036854775807n },
    });
  });
});

describe('isIntegerIn', () => {
  it('holds for an integer within the range, its ends included', () => {
    const range = { min: -2, max: 3 };
    expect(
      [-2, 0, 3, -3, 4, 1.5, Number.NaN, '1'].map((value) => isIntegerIn(value, range)),
    ).toEqual([true, true, true, false, false, false, false, false]);
  });
});
