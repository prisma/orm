import { describe, expect, it } from 'vitest';
import { positionalParams } from '../src/core/positional-params';

describe('positionalParams', () => {
  it('writes each numbered placeholder as ? and orders the values to match, repeating a value written twice', () => {
    expect(positionalParams("SELECT ?2, '?1', ?1 /* ?3 */, ?2", ['a', 'b'])).toEqual({
      sql: "SELECT ?, '?1', ? /* ?3 */, ?",
      values: ['b', 'a', 'b'],
    });
  });

  it('keeps bare placeholders and their values in order', () => {
    expect(positionalParams('SELECT ? WHERE a = ?', ['x', null])).toEqual({
      sql: 'SELECT ? WHERE a = ?',
      values: ['x', null],
    });
  });

  it('sends an integer number as a BigInt, which MySQL reads as an integer where LIMIT needs one', () => {
    expect(positionalParams('SELECT ?1, ?2, ?3', [2, 1.5, 2n]).values).toEqual([2n, 1.5, 2n]);
  });

  it('sends bytes as a Buffer', () => {
    expect(positionalParams('SELECT ?1', [new Uint8Array([1, 255])]).values).toEqual([
      Buffer.from([1, 255]),
    ]);
  });

  it('reads the statement as MySQL does: -- before a control character opens a comment, and /*! is refused', () => {
    expect(positionalParams("SELECT 1 --\x01 '\n, ?1", ['a'])).toEqual({
      sql: "SELECT 1 --\x01 '\n, ?",
      values: ['a'],
    });
    expect(() => positionalParams("SELECT 1 /*! , 'a*/ */ WHERE ?1", ['a'])).toThrow(
      expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
    );
  });

  it('refuses placeholders that do not match the values', () => {
    for (const [sql, values] of [
      ['SELECT ?1, ?', [1, 2]],
      ['SELECT ?3', [1, 2, 3]],
      ['SELECT ?01', [1]],
      ['SELECT ?, ?', [1]],
    ] as const) {
      expect(() => positionalParams(sql, values)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH' }),
      );
    }
  });

  it('refuses a value MySQL has no parameter type for', () => {
    for (const value of [{ a: 1 }, [1, 2], Number.NaN]) {
      expect(() => positionalParams('SELECT ?1', [value])).toThrow(
        expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
      );
    }
  });
});
