import { describe, expect, it } from 'vitest';
import { defaultSequenceName } from '../../src/core/migrations/default-sequence-name';

describe('defaultSequenceName', () => {
  it('joins the table and column with a _seq suffix, keeping their case', () => {
    expect(defaultSequenceName('Post', 'serialNumber')).toBe('Post_serialNumber_seq');
  });

  it('trims a long table name until the name fits 63 bytes', () => {
    expect(defaultSequenceName('a'.repeat(60), 'id')).toBe(`${'a'.repeat(56)}_id_seq`);
  });

  it('trims the longer of the table and column names first', () => {
    expect(defaultSequenceName('t'.repeat(40), 'c'.repeat(40))).toBe(
      `${'t'.repeat(29)}_${'c'.repeat(29)}_seq`,
    );
  });

  it('cuts a multibyte name on a character boundary', () => {
    expect(defaultSequenceName(`a${'ü'.repeat(31)}`, 'id')).toBe(`a${'ü'.repeat(27)}_id_seq`);
  });
});
