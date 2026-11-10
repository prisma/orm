import { describe, expect, it } from 'vitest';
import { parseJsonText, printJsonText } from '../src/shared/json-text';

describe('parseJsonText and printJsonText', () => {
  it('reads a document and writes it back', () => {
    expect(printJsonText(parseJsonText('{ "plan": "free" }'))).toBe('{"plan":"free"}');
  });

  it.each(['null', '[]', '1', '"x"'])('reads %s', (text) => {
    expect(parseJsonText(text)).toEqual(JSON.parse(text));
  });

  it('refuses a body that is not a JSON document', () => {
    expect(() => parseJsonText('{ plan }')).toThrow();
  });

  it.each([
    ['a top-level number that overflows', '1e400', 'The value is Infinity'],
    ['a number nested in an array', '{ "a": [1, [2, -1e400]] }', 'a[1][1] is -Infinity'],
  ])('refuses %s, which JSON cannot write back', (_name, text, where) => {
    expect(() => parseJsonText(text)).toThrow(where);
  });
});
