import { Temporal } from 'temporal-polyfill'
import { expect, test } from 'vitest'

import { parseDuration } from './duration'

test('ISO 8601 format', () => {
  expect(parseDuration('P3DT2H')).toEqual(
    Temporal.Duration.from({
      days: 3,
      hours: 2,
    }),
  )
})

test('milliseconds format', () => {
  expect(parseDuration('1000')).toEqual(Temporal.Duration.from({ milliseconds: 1000 }))
  expect(parseDuration('0')).toEqual(Temporal.Duration.from({ milliseconds: 0 }))
})

test('invalid format', () => {
  expect(() => parseDuration('')).toThrow()
  expect(() => parseDuration('10m')).toThrow()
})
