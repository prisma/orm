import { describe, expect, it } from 'vitest';
import { blindCast, castAs } from '../src/casts';

describe('blindCast', () => {
  it('returns the input unchanged at runtime', () => {
    const input: unknown = { a: 1 };
    const result = blindCast<{ a: number }, 'unit test'>(input);
    expect(result).toBe(input);
  });
});

describe('castAs', () => {
  it('returns the value unchanged at runtime', () => {
    const input = { a: 1 };
    const result = castAs<{ a: number }>(input);
    expect(result).toBe(input);
  });
});
