import { describe, expect, it } from 'vitest'

import { convertDriverError } from '../errors'

describe('convertDriverError', () => {
  it('should handle LengthMismatch (22001)', () => {
    const error = { code: '22001', column: 'foo', message: 'msg', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'LengthMismatch',
      column: 'foo',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle ValueOutOfRange (22003)', () => {
    const error = { code: '22003', message: 'out of range', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'ValueOutOfRange',
      cause: 'out of range',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle InvalidInputValue (22P02)', () => {
    const error = { code: '22P02', message: 'invalid input value for enum "Status": "INVALID"', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'InvalidInputValue',
      message: 'invalid input value for enum "Status": "INVALID"',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle UniqueConstraintViolation (23505)', () => {
    const error = { code: '23505', message: 'msg', severity: 'ERROR', detail: 'Key (id)' }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['id'] },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle UniqueConstraintViolation (23505) with constraint', () => {
    const error = { code: '23505', message: 'msg', severity: 'ERROR', detail: 'Key (id)', constraint: 'users_id_key' }
    // No `table` on the error (as with CockroachDB), so it is derived from the
    // default-named constraint `users_id_key` and the parsed field `id`.
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_id_key' },
      table: 'users',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle UniqueConstraintViolation (23505) with only constraint', () => {
    const error = { code: '23505', message: 'msg', severity: 'ERROR', constraint: 'users_email_key' }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should report the table for UniqueConstraintViolation (23505)', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      severity: 'ERROR',
      detail: 'Key (email)=(a@b.c) already exists.',
      table: 'users',
      constraint: 'users_email_key',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      table: 'users',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should derive the table from a default-named constraint when the error carries no table (CockroachDB)', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "app_major_versions_appId_number_key"',
      severity: 'ERROR',
      detail: "Key (appId, number)=('x', 1) already exists.",
      constraint: 'app_major_versions_appId_number_key',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'app_major_versions_appId_number_key' },
      table: 'app_major_versions',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should report no table for a custom-named constraint when the error carries no table', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "my_custom_constraint"',
      severity: 'ERROR',
      detail: 'Key (email)=(a@b.c) already exists.',
      constraint: 'my_custom_constraint',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'my_custom_constraint' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle NullConstraintViolation (23502)', () => {
    const error = { code: '23502', message: 'msg', severity: 'ERROR', detail: 'Key (foo)' }
    expect(convertDriverError(error)).toEqual({
      kind: 'NullConstraintViolation',
      constraint: { fields: ['foo'] },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle ForeignKeyConstraintViolation (23503) with column', () => {
    const error = { code: '23503', message: 'msg', severity: 'ERROR', column: 'bar' }
    expect(convertDriverError(error)).toEqual({
      kind: 'ForeignKeyConstraintViolation',
      constraint: { fields: ['bar'] },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle ForeignKeyConstraintViolation (23503) with constraint', () => {
    const error = { code: '23503', message: 'msg', severity: 'ERROR', constraint: 'baz' }
    expect(convertDriverError(error)).toEqual({
      kind: 'ForeignKeyConstraintViolation',
      constraint: { index: 'baz' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle RestrictViolation (23001) with column', () => {
    const error = { code: '23001', message: 'msg', severity: 'ERROR', column: 'bar' }
    expect(convertDriverError(error)).toEqual({
      kind: 'RestrictViolation',
      constraint: { fields: ['bar'] },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle RestrictViolation (23001) with constraint', () => {
    const error = { code: '23001', message: 'msg', severity: 'ERROR', constraint: 'baz' }
    expect(convertDriverError(error)).toEqual({
      kind: 'RestrictViolation',
      constraint: { index: 'baz' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle DatabaseDoesNotExist (3D000)', () => {
    const error = { code: '3D000', message: 'database "mydb" does not exist', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'DatabaseDoesNotExist',
      db: 'mydb',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle DatabaseAccessDenied (28000)', () => {
    const error = {
      code: '28000',
      message: 'no pg_hba.conf entry for host "172.20.20.2", user "db_user", database "prisma_db", no encryption',
      severity: 'FATAL',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'DatabaseAccessDenied',
      db: 'prisma_db',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle AuthenticationFailed (28P01)', () => {
    const error = { code: '28P01', message: 'password authentication failed for user "root"', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'AuthenticationFailed',
      user: 'root',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it.each(['40001', '40P01'])('should handle TransactionWriteConflict (%s)', (code) => {
    const error = { code, message: 'msg', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'TransactionWriteConflict',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle TableDoesNotExist (42P01)', () => {
    const error = { code: '42P01', message: 'relation "mytable" does not exist', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'TableDoesNotExist',
      table: 'mytable',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it.each([
    ['unquoted column name', 'column foo does not exist', 'foo'],
    ['quoted column name', 'column "foo" does not exist', 'foo'],
    ['unquoted qualified column name', 'column users.first_name does not exist', 'users.first_name'],
    ['quoted qualified column name', 'column "users"."first name" does not exist', 'users.first name'],
    ['partially quoted qualified column name (1)', 'column users."first name" does not exist', 'users.first name'],
    ['partially quoted qualified column name (2)', 'column "users".first_name does not exist', 'users.first_name'],
    ['quoted column name containing spaces', 'column "first name" does not exist', 'first name'],
    ['quoted column name containing dots', 'column "first.name" does not exist', 'first.name'],
    ['quoted qualified column name containing dots', 'column "users"."first.name" does not exist', 'users.first.name'],
    ['quoted column name containing escaped quotes', 'column "a""b" does not exist', 'a"b'],
  ])('should handle ColumnNotFound (42703) with %s', (description, message, expectedColumn) => {
    const error = { code: '42703', message, severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'ColumnNotFound',
      column: expectedColumn,
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle DatabaseAlreadyExists (42P04)', () => {
    const error = { code: '42P04', message: 'database "mydb" already exists', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'DatabaseAlreadyExists',
      db: 'mydb',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle TooManyConnections (53300)', () => {
    const error = { code: '53300', message: 'too many connections', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'TooManyConnections',
      cause: 'too many connections',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it.each([
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate'],
    [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      `Hostname/IP does not match certificate's altnames: Host: localhost. is not in the cert's altnames: DNS:*.localdev.com`,
    ],
    [undefined, 'The server does not support SSL connections'],
  ])('should handle TLS error code %s', (code, message) => {
    const error = { code, message }
    expect(convertDriverError(error)).toEqual({
      kind: 'TlsConnectionError',
      reason: message,
    })
  })

  it.each([
    ['ENOTFOUND', 'DatabaseNotReachable', 'getaddrinfo ENOTFOUND locohost'],
    ['ECONNREFUSED', 'DatabaseNotReachable', `connect ECONNREFUSED 127.0.0.1:6699`],
    ['ECONNRESET', 'ConnectionClosed', 'read ECONNRESET'],
    ['ETIMEDOUT', 'SocketTimeout', 'connect ETIMEDOUT 127.0.0.1:9100'],
  ])('should handle socket error code %s', (code, kind, message) => {
    const error = { code, message, syscall: 'syscallname', errno: -1 }
    expect(convertDriverError(error)).toEqual({
      kind,
    })
  })

  it('should handle default (unknown code)', () => {
    const error = {
      code: '99999',
      message: 'unknown',
      severity: 'FATAL',
      detail: 'details',
      column: 'col',
      hint: 'hint',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'postgres',
      code: '99999',
      severity: 'FATAL',
      message: 'unknown',
      detail: 'details',
      column: 'col',
      hint: 'hint',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should throw if not a db error', () => {
    expect(() => convertDriverError({ message: 'Unknown driver message' })).toThrow()
  })
})
