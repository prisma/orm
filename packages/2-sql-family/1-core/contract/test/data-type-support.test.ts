import { describe, expect, it } from 'vitest';
import { escapePslString } from '../src/data-type-support';

describe('escapePslString', () => {
  it.each([
    ['leaves ordinary text alone', 'free', 'free'],
    ['doubles a backslash', 'a\\b', 'a\\\\b'],
    ['escapes a double quote', 'say "hi"', 'say \\"hi\\"'],
    ['escapes a newline', 'one\ntwo', 'one\\ntwo'],
    ['escapes a carriage return', 'one\rtwo', 'one\\rtwo'],
  ])('%s', (_name, value, escaped) => {
    expect(escapePslString(value)).toBe(escaped);
  });
});
