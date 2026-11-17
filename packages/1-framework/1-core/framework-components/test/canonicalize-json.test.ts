import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/exports/utils';

describe('canonicalizeJson', () => {
  it('sorts object keys lexicographically', () => {
    const result = canonicalizeJson({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const result = canonicalizeJson({ b: { d: 1, c: 2 }, a: 3 });
    expect(result).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('preserves array order', () => {
    const result = canonicalizeJson({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('sorts keys inside array elements', () => {
    const result = canonicalizeJson([
      { z: 1, a: 2 },
      { y: 3, b: 4 },
    ]);
    expect(result).toBe('[{"a":2,"z":1},{"b":4,"y":3}]');
  });

  it('handles primitives', () => {
    expect(canonicalizeJson('hello')).toBe('"hello"');
    expect(canonicalizeJson(42)).toBe('42');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson(null)).toBe('null');
  });

  it('handles empty structures', () => {
    expect(canonicalizeJson({})).toBe('{}');
    expect(canonicalizeJson([])).toBe('[]');
  });

  it('preserves a __proto__ input key without mutating Object.prototype', () => {
    const protoBefore = Object.getPrototypeOf({});
    const polluted = Object.prototype as unknown as { polluted?: unknown };
    const sentinel = { polluted: 'yes' };
    const input = JSON.parse('{"__proto__": {"polluted": "yes"}, "a": 1}') as Record<
      string,
      unknown
    >;
    Object.defineProperty(input, '__proto__', {
      value: sentinel,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const result = canonicalizeJson(input);
    expect(result).toBe('{"__proto__":{"polluted":"yes"},"a":1}');
    expect(Object.getPrototypeOf({})).toBe(protoBefore);
    expect(polluted.polluted).toBeUndefined();
  });
});
