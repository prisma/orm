import { describe, expect, it } from 'vitest';
import { OpaqueSql, opaqueSql, renderOpaqueSql } from '../../src/exports/ast';

describe('renderOpaqueSql', () => {
  it('returns text without a line comment unchanged', () => {
    expect(renderOpaqueSql(opaqueSql('price > 0\n  AND price < 100'))).toBe(
      'price > 0\n  AND price < 100',
    );
  });

  it('ends text containing a line comment with a line break', () => {
    expect(
      [
        opaqueSql('price > 0 -- positive'),
        opaqueSql('-- leading\nprice > 0'),
        opaqueSql("note <> '--'"),
      ].map(renderOpaqueSql),
    ).toEqual(['price > 0 -- positive\n', '-- leading\nprice > 0\n', "note <> '--'\n"]);
  });
});

describe('OpaqueSql', () => {
  it('is frozen', () => {
    const sql = new OpaqueSql('1');
    expect(Object.isFrozen(sql)).toBe(true);
  });
});
