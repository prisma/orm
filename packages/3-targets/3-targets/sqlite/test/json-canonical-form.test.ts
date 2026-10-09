import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteJsonDescriptor } from '../src/core/codecs';

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
