import { describe, expect, it } from 'vitest';
import { stitchKey } from '../../src/statement-graph/stitch-key';

function temporalLike(tag: string, text: string): object {
  return { [Symbol.toStringTag]: tag, toString: () => text };
}

describe('stitchKey', () => {
  it.each([
    ['a number', 42, '42'],
    ['a string', 'ada', 'ada'],
    ['a boolean', true, 'true'],
    ['a bigint as its decimal text', 9007199254740993n, '9007199254740993'],
    ['a Uint8Array as hex', new Uint8Array([0, 15, 255]), '000fff'],
    ['a Date as ISO 8601 text', new Date('2026-01-02T03:04:05.006Z'), '2026-01-02T03:04:05.006Z'],
    [
      'a Temporal value as its ISO 8601 text',
      temporalLike('Temporal.PlainDate', '2026-01-02'),
      '2026-01-02',
    ],
  ])('turns %s into a string', (_kind, value, expected) => {
    expect(stitchKey([value])).toBe(expected);
  });

  it('turns a composite key into the JSON array of its parts', () => {
    expect(stitchKey([1n, 'a', new Uint8Array([1])])).toBe('["1","a","01"]');
  });

  it('gives equal decoded keys the same string', () => {
    expect(stitchKey([new Uint8Array([1, 2])])).toBe(stitchKey([new Uint8Array([1, 2])]));
    expect(stitchKey([new Date(0)])).toBe(stitchKey([new Date(0)]));
  });

  it.each([
    ['null', null],
    ['an object', { id: 1 }],
    ['an array', [1]],
  ])('refuses a key that decodes to %s', (_kind, value) => {
    expect(() => stitchKey([value])).toThrow(
      expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }),
    );
  });
});
