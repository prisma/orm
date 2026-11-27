import { describe, expect, it } from 'vitest'

import { convertDriverError } from '../errors'

describe('convertDriverError', () => {
  it.each(['40001', '40P01'])('should handle TransactionWriteConflict (%s)', (code) => {
    const error = { code, message: 'msg', severity: 'ERROR' }
    expect(convertDriverError(error)).toEqual({
      kind: 'TransactionWriteConflict',
      originalCode: error.code,
      originalMessage: error.message,
    })
  })

  it('should handle CheckConstraintViolation (23514)', () => {
    const error = {
      code: '23514',
      message: 'new row for relation "t" violates check constraint "t_sum_check"',
      severity: 'ERROR',
      detail: 'Failing row contains (1, 1).',
      constraint: 't_sum_check',
    }
    expect(convertDriverError(error)).toEqual({
      kind: 'CheckConstraintViolation',
      constraint: { index: 't_sum_check' },
      originalCode: error.code,
      originalMessage: error.message,
    })
  })
})
