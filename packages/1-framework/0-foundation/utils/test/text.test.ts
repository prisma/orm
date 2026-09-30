import { describe, expect, it } from 'vitest';
import { counted, withoutTrailing } from '../src/text';

describe('withoutTrailing', () => {
  it.each([
    ['a  ', ' ', 'a'],
    ['a\t ', ' ', 'a\t'],
    [' a', ' ', ' a'],
    ['   ', ' ', ''],
    ['', ' ', ''],
    ['1500', '0', '15'],
    ['105', '0', '105'],
  ])('drops the trailing run of %j from %j', (text, character, expected) => {
    expect(withoutTrailing(text, character)).toBe(expected);
  });

  it('drops a trailing run after a long interior run in one pass', () => {
    const text = `${' '.repeat(100_000)}x${' '.repeat(100_000)}`;
    expect(withoutTrailing(text, ' ')).toBe(`${' '.repeat(100_000)}x`);
  });
});

describe('counted', () => {
  it('writes a count and its noun, plural unless the count is one', () => {
    expect([counted(0, 'character'), counted(1, 'character'), counted(3, 'bit')]).toEqual([
      '0 characters',
      '1 character',
      '3 bits',
    ]);
  });
});
