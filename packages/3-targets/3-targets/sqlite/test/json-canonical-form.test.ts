import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteJsonDescriptor } from '../src/core/codecs';
import { fromContractJson } from './contract-json';

describe('sqlite/json@1 canonical form', () => {
  it.each([
    ['{ "b": 1, "a": [true, null] }', '{"a":[true,null],"b":1}'],
    ['{"a":{"d":1,"c":2}}', '{"a":{"c":2,"d":1}}'],
    [' "plain" ', '"plain"'],
    ['null', 'null'],
    ['1.50', '1.5'],
  ])('turns the JSON text %s into %s, the JSON text of the same document', (text, canonical) => {
    expect(sqliteJsonDescriptor.toCanonicalForm?.(text)).toBe(canonical);
  });

  it.each<readonly [string, JsonValue]>([
    ['text that is not JSON', 'hello'],
    ['a value that is not text', { a: 1 }],
  ])('refuses %s with a cast-level code', (_name, value) => {
    expect(() => sqliteJsonDescriptor.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});

describe('sqlite/json@1 reads only the JSON text it stores', () => {
  const codec = sqliteJsonDescriptor.factory()({ name: '<test>' });

  it('refuses the JSON text a row holds in another spelling, naming the stored form', () => {
    expect(() => fromContractJson(codec, '{ "b": 1, "a": 2 }')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'sqlite/json@1 JSON value must be "{\\"a\\":2,\\"b\\":1}", as sqlite/json@1 stores this value',
      }),
    );
  });

  it('reads the stored form', () => {
    expect(fromContractJson(codec, '{"a":2,"b":1}')).toEqual({ a: 2, b: 1 });
  });
});
