import { describe, expect, it } from 'vitest';
import { integerLiteralTypesUpTo, type LiteralTypeDeclaration } from '../src/shared/literal-types';
import { writeLiteral } from '../src/shared/literal-types-write';
import { resolvePslBacktickEscapes } from '../src/shared/tagged-literal';

const integers = integerLiteralTypesUpTo('i64');

describe('writeLiteral', () => {
  describe('each type writes its own value', () => {
    it.each([
      ['a string', 'anonymous', ['string'], '"anonymous"'],
      ['a string with quotes and backslashes', 'a"b\\c', ['string'], '"a\\"b\\\\c"'],
      ['a string with a newline', 'a\nb', ['string'], '"a\\nb"'],
      ['true', true, ['boolean'], 'true'],
      ['false', false, ['boolean'], 'false'],
      ['an i8 number', 42, ['i8'], '42'],
      ['an i16 number', 1000, integers, '1000'],
      ['an i64 as digit text', '9007199254740993', integers, '9007199254740993'],
      ['a bigint as digit text', '9223372036854775808', ['bigint'], '9223372036854775808'],
      ['a decimal as text', '1.50', ['decimal'], '1.50'],
      ['NaN unquoted', 'NaN', ['float'], 'NaN'],
      ['Infinity unquoted', 'Infinity', ['float'], 'Infinity'],
      ['-Infinity unquoted', '-Infinity', ['float'], '-Infinity'],
    ] as [string, never, readonly LiteralTypeDeclaration[], string][])(
      '%s',
      (_name, value, declarations, text) => {
        expect(writeLiteral(value, declarations)).toEqual({ text });
      },
    );
  });

  it('writes a fractional number through the decimal declaration', () => {
    expect(writeLiteral(1.5, ['i8', 'i16', 'i32', 'decimal'])).toEqual({ text: '1.5' });
  });

  it('writes digit text through the first integer type that holds it', () => {
    expect(writeLiteral('42', integers)).toEqual({ text: '42' });
  });

  it('writes a number past the exponent threshold without an exponent', () => {
    expect(writeLiteral(1e21, ['bigint'])).toEqual({ text: '1000000000000000000000' });
  });

  it('writes a non-finite number unquoted', () => {
    expect(writeLiteral(Number.NaN, ['float'])).toEqual({ text: 'NaN' });
  });

  describe('json', () => {
    it('writes a json tag with a backtick fence', () => {
      expect(writeLiteral({ plan: 'free', seats: 1 }, ['json'])).toEqual({
        text: 'json`{"plan":"free","seats":1}`',
        tag: 'json',
      });
    });

    it('writes json null', () => {
      expect(writeLiteral(null, ['json'])).toEqual({ text: 'json`null`', tag: 'json' });
    });

    it('escapes a backslash inside the backtick fence', () => {
      expect(writeLiteral({ a: '\\' }, ['json'])).toEqual({
        text: 'json`{"a":"\\\\\\\\"}`',
        tag: 'json',
      });
    });

    it('escapes a backtick inside the backtick fence', () => {
      expect(writeLiteral({ a: '`' }, ['json'])).toEqual({
        text: 'json`{"a":"\\`"}`',
        tag: 'json',
      });
    });

    it.each([
      ['a backtick', { a: '`' }],
      ['a backslash', { a: '\\' }],
      ['a backslash before a backtick', { a: '\\`' }],
      ['an escape sequence a quote fence would resolve', { a: 'x\ny' }],
    ])('round-trips %s through the fence escapes', (_name, value) => {
      const written = writeLiteral(value, ['json']);
      if (written === undefined) throw new Error('expected a json literal');
      const body = written.text.slice('json`'.length, -1);
      expect(JSON.parse(resolvePslBacktickEscapes(body))).toEqual(value);
    });
  });

  describe('lists', () => {
    it('writes each element against the declaration element types', () => {
      expect(writeLiteral([0.1, 0.2], [{ list: ['i8', 'decimal'] }])).toEqual({
        text: '[0.1, 0.2]',
      });
    });

    it('writes an empty list', () => {
      expect(writeLiteral([], [{ list: ['i8'] }])).toEqual({ text: '[]' });
    });

    it('refuses a list with an element no element type writes', () => {
      expect(writeLiteral([1, 'x'], [{ list: ['i8'] }])).toBeUndefined();
    });

    it('refuses a list against scalar declarations only', () => {
      expect(writeLiteral([1], ['i8'])).toBeUndefined();
    });
  });

  it('tries the declarations in order and takes the first that writes', () => {
    expect(writeLiteral('42', ['string', ...integers])).toEqual({ text: '"42"' });
    expect(writeLiteral('42', [...integers, 'string'])).toEqual({ text: '42' });
  });

  it.each([
    ['a string against integer declarations', 'nonsense', integers],
    ['a boolean against string declarations', true, ['string'] as const],
    ['a number against no declarations', 1, [] as const],
    ['a fractional number against integer declarations', 1.5, integers],
    ['a non-finite number against decimal declarations', Number.NaN, ['decimal'] as const],
  ] as [string, never, readonly LiteralTypeDeclaration[]][])(
    'returns undefined for %s',
    (_name, value, declarations) => {
      expect(writeLiteral(value, declarations)).toBeUndefined();
    },
  );
});
