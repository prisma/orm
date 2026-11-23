import { describe, expect, it } from 'vitest';
import { isRecord } from '../src/guards';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    expect([isRecord({}), isRecord({ a: 1 }), isRecord(Object.create(null))]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('rejects null, arrays, primitives and functions', () => {
    expect(
      [null, undefined, [], [1], 0, 'text', true, () => undefined].map((value) => isRecord(value)),
    ).toEqual([false, false, false, false, false, false, false, false]);
  });
});
