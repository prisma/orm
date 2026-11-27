import { describe, expect, test } from 'vitest'

import { convertDriverError } from './errors'

describe('PlanetScale error handling', () => {
  test('check constraint violation (3819) reports the constraint name', () => {
    const error = { code: 3819, message: "Check constraint 't_sum_check' is violated.", state: 'HY000' }
    expect(convertDriverError(error)).toEqual({
      kind: 'CheckConstraintViolation',
      constraint: { index: 't_sum_check' },
      originalCode: '3819',
      originalMessage: error.message,
    })
  })
})
