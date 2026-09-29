import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { decodeJsonBoolean, decodeJsonString } from '../src/decode-json';

const refusal = (codecId: string, expected: string, received: string) =>
  expect.objectContaining({
    code: 'RUNTIME.DECODE_FAILED',
    message: `${codecId} JSON value must be ${expected}`,
    meta: { codecId, received },
  });

describe('decodeJsonString', () => {
  it('reads a JSON string as itself', () => {
    expect(['text', ''].map((json) => decodeJsonString('demo/text@1', json))).toEqual(['text', '']);
  });

  it.each<readonly [JsonValue, string]>([
    [1, 'number'],
    [true, 'boolean'],
    [null, 'object'],
    [['a'], 'object'],
    [{ a: 'b' }, 'object'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonString('demo/text@1', json)).toThrow(
      refusal('demo/text@1', 'a string', received),
    );
  });
});

describe('decodeJsonBoolean', () => {
  it('reads a JSON boolean as itself', () => {
    expect([true, false].map((json) => decodeJsonBoolean('demo/flag@1', json))).toEqual([
      true,
      false,
    ]);
  });

  it.each<readonly [JsonValue, string]>([
    ['true', 'string'],
    [0, 'number'],
    [null, 'object'],
  ])('refuses %j', (json, received) => {
    expect(() => decodeJsonBoolean('demo/flag@1', json)).toThrow(
      refusal('demo/flag@1', 'a boolean', received),
    );
  });
});
