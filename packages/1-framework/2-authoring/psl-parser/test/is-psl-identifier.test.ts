import { describe, expect, it } from 'vitest';
import { isPslIdentifier } from '../src/tokenizer';

describe('isPslIdentifier', () => {
  it.each(['name', '_hidden', 'naïve', 'kebab-case', 'v2', 'Infinityx'])('accepts %s', (text) => {
    expect(isPslIdentifier(text)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['a leading digit', '2nd'],
    ['a leading hyphen', '-name'],
    ['a space', 'two words'],
    ['a digit outside ASCII', 'v٢'],
    ['a number keyword', 'NaN'],
    ['the infinity keyword', 'Infinity'],
  ])('rejects %s', (_, text) => {
    expect(isPslIdentifier(text)).toBe(false);
  });
});
