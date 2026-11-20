import { describe, expect, it } from 'vitest'

import { convertDriverError } from './errors'

describe('convertDriverError', () => {
  it.each([
    ['SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: age > 0'],
    ['SQLITE_MISMATCH', 'datatype mismatch'],
    ['SQLITE_ERROR', 'table t already exists'],
  ])('should map the unhandled code %s to a typed sqlite error', (code, message) => {
    expect(convertDriverError({ code, message })).toEqual({
      kind: 'sqlite',
      extendedCode: 1,
      message,
      originalCode: code,
      originalMessage: message,
    })
  })

  it.each([
    'SQLITE_BUSY',
    'SQLITE_BUSY_RECOVERY',
    'SQLITE_BUSY_SNAPSHOT',
    // SQLITE_BUSY_TIMEOUT (773) is missing from the name table of better-sqlite3.
    'UNKNOWN_SQLITE_ERROR_773',
  ])('should handle SocketTimeout (%s)', (code) => {
    const message = 'database is locked'
    expect(convertDriverError({ code, message })).toEqual({
      kind: 'SocketTimeout',
      originalCode: code,
      originalMessage: message,
    })
  })

  it('should keep the extended code of an error missing from the name table', () => {
    const code = 'UNKNOWN_SQLITE_ERROR_1038'
    const message = 'disk I/O error'
    expect(convertDriverError({ code, message })).toEqual({
      kind: 'sqlite',
      extendedCode: 1038,
      message,
      originalCode: code,
      originalMessage: message,
    })
  })

  it('should handle UniqueConstraintViolation', () => {
    const code = 'SQLITE_CONSTRAINT_UNIQUE'
    const message = 'UNIQUE constraint failed: User.email'
    expect(convertDriverError({ code, message })).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['email'] },
      originalCode: code,
      originalMessage: message,
    })
  })

  it('should handle TableDoesNotExist', () => {
    const code = 'SQLITE_ERROR'
    const message = 'no such table: User'
    expect(convertDriverError({ code, message })).toEqual({
      kind: 'TableDoesNotExist',
      table: 'User',
      originalCode: code,
      originalMessage: message,
    })
  })

  it('should rethrow errors that do not come from the driver', () => {
    const error = new Error('boom')
    let thrown: unknown
    try {
      convertDriverError(error)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBe(error)
  })
})
