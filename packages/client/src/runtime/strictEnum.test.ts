import { expect, test } from 'vitest'

import { makeStrictEnum } from './strictEnum'

const StrictEnum = makeStrictEnum({
  ONE: '1',
  TWO: '2',
  THREE: '3',
})

test('individual values', () => {
  expect(StrictEnum.ONE).toBe('1')
  expect(StrictEnum.TWO).toBe('2')
  expect(StrictEnum.THREE).toBe('3')
})

test('throws on undefined value', () => {
  expect(() => (StrictEnum as any).NOT_THERE).toThrowErrorMatchingInlineSnapshot(
    `[TypeError: Invalid enum value: NOT_THERE]`,
  )
})

test('keys', () => {
  expect(Object.keys(StrictEnum)).toEqual(['ONE', 'TWO', 'THREE'])
})

test('values', () => {
  expect(Object.values(StrictEnum)).toEqual(['1', '2', '3'])
})

test('in', () => {
  expect('ONE' in StrictEnum).toBe(true)
  expect('NotThere' in StrictEnum).toEqual(false)
})

test('hasOwnProperty', () => {
  expect(Object.prototype.hasOwnProperty.call(StrictEnum, 'ONE')).toBe(true)
  expect(Object.prototype.hasOwnProperty.call(StrictEnum, 'NotThere')).toBe(false)
})

test('JSON.stringify', () => {
  expect(JSON.stringify(StrictEnum)).toMatchInlineSnapshot(`"{"ONE":"1","TWO":"2","THREE":"3"}"`)
})

test('Object.prototype.toString', () => {
  expect(Object.prototype.toString.call(StrictEnum)).toMatchInlineSnapshot(`"[object Object]"`)
})

test('iterator', () => {
  expect(([] as object[]).concat(StrictEnum)).toEqual([StrictEnum])
})

test('toPrimitive', () => {
  expect(+StrictEnum).toBeNaN()
})
