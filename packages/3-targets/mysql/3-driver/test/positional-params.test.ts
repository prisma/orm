import { inspect } from 'node:util';
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

  it('passes a finite number and a bigint within the signed 64-bit range as they are, for the package to write as digits', () => {
    expect(
      positionalParams('SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8', [
        2,
        2147483647,
        2 ** 60,
        1.5,
        2n,
        1e21,
        -0,
        -(2n ** 63n),
      ]).values,
    ).toEqual([2, 2147483647, 2 ** 60, 1.5, 2n, 1e21, -0, -(2n ** 63n)]);
  });

  it('refuses a bigint outside the signed 64-bit range before it reaches the package, leaving the value out of the error', () => {
    for (const value of [-(2n ** 63n) - 1n, 2n ** 63n]) {
      const error = (() => {
        try {
          positionalParams('SELECT ?1', [value]);
        } catch (thrown) {
          return thrown;
        }
        throw new Error('accepted');
      })();
      expect({
        error,
        leaked: inspect(error, { depth: 10 }).includes(String(value).replace('-', '')),
      }).toEqual({
        error: expect.objectContaining({
          code: 'RUNTIME.ENCODE_FAILED',
          meta: { target: 'mysql', paramIndex: 0, received: 'bigint' },
        }),
        leaked: false,
      });
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

  it('refuses text with a lone UTF-16 surrogate, which the package writes as ? or U+FFFD by the length of the text, and sends a surrogate pair as it is', () => {
    for (const value of ['a\uD800b', `a\uDC00${'x'.repeat(200)}`, '\uD83D']) {
      expect(() => positionalParams('SELECT ?1', [value])).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ENCODE_FAILED',
          message: expect.stringContaining('surrogate'),
          meta: { target: 'mysql', paramIndex: 0, received: 'string' },
        }),
      );
    }
    expect(positionalParams('SELECT ?1', ['😀']).values).toEqual(['😀']);
  });

  it('refuses a Date, which the package would encode in the local time zone', () => {
    expect(() => positionalParams('SELECT ?1, ?2', ['a', new Date(0)])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        message: expect.stringContaining('Date'),
        meta: { target: 'mysql', paramIndex: 1, received: 'Date' },
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
    for (const [value, received] of [
      [{ a: 1 }, 'object'],
      [[1, 2], 'array'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'Infinity'],
    ] as const) {
      expect(() => positionalParams('SELECT ?1', [value])).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ENCODE_FAILED',
          meta: { target: 'mysql', paramIndex: 0, received },
        }),
      );
    }
  });
});
