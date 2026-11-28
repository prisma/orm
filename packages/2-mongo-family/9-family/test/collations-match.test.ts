import { describe, expect, it } from 'vitest';
import { collationsMatch } from '../src/core/schema-verify/canonicalize-introspection';

const caseInsensitive = { locale: 'en', strength: 2 };
const reported = {
  locale: 'en',
  caseLevel: false,
  caseFirst: 'off',
  strength: 2,
  numericOrdering: false,
  alternate: 'non-ignorable',
  maxVariable: 'punct',
  normalization: false,
  backwards: false,
  version: '57.1',
};

describe('collationsMatch', () => {
  it.each([
    ['no collation on either', undefined, undefined],
    ['the simple collation and none', { locale: 'simple' }, undefined],
    ['the same short form', caseInsensitive, caseInsensitive],
    ['a short form and the full form MongoDB reports for it', caseInsensitive, reported],
    ['the same full form', reported, reported],
  ])('matches %s', (_label, expected, live) => {
    expect(collationsMatch(expected, live)).toBe(true);
  });

  it.each([
    ['a collation and none', caseInsensitive, undefined],
    ['none and a collation', undefined, reported],
    ['two strengths', { locale: 'en', strength: 1 }, reported],
    ['two locales', { locale: 'fr', strength: 2 }, reported],
  ])('does not match %s', (_label, expected, live) => {
    expect(collationsMatch(expected, live)).toBe(false);
  });
});
