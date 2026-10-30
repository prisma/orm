import { describe, expect, it } from 'vitest';
import { statementFor } from '../src/core/statement';

const utf8mb4 = { charset: 'utf8', maxLength: 4 };

function connectionReading(collation: { charset: string; maxLength: number }) {
  return { info: { status: 0, collation } } as never;
}

const connection = connectionReading(utf8mb4);

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

  it.each([
    ['sjis', { charset: 'sjis', maxLength: 2 }],
    ['big5', { charset: 'big5', maxLength: 2 }],
    ['utf8mb3', { charset: 'utf8', maxLength: 3 }],
  ])(
    'refuses a statement with values while MySQL reports the character set %s, and hands over one without values',
    (characterSet, collation) => {
      const reading = connectionReading(collation);
      expect(() => statementFor(reading, 'SELECT ?1', ['x'])).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.CHARACTER_SET_UNSUPPORTED',
          meta: { characterSet, params: 1 },
        }),
      );
      expect(statementFor(reading, 'SET NAMES utf8mb4', [])).toEqual({
        sql: 'SET NAMES utf8mb4',
        values: undefined,
      });
    },
  );

  it('says the driver could not confirm utf8mb4, and gives a fix for a changed character set and for a server that does not report it', () => {
    expect(() =>
      statementFor(connectionReading({ charset: 'latin1', maxLength: 1 }), 'SELECT ?1', ['x']),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /^The driver could not confirm that MySQL reads this connection's statements as utf8mb4/,
        ),
        why: expect.not.stringContaining('so a statement on this connection changed it'),
        fix: expect.stringMatching(
          /SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci.*character_set_client back to the server's session_track_system_variables/s,
        ),
      }),
    );
  });

  it('refuses a statement with values when the package has recorded no character set', () => {
    expect(() =>
      statementFor({ info: { status: 0, collation: null } } as never, 'SELECT ?1', ['x']),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CHARACTER_SET_UNSUPPORTED',
        meta: { characterSet: 'unknown', params: 1 },
      }),
    );
  });
});
