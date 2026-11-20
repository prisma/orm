import { expect, test } from 'vitest'

import { parseSize } from './size'

test('plain bytes', () => {
  expect(parseSize('0')).toEqual(0)
  expect(parseSize('1')).toEqual(1)
  expect(parseSize('1024')).toEqual(1024)
  expect(parseSize('123456789')).toEqual(123456789)
})

test('decimal units', () => {
  expect(parseSize('1KB')).toEqual(1000)
  expect(parseSize('1.5KB')).toEqual(1500)
  expect(parseSize('2MB')).toEqual(2 * 1000 * 1000)
  expect(parseSize('3.5GB')).toEqual(3.5 * 1000 * 1000 * 1000)
  expect(parseSize('2TB')).toEqual(2 * 1000 * 1000 * 1000 * 1000)
})

test('binary units', () => {
  expect(parseSize('1KiB')).toEqual(1024)
  expect(parseSize('1.5MiB')).toEqual(1.5 * 1024 * 1024)
  expect(parseSize('2GiB')).toEqual(2 * 1024 * 1024 * 1024)
  expect(parseSize('1TiB')).toEqual(1024 * 1024 * 1024 * 1024)
})

test('with whitespace', () => {
  expect(parseSize('5 KB')).toEqual(5000)
  expect(parseSize('10 MiB')).toEqual(10 * 1024 * 1024)
})

test('invalid formats', () => {
  expect(() => parseSize('')).toThrow()
  expect(() => parseSize('abc')).toThrow()
  expect(() => parseSize('123abc')).toThrow()
  expect(() => parseSize('KB')).toThrow()
  expect(() => parseSize('5XB')).toThrow() // Unknown unit
  expect(() => parseSize('-5KB')).toThrow() // Negative not supported
})
