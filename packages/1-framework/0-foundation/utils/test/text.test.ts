import { describe, expect, it } from 'vitest';
import { clipToUtf8Bytes, counted, utf8ByteLength, withoutTrailing } from '../src/text';

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

describe('utf8ByteLength', () => {
  it('counts a multibyte character by its UTF-8 bytes', () => {
    expect(utf8ByteLength('aü€😀')).toBe(1 + 2 + 3 + 4);
  });
});

describe('clipToUtf8Bytes', () => {
  it('returns text that fits whole', () => {
    expect(clipToUtf8Bytes('abc', 3)).toBe('abc');
  });

  it('cuts ASCII text to the byte budget', () => {
    expect(clipToUtf8Bytes('abcdef', 4)).toBe('abcd');
  });

  it('cuts before a multibyte character that would cross the budget', () => {
    expect(clipToUtf8Bytes('aüü', 4)).toBe('aü');
  });

  it('keeps a surrogate pair whole or leaves it out', () => {
    expect(clipToUtf8Bytes('a😀', 4)).toBe('a');
    expect(clipToUtf8Bytes('a😀', 5)).toBe('a😀');
  });
});
