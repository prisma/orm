import { access } from 'node:fs/promises';
import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import { describe, expect, it } from 'vitest';
import {
  isPostgresError,
  normalizePgConnectFailure,
  normalizePgErrorByCode,
} from '../src/normalize-error';

describe('normalizePgErrorByCode', () => {
  describe('Postgres SQLSTATE errors', () => {
    it('normalizes unique violation error to SqlQueryError', () => {
      const pgError = new Error(
        'duplicate key value violates unique constraint "user_email_unique"',
      );
      (pgError as { code?: string }).code = '23505';
      (pgError as { constraint?: string }).constraint = 'user_email_unique';
      (pgError as { table?: string }).table = 'user';
      (pgError as { column?: string }).column = 'email';
      (pgError as { detail?: string }).detail = 'Key (email)=(test@example.com) already exists.';

      const error = normalizePgErrorByCode(pgError);
      expect(SqlQueryError.is(error)).toBe(true);
      if (SqlQueryError.is(error)) {
        expect(error.message).toBe(pgError.message);
        expect(error.sqlState).toBe('23505');
        expect(error.constraint).toBe('user_email_unique');
        expect(error.table).toBe('user');
        expect(error.column).toBe('email');
        expect(error.detail).toBe('Key (email)=(test@example.com) already exists.');
        expect(error.cause).toBe(pgError);
      }
    });

    it('normalizes error with partial fields', () => {
      const pgError = new Error('some error');
      (pgError as { code?: string }).code = '23503';
      (pgError as { table?: string }).table = 'post';

      const error = normalizePgErrorByCode(pgError);
      expect(SqlQueryError.is(error)).toBe(true);
      if (SqlQueryError.is(error)) {
        expect(error.sqlState).toBe('23503');
        expect(error.table).toBe('post');
        expect(error.constraint).toBeUndefined();
        expect(error.column).toBeUndefined();
        expect(error.detail).toBeUndefined();
      }
    });
  });

  describe('Connection errors', () => {
    it('normalizes ECONNRESET to SqlConnectionError', () => {
      const pgError = new Error('Connection terminated unexpectedly');
      (pgError as { code?: string }).code = 'ECONNRESET';

      const error = normalizePgErrorByCode(pgError);
      expect(SqlConnectionError.is(error)).toBe(true);
      if (SqlConnectionError.is(error)) {
        expect(error.message).toBe(pgError.message);
        expect(error.transient).toBe(true);
        expect(error.cause).toBe(pgError);
      }
    });

    it('normalizes ETIMEDOUT to SqlConnectionError', () => {
      const pgError = new Error('Connection timeout');
      (pgError as { code?: string }).code = 'ETIMEDOUT';

      const error = normalizePgErrorByCode(pgError);
      expect(SqlConnectionError.is(error)).toBe(true);
      if (SqlConnectionError.is(error)) {
        expect(error.transient).toBe(true);
        expect(error.cause).toBe(pgError);
      }
    });

    it('normalizes ECONNREFUSED to SqlConnectionError', () => {
      const pgError = new Error('Connection refused');
      (pgError as { code?: string }).code = 'ECONNREFUSED';

      const error = normalizePgErrorByCode(pgError);
      expect(SqlConnectionError.is(error)).toBe(true);
      if (SqlConnectionError.is(error)) {
        expect(error.transient).toBe(false);
        expect(error.cause).toBe(pgError);
      }
    });

    it.each([
      ['EPIPE', true],
      ['EAI_AGAIN', true],
      ['ENOTFOUND', false],
      ['EHOSTUNREACH', false],
    ])('normalizes Node code %s to SqlConnectionError with transient %s', (code, transient) => {
      const nodeError = Object.assign(new Error('socket failure'), { code });

      expect(normalizePgErrorByCode(nodeError)).toMatchObject({
        kind: 'sql_connection',
        transient,
        cause: nodeError,
      });
    });

    it.each([
      ['08006', true],
      ['08001', true],
      ['57P01', true],
      ['57P02', true],
      ['57P03', true],
      ['57P04', false],
      ['57P05', true],
      ['25P03', false],
      ['08004', false],
      ['08P01', false],
    ])('normalizes SQLSTATE %s to SqlConnectionError with transient %s', (code, transient) => {
      const pgError = Object.assign(new Error('server connection failure'), { code });

      expect(normalizePgErrorByCode(pgError)).toMatchObject({
        kind: 'sql_connection',
        transient,
        sqlState: code,
        cause: pgError,
      });
    });

    it('returns a code-less connection message as-is', () => {
      const pgError = new Error('Connection terminated unexpectedly');

      expect(normalizePgErrorByCode(pgError)).toBe(pgError);
    });

    it('returns already-normalized errors as-is', () => {
      const connectionError = new SqlConnectionError('lost', { transient: true });
      const queryError = new SqlQueryError('bad', { sqlState: '42601' });

      expect(normalizePgErrorByCode(connectionError)).toBe(connectionError);
      expect(normalizePgErrorByCode(queryError)).toBe(queryError);
    });
  });

  describe('normalizePgConnectFailure', () => {
    it('classifies a code-less error as SqlConnectionError with unknown transience', () => {
      const pgError = new Error('timeout expired');

      const error = normalizePgConnectFailure(pgError);

      expect(error).toMatchObject({ kind: 'sql_connection', transient: undefined, cause: pgError });
      expect(error.message).toBe('timeout expired');
    });

    it('keeps a query SQLSTATE as SqlQueryError', () => {
      const pgError = Object.assign(new Error('password authentication failed'), {
        code: '28P01',
      });

      expect(normalizePgConnectFailure(pgError)).toMatchObject({
        kind: 'sql_query',
        sqlState: '28P01',
      });
    });

    it('keeps Node code transience', () => {
      const nodeError = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });

      expect(normalizePgConnectFailure(nodeError)).toMatchObject({
        kind: 'sql_connection',
        transient: false,
        cause: nodeError,
      });
    });
  });

  describe('Unknown errors', () => {
    it('returns Error for non-Error values', () => {
      const error1 = normalizePgErrorByCode('string error');
      expect(error1).toBeInstanceOf(Error);
      expect(error1.message).toBe('string error');

      const error2 = normalizePgErrorByCode(123);
      expect(error2).toBeInstanceOf(Error);
      expect(error2.message).toBe('123');
    });

    it('returns errors without recognized codes as-is', () => {
      const unknownError = new Error('Some unknown error');
      (unknownError as { code?: string }).code = 'UNKNOWN_CODE';

      const error = normalizePgErrorByCode(unknownError);
      expect(error).toBe(unknownError);
    });
  });
});

