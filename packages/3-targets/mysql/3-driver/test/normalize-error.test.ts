import { isUniqueConstraintViolation } from '@internal/sql-errors';
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

  it('reports a lost connection as a transient SqlConnectionError, as the Postgres driver does, not as a statement error', () => {
    for (const errno of [45009, 45013]) {
      const error = sqlError({
        errno,
        sqlState: '08S01',
        fatal: true,
        sqlMessage: 'socket has unexpectedly been closed',
      });
      expect(normalizeMysqlError(error)).toEqual(
        expect.objectContaining({
          kind: 'sql_connection',
          transient: true,
          sqlState: '08S01',
          message: 'socket has unexpectedly been closed',
          cause: error,
        }),
      );
    }
  });

  it('reports a pool that gave no connection in time as a transient SqlConnectionError, with the reason the pool could not connect', () => {
    const cause = sqlError({
      errno: 45012,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'Connection timeout: failed to create socket after 1001ms',
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
    expect(normalizeMysqlError(error)).toEqual(
      expect.objectContaining({
        kind: 'sql_connection',
        transient: true,
        message: expect.stringContaining('failed to create socket'),
        cause: error,
      }),
    );
  });

  it('reports a socket error by its Node code with the Postgres driver table, a refused connection and an unknown or unreachable host as not transient, directly and as the reason a pool gave no connection', () => {
    const socketError = (code: string, errno: number | undefined) =>
      Object.assign(errno === undefined ? new AggregateError([]) : new Error(`connect ${code}`), {
        code,
        errno,
        fatal: true,
        sqlState: 'HY000',
      });
    const timedOut = (cause: Error) =>
      Object.assign(
        sqlError({
          errno: 45028,
          sqlState: 'HY000',
          fatal: false,
          sqlMessage: 'pool failed to retrieve a connection from pool',
        }),
        { cause },
      );
    const cases = [
      socketError('ECONNREFUSED', -61),
      socketError('ECONNREFUSED', undefined),
      socketError('ENOTFOUND', -3008),
      socketError('EHOSTUNREACH', -65),
      socketError('ECONNRESET', -54),
      socketError('ETIMEDOUT', -60),
      socketError('EPIPE', -32),
      socketError('EAI_AGAIN', -3001),
    ];
    expect(
      cases.map((error) => {
        const direct = Object(normalizeMysqlError(error));
        const pooled = Object(normalizeMysqlError(timedOut(error)));
        return {
          direct: {
            kind: direct.kind,
            transient: direct.transient,
            sqlState: direct.sqlState,
            message: direct.message,
            isCause: direct.cause === error,
          },
          pooled: {
            kind: pooled.kind,
            transient: pooled.transient,
            isCause: pooled.cause === error,
          },
        };
      }),
    ).toEqual(
      cases.map((error) => {
        const transient = !['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code);
        return {
          direct: {
            kind: 'sql_connection',
            transient,
            sqlState: undefined,
            message: error.message,
            isCause: true,
          },
          pooled: { kind: 'sql_connection', transient, isCause: !transient },
        };
      }),
    );
  });

  it('reports a sign-in MySQL refuses as the SqlQueryError MySQL raised, as the Postgres driver reports 28P01, directly and as the reason a pool gave no connection', () => {
    for (const [errno, sqlState] of [
      [1045, '28000'],
      [1698, '28000'],
      [1524, 'HY000'],
    ] as const) {
      const refused = sqlError({ errno, sqlState, fatal: true, sqlMessage: 'Access denied' });
      const timedOut = Object.assign(
        sqlError({
          errno: 45028,
          sqlState: 'HY000',
          fatal: false,
          sqlMessage: 'pool timeout: failed to retrieve a connection from pool after 200ms',
        }),
        { cause: refused },
      );
      const expected = expect.objectContaining({
        kind: 'sql_query',
        sqlState,
        message: 'Access denied',
        cause: refused,
      });
      expect({
        direct: normalizeMysqlError(refused),
        pooled: normalizeMysqlError(timedOut),
      }).toEqual({ direct: expected, pooled: expected });
    }
  });

  it('reports session setup that fails on a new connection as a SqlConnectionError that will not pass on retry', () => {
    const error = sqlError({
      errno: 45030,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'Error executing initial sql command: Unknown system variable',
    });
    expect(normalizeMysqlError(error)).toEqual(
      expect.objectContaining({
        kind: 'sql_connection',
        transient: false,
        message: expect.stringContaining('Unknown system variable'),
        cause: error,
      }),
    );
  });

  it('leaves any other error as it is', () => {
    const error = new Error('socket hang up');
    expect(normalizeMysqlError(error)).toBe(error);
  });
});

describe('normalizeMysqlError for errors MySQL reports about a statement', () => {
  it('reports every server error as a SqlQueryError with no detail of the driver own, as MySQL sends none', () => {
    const cases = [
      {
        errno: 1295,
        sqlState: 'HY000',
        sqlMessage: 'This command is not supported in the prepared statement protocol yet',
      },
      {
        errno: 1461,
        sqlState: '42000',
        sqlMessage: "Can't create more than max_prepared_stmt_count statements",
      },
      { errno: 1210, sqlState: 'HY000', sqlMessage: 'Incorrect arguments to LIMIT' },
    ];
    for (const fields of cases) {
      const error = sqlError({ ...fields, fatal: false });
      const normalized = normalizeMysqlError(error);
      expect({ normalized, hasDetail: Object(normalized).detail !== undefined }).toEqual({
        normalized: expect.objectContaining({
          kind: 'sql_query',
          sqlState: fields.sqlState,
          message: fields.sqlMessage,
          cause: error,
        }),
        hasDetail: false,
      });
    }
  });

  it('reports constraint violations with the SQLSTATEs Postgres sends and the SQLite driver maps to, so a duplicate key is a unique violation', () => {
    const cases = [
      [1062, '23000', '23505'],
      [1586, '23000', '23505'],
      [1451, '23000', '23503'],
      [1452, '23000', '23503'],
      [1216, '23000', '23503'],
      [1217, '23000', '23503'],
      [1048, '23000', '23502'],
      [3819, 'HY000', '23514'],
      [1022, '23000', '23000'],
    ] as const;
    expect(
      cases.map(([errno, sqlState]) => {
        const normalized = normalizeMysqlError(
          sqlError({ errno, sqlState, fatal: false, sqlMessage: 'violated' }),
        );
        return {
          sqlState: Object(normalized).sqlState,
          unique: isUniqueConstraintViolation(normalized),
        };
      }),
    ).toEqual(cases.map(([, , sqlState]) => ({ sqlState, unique: sqlState === '23505' })));
  });

  it('reports a sign-in that needs the server public key as a SqlConnectionError that will not pass on retry, naming allowPublicKeyRetrieval and TLS', () => {
    const error = sqlError({
      errno: 45044,
      sqlState: '08S01',
      fatal: true,
      sqlMessage: 'RSA public key is not available client side.',
    });
    const message = expect.stringMatching(/allowPublicKeyRetrieval=true.*TLS/);
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
      direct: expect.objectContaining({
        kind: 'sql_connection',
        transient: false,
        message,
        cause: error,
      }),
      pooled: expect.objectContaining({
        kind: 'sql_connection',
        transient: false,
        message,
        cause: error,
      }),
    });
  });
});
