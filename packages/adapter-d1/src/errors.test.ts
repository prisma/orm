import { describe, expect, test } from 'vitest'

import { convertDriverError } from './errors'

describe('D1 error handling', () => {
  test('check constraint violation reports the constraint name', () => {
    const message = 'D1_ERROR: CHECK constraint failed: t_sum_check'
    expect(convertDriverError({ message })).toEqual({
      kind: 'CheckConstraintViolation',
      constraint: { index: 't_sum_check' },
      originalMessage: message,
    })
  })

  test('foreign key constraint violation is still a foreign key violation', () => {
    const message = 'D1_ERROR: FOREIGN KEY constraint failed'
    expect(convertDriverError({ message })).toEqual({
      kind: 'ForeignKeyConstraintViolation',
      constraint: { foreignKey: {} },
      originalMessage: message,
    })
  })
})
