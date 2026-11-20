import { expect, test } from 'vitest'

import { parseInteger } from './numeric'

test('valid integers', () => {
  expect(parseInteger('0')).toEqual(0)
  expect(parseInteger('1')).toEqual(1)
  expect(parseInteger('123')).toEqual(123)
  expect(parseInteger('-456')).toEqual(-456)
  expect(parseInteger('999999999')).toEqual(999999999)
})

test('invalid inputs', () => {
  expect(() => parseInteger('')).toThrow()
  expect(() => parseInteger('abc')).toThrow()
  expect(() => parseInteger('123.45')).toThrow()
  expect(() => parseInteger('123abc')).toThrow()
  expect(() => parseInteger(' 123')).toThrow()
  expect(() => parseInteger('123 ')).toThrow()
  expect(() => parseInteger('0x10')).toThrow()
})
