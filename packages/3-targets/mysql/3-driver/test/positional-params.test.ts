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

  it('sends every integer number as a bigint, so MySQL reads it as BIGINT, and a fraction as a number', () => {
    expect(
      positionalParams('SELECT ?1, ?2, ?3, ?4, ?5', [2, 2147483647, 2 ** 60, 1.5, 2n]).values,
    ).toEqual([2n, 2147483647n, 2n ** 60n, 1.5, 2n]);
  });

  it('refuses an integer outside the signed 64-bit range before it reaches the package', () => {
    for (const value of [-(2n ** 63n) - 1n, 2n ** 63n, 2 ** 64]) {
      expect(() => positionalParams('SELECT ?1', [value])).toThrow(
        expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
      );
    }
    expect(positionalParams('SELECT ?1, ?2', [-(2n ** 63n), 2n ** 63n - 1n]).values).toEqual([
      -(2n ** 63n),
      2n ** 63n - 1n,
    ]);
  });

  it('sends bytes as a Buffer over the same memory, and a Buffer as it is', () => {
    const bytes = new Uint8Array([0, 1, 255, 7]).subarray(1, 3);
    const buffer = Buffer.from([9]);
    const [sent, kept] = positionalParams('SELECT ?1, ?2', [bytes, buffer]).values;
    expect({
      sent,
      isBuffer: Buffer.isBuffer(sent),
      sameMemory: Buffer.isBuffer(sent) && sent.buffer === bytes.buffer,
      kept: kept === buffer,
    }).toEqual({ sent: Buffer.from([1, 255]), isBuffer: true, sameMemory: true, kept: true });
  });

  it('refuses a Date, which the package would encode in the local time zone', () => {
    expect(() => positionalParams('SELECT ?1', [new Date(0)])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.AST_INVALID',
        message: expect.stringContaining('Date'),
      }),
    );
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
    for (const value of [{ a: 1 }, [1, 2], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => positionalParams('SELECT ?1', [value])).toThrow(
        expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
      );
    }
  });
});
