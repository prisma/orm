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
})
