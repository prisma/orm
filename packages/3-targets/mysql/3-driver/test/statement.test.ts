import { describe, expect, it } from 'vitest';
import { statementFor } from '../src/core/statement';

const connection = { info: { status: 0 } } as never;

describe('statementFor', () => {
  it('hands over a statement without values exactly as written, with no values, so the package sends it without searching it for placeholders', () => {
    const sql = "SELECT 1 AS a /*/ ? */ , 'x?' -- ?\n";
    expect(statementFor(connection, sql, [])).toEqual({ sql, values: undefined });
  });

  it('writes each placeholder of a statement with values as ? and orders its values', () => {
    expect(statementFor(connection, 'SELECT ?2, ?1', ['a', 'b'])).toEqual({
      sql: 'SELECT ?, ?',
      values: ['b', 'a'],
    });
  });
});
