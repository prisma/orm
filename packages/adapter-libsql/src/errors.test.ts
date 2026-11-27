import { describe, expect, test } from 'vitest'

import { convertDriverError } from './errors'

describe('LibSQL error handling', () => {
  test('missing error code gets defaulted to 1', () => {
    const dbError = convertDriverError({ code: '123456', message: 'An error occurred', rawCode: undefined })
    expect(dbError).toEqual({
      kind: 'sqlite',
      message: 'An error occurred',
      extendedCode: 1,
      originalMessage: 'An error occurred',
    })
  })

  describe('remote errors without a numeric code', () => {
    const remote = (message: string) => ({
      code: 'SQLITE_CONSTRAINT',
      message: `SQLITE_CONSTRAINT: SQLITE_CONSTRAINT: SQLite error: ${message}`,
      cause: { code: 'SQLITE_CONSTRAINT' },
    })

    test.each([
      [
        'unique',
        'UNIQUE constraint failed: User.email',
        { kind: 'UniqueConstraintViolation', constraint: { fields: ['email'] }, table: 'User' },
      ],
      [
        'primary key',
        'UNIQUE constraint failed: User.id',
        { kind: 'UniqueConstraintViolation', constraint: { fields: ['id'] }, table: 'User' },
      ],
      [
        'not null',
        'NOT NULL constraint failed: User.name',
        { kind: 'NullConstraintViolation', constraint: { fields: ['name'] } },
      ],
      [
        'foreign key',
        'FOREIGN KEY constraint failed',
        { kind: 'ForeignKeyConstraintViolation', constraint: { foreignKey: {} } },
      ],
    ])('%s violation is mapped from the message', (_name, message, expected) => {
      const error = remote(message)
      expect(convertDriverError(error)).toEqual({
        ...expected,
        originalCode: undefined,
        originalMessage: error.message,
      })
    })

    test('other remote errors keep the generic code', () => {
      const error = { code: 'SQLITE_ERROR', message: 'SQLITE_ERROR: SQLite error: near "SELEC": syntax error' }
      expect(convertDriverError(error)).toEqual({
        kind: 'sqlite',
        extendedCode: 1,
        message: error.message,
        originalCode: undefined,
        originalMessage: error.message,
      })
    })
  })

  test('unique constraint violation reports the fields and the table', () => {
    const dbError = convertDriverError({
      code: 'SQLITE_CONSTRAINT_UNIQUE',
      message: 'UNIQUE constraint failed: app_major_versions.appId, app_major_versions.number',
      rawCode: 2067,
    })
    expect(dbError).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['appId', 'number'] },
      table: 'app_major_versions',
      originalCode: '2067',
      originalMessage: 'UNIQUE constraint failed: app_major_versions.appId, app_major_versions.number',
    })
  })

  test('unique constraint violation reports no table when the column has no table prefix', () => {
    const dbError = convertDriverError({
      code: 'SQLITE_CONSTRAINT_UNIQUE',
      message: "UNIQUE constraint failed: index 'users_email_idx'",
      rawCode: 2067,
    })
    expect(dbError).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ["index 'users_email_idx'"] },
      originalCode: '2067',
      originalMessage: "UNIQUE constraint failed: index 'users_email_idx'",
    })
  })
})
