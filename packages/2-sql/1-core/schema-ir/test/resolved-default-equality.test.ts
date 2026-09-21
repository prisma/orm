import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  describe('temporal literals', () => {
    const nativeType = 'timestamptz';

    it('normalizes a Date against the ISO instant it denotes', () => {
      expect(
        resolvedDefaultsEqual(
          literal(new Date('2026-01-01T00:00:00.000Z')),
          literal('2026-01-01T00:00:00.000Z'),
          nativeType,
        ),
      ).toBe(true);
    });

    it('normalizes two spellings of the same instant under a temporal native type', () => {
      expect(
        resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-01T00:00:00.000Z'),
          nativeType,
        ),
      ).toBe(true);
    });

    it('leaves the spellings alone without a temporal native type', () => {
      expect(
        resolvedDefaultsEqual(
          literal('2026-01-01T00:00:00Z'),
          literal('2026-01-01T00:00:00.000Z'),
          'text',
        ),
      ).toBe(false);
    });

    it('leaves an unparseable string alone under a temporal native type', () => {
      expect(resolvedDefaultsEqual(literal('not a date'), literal('not a date'), nativeType)).toBe(
        true,
      );
    });

    it('reads the year of a timestamp Postgres prints with an offset, below year 100 too', () => {
      expect({
        sameInstant: resolvedDefaultsEqual(
          literal('0001-01-01T00:00:00Z'),
          literal('0001-01-01 00:00:00+00'),
          'timestamptz(6)',
        ),
        otherCentury: resolvedDefaultsEqual(
          literal('1950-01-01T00:00:00Z'),
          literal('0050-01-01 00:00:00+00'),
          'timestamptz(6)',
        ),
        halfHourOffset: resolvedDefaultsEqual(
          literal('2024-01-01T21:34:05Z'),
          literal('2024-01-02 03:04:05+05:30'),
          'timestamptz(6)',
        ),
      }).toEqual({ sameInstant: true, otherCentury: false, halfHourOffset: true });
    });

    it('compares a timestamp before year one by its text', () => {
      expect({
        same: resolvedDefaultsEqual(
          literal('0001-12-31 23:30:00+00 BC'),
          literal('0001-12-31 23:30:00+00 BC'),
          'timestamptz(6)',
        ),
        yearOne: resolvedDefaultsEqual(
          literal('0001-12-31 23:30:00+00 BC'),
          literal('0001-12-31 23:30:00+00'),
          'timestamptz(6)',
        ),
      }).toEqual({ same: true, yearOne: false });
    });
  });

  describe('int64 literals', () => {
    it('matches a safe-integer number against the decimal text it denotes, under int8', () => {
      expect({
        numberFirst: resolvedDefaultsEqual(literal(0), literal('0'), 'int8'),
        textFirst: resolvedDefaultsEqual(literal('0'), literal(0), 'int8'),
      }).toEqual({ numberFirst: true, textFirst: true });
    });

    it('matches a safe-integer number against the decimal text it denotes, under bigint', () => {
      expect(resolvedDefaultsEqual(literal(42), literal('42'), 'bigint')).toBe(true);
    });

    it('matches a negative safe integer against its decimal text', () => {
      expect(resolvedDefaultsEqual(literal(-7), literal('-7'), 'int8')).toBe(true);
    });

    it('fires when the decimal text denotes a different number', () => {
      expect(resolvedDefaultsEqual(literal(1), literal('2'), 'int8')).toBe(false);
    });

    it('leaves a number against its decimal text alone without an int8/bigint native type', () => {
      expect(resolvedDefaultsEqual(literal(0), literal('0'), 'int4')).toBe(false);
      expect(resolvedDefaultsEqual(literal(0), literal('0'))).toBe(false);
    });

    it('declines to match a rounded number against the exact decimal text it lost', () => {
      expect(
        resolvedDefaultsEqual(literal('9007199254740993'), literal(9007199254740992), 'int8'),
      ).toBe(false);
    });

    it('declines to match outside the safe-integer range, even when the text is exact', () => {
      expect(resolvedDefaultsEqual(literal(1e17), literal('100000000000000000'), 'int8')).toBe(
        false,
      );
    });

    it('still compares two decimal-text strings by identity past the safe integer range', () => {
      expect(
        resolvedDefaultsEqual(literal('9007199254740993'), literal('9007199254740993'), 'int8'),
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
      }).toEqual({
        trailing: true,
        whole: true,
        leading: true,
        negativeZero: true,
        scaleZero: true,
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
      expect({
        timestamps: resolvedDefaultsEqual(
          literal(['2024-01-01T00:00:00.000Z']),
          literal(['2024-01-01 00:00:00']),
          'timestamp(3)[]',
        ),
        int8: resolvedDefaultsEqual(literal([1, -2]), literal(['1', '-2']), 'int8[]'),
        numeric: resolvedDefaultsEqual(literal([12.5]), literal(['12.50']), 'numeric(10,2)[]'),
      }).toEqual({ timestamps: true, int8: true, numeric: true });
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

describe('resolvedDefaultsEqual zoneless timestamp literals', () => {
  // `timestamp without time zone` defaults introspect without a zone
  // (`'2024-01-01 00:00:00'`); the contract writes the same wall time as an
  // ISO instant. Both are the same wall-clock value and must compare equal
  // whatever the host timezone is, so the test pins one that is not UTC.
  const previousTz = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'Etc/GMT-3';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previousTz;
  });

  it('treats a zoneless timestamp literal as UTC under a timestamp native type', () => {
    expect(
      resolvedDefaultsEqual(
        literal('2024-01-01T00:00:00.000Z'),
        literal('2024-01-01 00:00:00'),
        'timestamp(3)',
      ),
    ).toBe(true);
  });

  it('keeps a zoned literal on its own zone', () => {
    expect(
      resolvedDefaultsEqual(
        literal('2024-01-01T00:00:00.000Z'),
        literal('2024-01-01 03:00:00+03'),
        'timestamptz',
      ),
    ).toBe(true);
    expect(
      resolvedDefaultsEqual(
        literal('2024-01-01T00:00:00.000Z'),
        literal('2024-01-01 00:00:00+03'),
        'timestamptz',
      ),
    ).toBe(false);
  });
});
