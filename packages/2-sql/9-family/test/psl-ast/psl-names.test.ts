import { describe, expect, it } from 'vitest';
import { toEnumMemberName } from '../../src/core/psl-ast/psl-names';

describe('toEnumMemberName', () => {
  it('keeps a valid identifier value verbatim, preserving case', () => {
    expect(toEnumMemberName('aal1')).toBe('aal1');
    expect(toEnumMemberName('DRAFT')).toBe('DRAFT');
    expect(toEnumMemberName('camelCase')).toBe('camelCase');
  });

  it('camelCases values with separators', () => {
    expect(toEnumMemberName('high-priority')).toBe('highPriority');
    expect(toEnumMemberName('in review')).toBe('inReview');
  });

  it('escapes digit-prefixed values', () => {
    expect(toEnumMemberName('2nd')).toBe('_2nd');
  });

  it('escapes PSL reserved words', () => {
    expect(toEnumMemberName('enum')).toBe('_enum');
    expect(toEnumMemberName('model')).toBe('_model');
  });

  it('synthesizes a deterministic identifier when no ASCII identifier characters remain', () => {
    expect(toEnumMemberName('$$$')).toMatch(/^x[0-9a-f]+$/);
    expect(toEnumMemberName('東京')).toBe(toEnumMemberName('東京'));
  });
});
