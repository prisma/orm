import { describe, expect, it } from 'vitest'

import { convertDriverError } from './errors'

describe('convertDriverError', () => {
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
  ])('should handle ColumnNotFound (42703) with %s', (_description, message, expectedColumn) => {
    const error = { code: '42703', message, details: { severity: 'ERROR' } }
    expect(convertDriverError(error)).toEqual({
      kind: 'ColumnNotFound',
      column: expectedColumn,
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle UniqueConstraintViolation (23505) with a constraint name', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      details: {
        severity: 'ERROR',
        detail: 'Key (email)=(a@example.com) already exists.',
        constraint: 'users_email_key',
      },
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle UniqueConstraintViolation (23505) with only a constraint name', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      details: { severity: 'ERROR', constraint: 'users_email_key' },
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should fall back to the detail fields for UniqueConstraintViolation (23505) without a constraint name', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      details: { severity: 'ERROR', detail: 'Key (first_name, last_name)=(a, b) already exists.' },
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['first_name', 'last_name'] },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should return an undefined constraint for UniqueConstraintViolation (23505) without a constraint name or detail', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      details: { severity: 'ERROR' },
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: undefined,
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it.each(['40001', '40P01'])('should handle TransactionWriteConflict (%s)', (code) => {
    const error = { code, message: 'msg', details: { severity: 'ERROR' } }
    expect(convertDriverError(error)).toEqual({
      kind: 'TransactionWriteConflict',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })
})
