import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonicalize';

describe('canonicalize', () => {
  it('produces same string for objects with different key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('handles nested objects with different key order', () => {
    expect(canonicalize({ outer: { b: 1, a: 2 } })).toBe(canonicalize({ outer: { a: 2, b: 1 } }));
  });

  it('preserves array order', () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it('handles primitives', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(true)).toBe('true');
  });

  it('handles null and undefined', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(undefined)).toBe('undefined');
  });

  it('handles empty objects and arrays', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('produces deterministic output for complex nested structures', () => {
    const a = { z: [1, { y: 2, x: 3 }], a: { c: 1, b: 2 } };
    const b = { a: { b: 2, c: 1 }, z: [1, { x: 3, y: 2 }] };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});
