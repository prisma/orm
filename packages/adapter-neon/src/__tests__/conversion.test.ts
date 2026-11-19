import { types } from '@neondatabase/serverless'
import { describe, expect, it } from 'vitest'

import { customParsers } from '../conversion'

describe('customParsers', () => {
  const MONEY = types.builtins.MONEY
  const MONEY_ARRAY = 791

  it.each([
    ['$999.50', '999.50'],
    ['$1,234.50', '1234.50'],
    ['-$120.00', '-120.00'],
    ['-$1,620.00', '-1620.00'],
    ['$0.00', '0.00'],
  ])('parses money %s as %s', (input, expected) => {
    expect(customParsers[MONEY](input)).toBe(expected)
  })

  it('parses a money array', () => {
    expect(customParsers[MONEY_ARRAY]('{"$1,234.50","-$5.00"}')).toEqual(['1234.50', '-5.00'])
  })

  it.each(['5,00 €', '€5.00', '$1.234,50', '$1234.50', '$5'])(
    'rejects money %s, which is not the default format',
    (input) => {
      expect(() => customParsers[MONEY](input)).toThrow('Unsupported money format')
    },
  )
})
