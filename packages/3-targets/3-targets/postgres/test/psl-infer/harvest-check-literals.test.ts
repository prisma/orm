import { describe, expect, it } from 'vitest';
import { harvestCheckLiterals } from '../../src/core/psl-infer/harvest-check-literals';

describe('harvestCheckLiterals', () => {
  describe('captured reprint corpus shapes', () => {
    it('text one-member', () => {
      expect(harvestCheckLiterals(`(role = 'user'::text)`)).toEqual(['user']);
    });

    it('text many-member', () => {
      expect(harvestCheckLiterals(`(role = ANY (ARRAY['user'::text, 'admin'::text]))`)).toEqual([
        'user',
        'admin',
      ]);
    });

    it('varchar one-member', () => {
      expect(harvestCheckLiterals(`((status)::text = 'a'::text)`)).toEqual(['a']);
    });

    it('varchar many-member', () => {
      expect(
        harvestCheckLiterals(
          `((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))`,
        ),
      ).toEqual(['a', 'b']);
    });

    it('array containment', () => {
      expect(harvestCheckLiterals(`(tags <@ ARRAY['user'::text, 'admin'::text])`)).toEqual([
        'user',
        'admin',
      ]);
    });

    it('doubled quote inside a member unescapes', () => {
      expect(
        harvestCheckLiterals(`(surname = ANY (ARRAY['O''Brien'::text, 'plain'::text]))`),
      ).toEqual([`O'Brien`, 'plain']);
    });
  });

  describe('predicates without literals', () => {
    it('a numeric comparison yields nothing', () => {
      expect(harvestCheckLiterals('(cardinality(tags) > 0)')).toEqual([]);
    });

    it('an empty string yields nothing', () => {
      expect(harvestCheckLiterals('')).toEqual([]);
    });
  });

  describe('free-form corpus predicates', () => {
    it('a composite AND harvests its literals in order', () => {
      expect(harvestCheckLiterals(`((a > 0) AND (b <> ''::text))`)).toEqual(['']);
    });

    it('a cast-wrapped numeric predicate yields nothing', () => {
      expect(harvestCheckLiterals('(price > (0)::numeric)')).toEqual([]);
    });
  });

  describe('quoting edge cases', () => {
    it('a literal that is only a doubled quote', () => {
      expect(harvestCheckLiterals(`(x = '''')`)).toEqual([`'`]);
    });

    it('an empty literal', () => {
      expect(harvestCheckLiterals(`(x = '')`)).toEqual(['']);
    });

    it('consecutive doubled quotes inside a member', () => {
      expect(harvestCheckLiterals(`(x = 'a''''b')`)).toEqual([`a''b`]);
    });

    it('cast type names are never harvested', () => {
      expect(harvestCheckLiterals(`(role = 'user'::text)`)).not.toContain('text');
      expect(harvestCheckLiterals(`((status)::text = 'a'::character varying)`)).toEqual(['a']);
    });

    it('double-quoted identifiers are not literals', () => {
      expect(harvestCheckLiterals(`("role" = 'user'::text)`)).toEqual(['user']);
    });

    it('literals separated by non-literal text keep their order', () => {
      expect(harvestCheckLiterals(`(a = 'first' OR b = 'second' OR c = 'third')`)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });
  });
});
