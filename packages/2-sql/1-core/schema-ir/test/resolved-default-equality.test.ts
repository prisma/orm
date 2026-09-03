import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
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
});