describe('isPostgresError', () => {
  describe('Postgres SQLSTATE errors', () => {
    it('returns true for errors with SQLSTATE codes', () => {
      const pgError = new Error('duplicate key value violates unique constraint');
      (pgError as { code?: string }).code = '23505';

      expect(isPostgresError(pgError)).toBe(true);
    });
  });

  describe('Postgres errors with pg-specific properties', () => {
    it('returns true for errors with constraint property', () => {
      const pgError = new Error('constraint violation');
      (pgError as { constraint?: string }).constraint = 'user_email_unique';

      expect(isPostgresError(pgError)).toBe(true);
    });

    it('returns true for errors with table property', () => {
      const pgError = new Error('table error');
      (pgError as { table?: string }).table = 'user';

      expect(isPostgresError(pgError)).toBe(true);
    });

    it('returns true for errors with column property', () => {
      const pgError = new Error('column error');
      (pgError as { column?: string }).column = 'email';

      expect(isPostgresError(pgError)).toBe(true);
    });
  });

  describe('Node.js system errors', () => {
    it('returns false for ENOENT errors', async () => {
      // File system operation on non-existent file - fast and reliable
      const nodeError = (await access('/this/file/definitely/does/not/exist-12345').catch(
        (error) => error,
      )) as Error & { code: string };

      expect(nodeError.code).toBe('ENOENT');
      expect(isPostgresError(nodeError)).toBe(false);
    });
  });

  describe('Other errors', () => {
    it('returns false for errors without code or pg-specific properties', () => {
      const genericError = new Error('Some generic error');

      expect(isPostgresError(genericError)).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isPostgresError('string')).toBe(false);
      expect(isPostgresError(123)).toBe(false);
      expect(isPostgresError(null)).toBe(false);
      expect(isPostgresError(undefined)).toBe(false);
    });

    it('returns false for errors with unknown code format', () => {
      const unknownError = new Error('Unknown error');
      (unknownError as { code?: string }).code = 'UNKNOWN_CODE';

      expect(isPostgresError(unknownError)).toBe(false);
    });
  });
});
