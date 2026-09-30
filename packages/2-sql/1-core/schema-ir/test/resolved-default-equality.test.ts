import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  JsonValue,
} from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';

import { resolvedDefaultsEqual } from '../src/ir/resolved-default-equality';

const literal = (value: ColumnDefaultLiteralInputValue): ColumnDefault => ({
  kind: 'literal',
  value,
});

const fn = (expression: string): ColumnDefault => ({ kind: 'function', expression });

describe('resolvedDefaultsEqual', () => {
  describe('across kinds', () => {
    it('a literal never equals a function', () => {
      expect(resolvedDefaultsEqual(literal('now'), fn('now()'))).toBe(false);
    });

    it('a raw expression never equals a literal, even one it spells', () => {
      const expression = fn("'confidential'::auth.oauth_client_type");
      expect({
        expressionFirst: resolvedDefaultsEqual(expression, literal('confidential'), 'text'),
        literalFirst: resolvedDefaultsEqual(literal('confidential'), expression, 'text'),
      }).toEqual({ expressionFirst: false, literalFirst: false });
    });

    it('a kind outside the union compares unequal rather than throwing', () => {
      const rogue = { kind: 'sequence', value: 1 } as unknown as ColumnDefault;

      expect(resolvedDefaultsEqual(rogue, rogue)).toBe(false);
    });
  });

  describe('function defaults', () => {
    it('ignores case and whitespace', () => {
      expect(resolvedDefaultsEqual(fn('NOW( )'), fn('now()'))).toBe(true);
    });

    it('fires on a materially different expression', () => {
      expect(resolvedDefaultsEqual(fn('now()'), fn('clock_timestamp()'))).toBe(false);
    });
  });

  describe('literal defaults', () => {
    it('compares primitives by identity', () => {
      expect({
        same: resolvedDefaultsEqual(literal(7), literal(7)),
        different: resolvedDefaultsEqual(literal(7), literal(8)),
      }).toEqual({ same: true, different: false });
    });

    it('compares two objects canonically, so key order does not matter', () => {
      expect(resolvedDefaultsEqual(literal({ a: 1, b: 2 }), literal({ b: 2, a: 1 }))).toBe(true);
    });

    it('compares an object against its JSON text in either position', () => {
      expect({
        objectFirst: resolvedDefaultsEqual(literal({ a: 1 }), literal('{"a":1}')),
        stringFirst: resolvedDefaultsEqual(literal('{"a":1}'), literal({ a: 1 })),
      }).toEqual({ objectFirst: true, stringFirst: true });
    });

    it('treats unparseable text against an object as unequal', () => {
      expect({
        objectFirst: resolvedDefaultsEqual(literal({ a: 1 }), literal('not json')),
        stringFirst: resolvedDefaultsEqual(literal('not json'), literal({ a: 1 })),
      }).toEqual({ objectFirst: false, stringFirst: false });
    });

    it('fires on two objects with different contents', () => {
      expect(resolvedDefaultsEqual(literal({ a: 1 }), literal({ a: 2 }))).toBe(false);
    });
  });

  describe('literals of a type with a canonical form', () => {
    const canonicalForms = new Map([
      ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00Z'],
      ['2026-01-01 00:00:00+00', '2026-01-01T00:00:00Z'],
      ['2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'],
    ]);
    const toCanonicalForm = (value: JsonValue): JsonValue => {
      const canonical = typeof value === 'string' ? canonicalForms.get(value) : undefined;
      if (canonical === undefined) {
        throw structuredError(
          'CONTRACT.CAST_REFUSED',
          `${JSON.stringify(value)} is not a date and time`,
        );
      }
      return canonical;
    };

    it('compares two forms of one value through the canonical form', () => {
      expect({
        millisecondText: resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-01T00:00:00.000Z'),
          'timestamptz',
          toCanonicalForm,
        ),
        databaseText: resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-01 00:00:00+00'),
          'timestamptz',
          toCanonicalForm,
        ),
      }).toEqual({ millisecondText: true, databaseText: true });
    });

    it('compares a Date through the canonical form of the ISO text it denotes', () => {
      expect(
        resolvedDefaultsEqual(
          literal(new Date('2026-01-01T00:00:00.000Z')),
          literal('2026-01-01 00:00:00+00'),
          'timestamptz',
          toCanonicalForm,
        ),
      ).toBe(true);
    });

    it('fires on two different values', () => {
      expect(
        resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-02T00:00:00Z'),
          'timestamptz',
          toCanonicalForm,
        ),
      ).toBe(false);
    });

    it('compares a value the canonical form refuses as it is', () => {
      expect({
        same: resolvedDefaultsEqual(
          literal('not a date'),
          literal('not a date'),
          'timestamptz',
          toCanonicalForm,
        ),
        other: resolvedDefaultsEqual(
          literal('not a date'),
          literal('2026-01-01T00:00:00Z'),
          'timestamptz',
          toCanonicalForm,
        ),
      }).toEqual({ same: true, other: false });
    });

    it('compares two forms as they are without a canonical form, whatever the native type', () => {
      expect(
        resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-01T00:00:00.000Z'),
          'timestamptz',
        ),
      ).toBe(false);
    });

    it('compares each element of a list through the canonical form', () => {
      expect(
        resolvedDefaultsEqual(
          literal(['2026-01-01T00:00:00.000Z']),
          literal(['2026-01-01 00:00:00+00']),
          'timestamptz[]',
          toCanonicalForm,
        ),
      ).toBe(true);
    });
  });

  describe('numeric literals', () => {
    const nativeType = 'numeric(65,30)';

    it('matches a number against the decimal text it denotes', () => {
      expect({
        numberFirst: resolvedDefaultsEqual(literal(12.34), literal('12.34'), nativeType),
        textFirst: resolvedDefaultsEqual(literal('-0.5'), literal(-0.5), 'numeric'),
      }).toEqual({ numberFirst: true, textFirst: true });
    });

    it('ignores zeros that do not change the value under a type with a scale', () => {
      expect({
        trailing: resolvedDefaultsEqual(literal('1.5'), literal('1.50'), nativeType),
        whole: resolvedDefaultsEqual(literal(10), literal('10.000'), nativeType),
        leading: resolvedDefaultsEqual(literal('0.5'), literal('00.5'), nativeType),
        negativeZero: resolvedDefaultsEqual(literal('0'), literal('-0.0'), nativeType),
        scaleZero: resolvedDefaultsEqual(literal('2'), literal('2.0'), 'numeric(10,0)'),
        negativeScale: resolvedDefaultsEqual(literal(12300), literal('12300.0'), 'numeric(5,-2)'),
      }).toEqual({
        trailing: true,
        whole: true,
        leading: true,
        negativeZero: true,
        scaleZero: true,
        negativeScale: true,
      });
    });

    it('compares the decimal text exactly under a type without a scale, which stores it as written', () => {
      expect({
        trailingText: resolvedDefaultsEqual(literal('1.5'), literal('1.50'), 'numeric'),
        trailingNumber: resolvedDefaultsEqual(literal(1.5), literal('1.50'), 'numeric'),
        decimal: resolvedDefaultsEqual(literal('10'), literal('10.0'), 'decimal'),
        same: resolvedDefaultsEqual(literal('1.50'), literal('1.50'), 'numeric'),
      }).toEqual({ trailingText: false, trailingNumber: false, decimal: false, same: true });
    });

    it('compares every digit of the decimal text', () => {
      expect({
        rounded: resolvedDefaultsEqual(
          literal(12345678901234567000),
          literal('12345678901234567890.123456789'),
          nativeType,
        ),
        lastDigit: resolvedDefaultsEqual(
          literal('0.000000000000000001'),
          literal('0.000000000000000002'),
          nativeType,
        ),
      }).toEqual({ rounded: false, lastDigit: false });
    });

    it('compares text that is not a numeral by identity', () => {
      expect({
        same: resolvedDefaultsEqual(literal('NaN'), literal('NaN'), nativeType),
        different: resolvedDefaultsEqual(literal('NaN'), literal('Infinity'), nativeType),
      }).toEqual({ same: true, different: false });
    });

    it('matches a number JavaScript prints in exponent notation against its decimal text', () => {
      expect({
        small: resolvedDefaultsEqual(literal(1e-7), literal('0.0000001'), nativeType),
        smallWithoutScale: resolvedDefaultsEqual(literal(1e-7), literal('0.0000001'), 'numeric'),
        large: resolvedDefaultsEqual(literal(1e21), literal('1000000000000000000000'), nativeType),
        largeWithoutScale: resolvedDefaultsEqual(
          literal(1e21),
          literal('1000000000000000000000'),
          'numeric',
        ),
        negative: resolvedDefaultsEqual(literal(-1.5e-7), literal('-0.00000015'), nativeType),
        textFirst: resolvedDefaultsEqual(literal('0.0000001'), literal(1e-7), nativeType),
      }).toEqual({
        small: true,
        smallWithoutScale: true,
        large: true,
        largeWithoutScale: true,
        negative: true,
        textFirst: true,
      });
    });

    it('still separates two numbers in exponent notation that differ', () => {
      expect(resolvedDefaultsEqual(literal(1e-7), literal('0.0000002'), nativeType)).toBe(false);
    });

    it('leaves a number against its decimal text alone without a numeric native type', () => {
      expect(resolvedDefaultsEqual(literal(1.5), literal('1.5'), 'float8')).toBe(false);
    });
  });

  describe('list literals', () => {
    it('normalizes each element under the element type', () => {
      expect(resolvedDefaultsEqual(literal([12.5]), literal(['12.50']), 'numeric(10,2)[]')).toBe(
        true,
      );
    });

    it('fires when an element or the length differs', () => {
      expect({
        element: resolvedDefaultsEqual(literal(['1', '2']), literal(['1', '3']), 'int8[]'),
        length: resolvedDefaultsEqual(literal(['1']), literal(['1', '2']), 'int8[]'),
        unscaledTrailingZero: resolvedDefaultsEqual(
          literal(['1.5']),
          literal(['1.50']),
          'numeric[]',
        ),
      }).toEqual({ element: false, length: false, unscaledTrailingZero: false });
    });

    it('leaves the elements alone without a list native type', () => {
      expect(resolvedDefaultsEqual(literal([1]), literal(['1']), 'jsonb')).toBe(false);
    });
  });
});
