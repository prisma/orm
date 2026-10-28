import { describe, expect, it } from 'vitest';
import { normalizeMysqlError, statementError } from '../src/core/normalize-error';

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

describe('statementError', () => {
  it('names statementCacheSize and connectionLimit when MySQL refuses to prepare another statement', () => {
    const error = sqlError({
      errno: 1461,
      sqlState: '42000',
      fatal: false,
      sqlMessage: "Can't create more than max_prepared_stmt_count statements",
    });
    expect(statementError(error, 'SELECT 1')).toMatchObject({
      code: 'DRIVER.PREPARE_FAILED',
      fix: expect.stringContaining('statementCacheSize'),
    });
  });

  it('reports a lost connection as DRIVER.NOT_CONNECTED', () => {
    const error = sqlError({
      errno: 45009,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'socket has unexpectedly been closed',
    });
    expect(statementError(error, 'SELECT 1')).toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });
});
