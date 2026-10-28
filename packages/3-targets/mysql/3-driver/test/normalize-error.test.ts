import { describe, expect, it } from 'vitest';
import { normalizeMysqlError } from '../src/core/normalize-error';

function sqlError(fields: {
  errno: number;
  sqlState: string | null;
  fatal: boolean;
  sqlMessage: string;
}) {
  return Object.assign(new Error(`(conn:1, no: ${fields.errno}) ${fields.sqlMessage}`), {
    name: 'SqlError',
    code: 'ER_X',
    sql: null,
    text: fields.sqlMessage,
    ...fields,
  });
}

describe('normalizeMysqlError', () => {
  it('turns an error MySQL reports into a SqlQueryError with its SQLSTATE and bare message', () => {
    const error = sqlError({
      errno: 1146,
      sqlState: '42S02',
      fatal: false,
      sqlMessage: "Table 'x' doesn't exist",
    });
    expect(normalizeMysqlError(error)).toEqual(
      expect.objectContaining({
        kind: 'sql_query',
        sqlState: '42S02',
        message: "Table 'x' doesn't exist",
        cause: error,
      }),
    );
  });

  it('reports a lost connection as DRIVER.NOT_CONNECTED, not as a statement error', () => {
    for (const errno of [45009, 45013]) {
      const error = sqlError({
        errno,
        sqlState: '08S01',
        fatal: true,
        sqlMessage: 'socket has unexpectedly been closed',
      });
      expect(normalizeMysqlError(error)).toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        cause: error,
        meta: { errno, sqlState: '08S01' },
      });
    }
  });

  it('reports a pool that gave no connection in time as DRIVER.CONNECTION_FAILED, with the reason the pool could not connect', () => {
    const cause = sqlError({
      errno: 1045,
      sqlState: '28000',
      fatal: false,
      sqlMessage: "Access denied for user 'x'",
    });
    const error = Object.assign(
      sqlError({
        errno: 45028,
        sqlState: 'HY000',
        fatal: false,
        sqlMessage: 'pool timeout: failed to retrieve a connection from pool after 200ms',
      }),
      { cause },
    );
    expect(normalizeMysqlError(error)).toMatchObject({
      code: 'DRIVER.CONNECTION_FAILED',
      why: expect.stringContaining('Access denied'),
      cause: error,
    });
  });

  it('leaves any other error as it is', () => {
    const error = new Error('socket hang up');
    expect(normalizeMysqlError(error)).toBe(error);
  });
});

describe('normalizeMysqlError for errors MySQL reports about a statement', () => {
  it('reports every server error as a SqlQueryError, a statement MySQL cannot prepare and the open-statement limit included', () => {
    const cases = [
      {
        errno: 1295,
        sqlState: 'HY000',
        sqlMessage: 'This command is not supported in the prepared statement protocol yet',
        detail: expect.stringContaining('LOCK TABLES'),
      },
      {
        errno: 1461,
        sqlState: '42000',
        sqlMessage: "Can't create more than max_prepared_stmt_count statements",
        detail: expect.stringContaining('statementCacheSize'),
      },
      {
        errno: 1210,
        sqlState: 'HY000',
        sqlMessage: 'Incorrect arguments to LIMIT',
        detail: undefined,
      },
    ];
    for (const { detail, ...fields } of cases) {
      const error = sqlError({ ...fields, fatal: false });
      expect(normalizeMysqlError(error)).toEqual(
        expect.objectContaining({
          kind: 'sql_query',
          sqlState: fields.sqlState,
          message: fields.sqlMessage,
          detail,
          cause: error,
        }),
      );
    }
  });

  it('reports a sign-in that needs the server public key as DRIVER.CONNECTION_FAILED, naming allowPublicKeyRetrieval and TLS', () => {
    const error = sqlError({
      errno: 45044,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'RSA public key is not available client side.',
    });
    const fix = expect.stringMatching(
      /allowPublicKeyRetrieval=true.*TLS|TLS.*allowPublicKeyRetrieval=true/,
    );
    const timedOut = Object.assign(
      sqlError({
        errno: 45028,
        sqlState: 'HY000',
        fatal: false,
        sqlMessage: 'pool timeout: failed to retrieve a connection from pool after 200ms',
      }),
      { cause: error },
    );
    expect({ direct: normalizeMysqlError(error), pooled: normalizeMysqlError(timedOut) }).toEqual({
      direct: expect.objectContaining({ code: 'DRIVER.CONNECTION_FAILED', fix, cause: error }),
      pooled: expect.objectContaining({ code: 'DRIVER.CONNECTION_FAILED', fix, cause: error }),
    });
  });

  it('reports a lost connection as DRIVER.NOT_CONNECTED', () => {
    const error = sqlError({
      errno: 45009,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'socket has unexpectedly been closed',
    });
    expect(normalizeMysqlError(error)).toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });
});
