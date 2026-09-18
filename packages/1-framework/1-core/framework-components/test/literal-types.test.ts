import { describe, expect, it } from 'vitest';
import {
  describeDeclarations,
  integerLiteralTypesUpTo,
  isCompatible,
  isNonFiniteText,
  isNumeralText,
  type Literal,
  type LiteralTypeDeclaration,
  readLiteral,
  type WrittenLiteral,
} from '../src/shared/literal-types';

const number = (text: string): WrittenLiteral => ({ kind: 'number', text });

function readOk(written: WrittenLiteral): Literal {
  const result = readLiteral(written);
  if (!result.ok) throw new Error(`expected a literal, got ${result.reason}: ${result.message}`);
  return result.literal;
}

describe('readLiteral', () => {
  describe('whole numbers', () => {
    it.each([
      ['zero', '0', 'i8', 0],
      ['the sign of zero dropped', '-0', 'i8', 0],
      ['leading zeros dropped', '007', 'i8', 7],
      ['the largest i8', '127', 'i8', 127],
      ['the smallest i8', '-128', 'i8', -128],
      ['one past the largest i8', '128', 'i16', 128],
      ['one past the smallest i8', '-129', 'i16', -129],
      ['the largest i16', '32767', 'i16', 32767],
      ['one past the largest i16', '32768', 'i32', 32768],
      ['the smallest i16', '-32768', 'i16', -32768],
      ['one past the smallest i16', '-32769', 'i32', -32769],
      ['the largest i32', '2147483647', 'i32', 2147483647],
      ['one past the largest i32', '2147483648', 'i64', '2147483648'],
      ['the smallest i32', '-2147483648', 'i32', -2147483648],
      ['one past the smallest i32', '-2147483649', 'i64', '-2147483649'],
      ['past the safe integer range', '9007199254740993', 'i64', '9007199254740993'],
      ['the largest i64', '9223372036854775807', 'i64', '9223372036854775807'],
      ['the smallest i64', '-9223372036854775808', 'i64', '-9223372036854775808'],
      ['one past the largest i64', '9223372036854775808', 'bigint', '9223372036854775808'],
      ['one past the smallest i64', '-9223372036854775809', 'bigint', '-9223372036854775809'],
      [
        'leading zeros dropped from a bigint',
        '009223372036854775808',
        'bigint',
        '9223372036854775808',
      ],
    ])('%s', (_name, text, type, value) => {
      expect(readOk(number(text))).toEqual({ type, value });
    });
  });

  describe('decimals', () => {
    it.each([
      ['trailing zeros kept', '1.50', '1.50'],
      ['leading zeros dropped', '007.50', '7.50'],
      ['the sign of zero dropped', '-0.0', '0.0'],
      ['a negative decimal keeps its sign', '-007.50', '-7.50'],
      ['a large decimal is kept as text', '9223372036854775808.5', '9223372036854775808.5'],
    ])('%s', (_name, text, value) => {
      expect(readOk(number(text))).toEqual({ type: 'decimal', value });
    });
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('%s is a float literal', (text) => {
    expect(readOk(number(text))).toEqual({ type: 'float', value: text });
  });

  it.each(['1e3', '+1', '1.', '', 'nonsense'])('refuses the number text %o', (text) => {
    expect(readLiteral(number(text))).toEqual({
      ok: false,
      reason: 'invalid-number',
      message: expect.stringContaining(text),
      elementIndex: undefined,
    });
  });

  it('reads a string', () => {
    expect(readOk({ kind: 'string', text: 'anonymous' })).toEqual({
      type: 'string',
      value: 'anonymous',
    });
  });

  it.each([true, false])('reads the boolean %s', (value) => {
    expect(readOk({ kind: 'boolean', value })).toEqual({ type: 'boolean', value });
  });

  describe('json', () => {
    it.each([
      ['an object', '{ "plan": "free", "seats": 1 }', { plan: 'free', seats: 1 }],
      ['an array', '[1, 2]', [1, 2]],
      ['null', 'null', null],
      ['a string', '"a"', 'a'],
    ])('reads %s', (_name, text, value) => {
      expect(readOk({ kind: 'json', text })).toEqual({ type: 'json', value });
    });

    it('refuses text that is not json, with the parser message', () => {
      const result = readLiteral({ kind: 'json', text: '{ plan }' });
      expect(result).toMatchObject({ ok: false, reason: 'invalid-json' });
      expect(result.ok ? '' : result.message).not.toBe('');
    });
  });

  describe('lists', () => {
    it('reads the element types in first-seen order', () => {
      expect(
        readOk({ kind: 'list', elements: [number('1'), number('2'), number('40000')] }),
      ).toEqual({ type: { list: ['i8', 'i32'] }, value: [1, 2, 40000] });
    });

    it('reads an empty list', () => {
      expect(readOk({ kind: 'list', elements: [] })).toEqual({ type: { list: [] }, value: [] });
    });

    it('reports the refusal of an element at that element', () => {
      expect(readLiteral({ kind: 'list', elements: [number('1'), number('1e3')] })).toEqual({
        ok: false,
        reason: 'invalid-number',
        message: expect.stringContaining('1e3'),
        elementIndex: 1,
      });
    });

    it('refuses a nested list at that element', () => {
      expect(
        readLiteral({ kind: 'list', elements: [number('1'), { kind: 'list', elements: [] }] }),
      ).toEqual({
        ok: false,
        reason: 'invalid-number',
        message: 'A list literal cannot contain another list.',
        elementIndex: 1,
      });
    });
  });
});

describe('isCompatible', () => {
  const scalars: readonly LiteralTypeDeclaration[] = ['i8', 'i16', 'i32'];
  const lists: readonly LiteralTypeDeclaration[] = [{ list: ['i8', 'decimal'] }];

  it('accepts a scalar named by the declarations', () => {
    expect(isCompatible(readOk(number('42')), scalars)).toBe(true);
  });

  it('refuses a scalar the declarations do not name', () => {
    expect(isCompatible(readOk(number('42000000000')), scalars)).toBe(false);
  });

  it('refuses every literal against no declarations', () => {
    expect(isCompatible(readOk(number('42')), [])).toBe(false);
  });

  it('accepts a list whose element types the list declaration names', () => {
    expect(
      isCompatible(readOk({ kind: 'list', elements: [number('1'), number('1.5')] }), lists),
    ).toBe(true);
  });

  it('refuses a list with an element type outside the list declaration', () => {
    expect(
      isCompatible(
        readOk({ kind: 'list', elements: [number('1'), { kind: 'string', text: 'x' }] }),
        lists,
      ),
    ).toBe(false);
  });

  it('refuses a list against scalar declarations only', () => {
    expect(isCompatible(readOk({ kind: 'list', elements: [number('1')] }), scalars)).toBe(false);
  });

  it('refuses a scalar against a list declaration only', () => {
    expect(isCompatible(readOk(number('1')), lists)).toBe(false);
  });
});

describe('describeDeclarations', () => {
  it.each([
    ['no literal defaults', []],
    ['i8, i16, i32 literals', ['i8', 'i16', 'i32']],
    ['a list of i8, decimal literals', [{ list: ['i8', 'decimal'] }]],
    ['string literals and a list of i8 literals', ['string', { list: ['i8'] }]],
  ] as const)('reads %o', (expected, declarations) => {
    expect(describeDeclarations(declarations)).toBe(expected);
  });
});

describe('integerLiteralTypesUpTo', () => {
  it.each([
    ['i8', ['i8']],
    ['i32', ['i8', 'i16', 'i32']],
    ['i64', ['i8', 'i16', 'i32', 'i64']],
    ['bigint', ['i8', 'i16', 'i32', 'i64', 'bigint']],
  ] as const)('%s', (name, expected) => {
    expect(integerLiteralTypesUpTo(name)).toEqual(expected);
  });
});

describe('isNumeralText', () => {
  it.each(['0', '-0', '007', '9223372036854775808', '1.50', '-007.50'])(
    'accepts %o, which classifies as a literal type',
    (text) => {
      expect(isNumeralText(text)).toBe(true);
      expect(readLiteral(number(text)).ok).toBe(true);
    },
  );

  it.each(['NaN', 'Infinity', '-Infinity', '1e3', '+1', '1.', '', 'nonsense', '1,5'])(
    'refuses %o',
    (text) => {
      expect(isNumeralText(text)).toBe(false);
    },
  );
});

describe('isNonFiniteText', () => {
  it.each(['NaN', 'Infinity', '-Infinity'])(
    'accepts %o, which reads as a float literal',
    (text) => {
      expect(isNonFiniteText(text)).toBe(true);
      expect(readOk(number(text))).toEqual({ type: 'float', value: text });
    },
  );

  it.each(['nan', 'infinity', '42', '1.5', ''])('refuses %o', (text) => {
    expect(isNonFiniteText(text)).toBe(false);
  });
});
