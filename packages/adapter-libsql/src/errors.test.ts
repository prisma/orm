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

  test('check constraint violation reports the constraint name', () => {
    const message = 'SQLITE_CONSTRAINT: CHECK constraint failed: t_sum_check'
    expect(convertDriverError({ code: 'SQLITE_CONSTRAINT', message, rawCode: 275 })).toEqual({
      kind: 'CheckConstraintViolation',
      constraint: { index: 't_sum_check' },
      originalCode: '275',
      originalMessage: message,
    })
  })
})
