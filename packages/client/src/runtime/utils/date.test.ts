import { describe, expect, test } from 'vitest'

import { isValidDate } from './date'

describe('isValidDate', () => {
  test('valid', () => {
    expect(isValidDate(new Date('2020-01-01'))).toBe(true)
  })

  test('invalid', () => {
    expect(isValidDate(new Date('Not a date'))).toBe(false)
  })
})
