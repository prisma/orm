import { describe, expect, it } from 'vitest';
import * as columnTypes from '../src/exports/column-types';

describe('the SQLite column helpers', () => {
  it('are named after the explicit type they give', () => {
    expect({
      integerNumberColumn: columnTypes.integerNumberColumn,
      integerBigIntColumn: columnTypes.integerBigIntColumn,
      plainJsonColumn: columnTypes.plainJsonColumn,
      decimalStringColumn: columnTypes.decimalStringColumn,
    }).toEqual({
      integerNumberColumn: { codecId: 'sqlite/integer@1' },
      integerBigIntColumn: { codecId: 'sqlite/bigint@1' },
      plainJsonColumn: { codecId: 'sqlite/json@1' },
      decimalStringColumn: { codecId: 'sqlite/decimal@1' },
    });
  });

  it('no longer export the names that did not say which explicit type they give', () => {
    expect(
      ['integerColumn', 'bigintColumn', 'jsonColumn'].filter((name) => name in columnTypes),
    ).toEqual([]);
  });
});
