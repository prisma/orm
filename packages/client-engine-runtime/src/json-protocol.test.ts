import { Decimal } from '@prisma/client-runtime-utils'
import { describe, expect, test } from 'vitest'

import { deserializeJsonObject } from './json-protocol'

describe('deserializeJsonObject', () => {
  test('primitives', () => {
    expect(deserializeJsonObject(1)).toBe(1)
    expect(deserializeJsonObject('foo')).toBe('foo')
    expect(deserializeJsonObject(null)).toBe(null)
    expect(deserializeJsonObject(false)).toBe(false)
  })

  test('Date', () => {
    const value = deserializeJsonObject({ $type: 'DateTime', value: '1980-01-02T00:00:00.000Z' })
    expect(value).toBeInstanceOf(Date)
    expect(value).toEqual(new Date('1980-01-02T00:00:00.000Z'))
  })

  test('BigInt', () => {
    const value = deserializeJsonObject({ $type: 'BigInt', value: '123' })
    expect(value).toBe(123n)
  })

  test('Bytes', () => {
    const value = deserializeJsonObject({ $type: 'Bytes', value: 'aGVsbG8gd29ybGQ=' })
    expect(value).toBeInstanceOf(Uint8Array)
    expect(value).toEqual(new Uint8Array(Buffer.from('hello world')))
  })

  test('Bytes is backed by a standalone buffer', () => {
    const value = deserializeJsonObject({ $type: 'Bytes', value: 'aGVsbG8gd29ybGQ=' }) as Uint8Array
    // must not be a view into Node's shared Buffer pool, which would expose
    // unrelated pool data through `value.buffer`
    expect(value.byteOffset).toBe(0)
    expect(value.buffer.byteLength).toBe(value.byteLength)
  })

  test('Decimal', () => {
    const value = deserializeJsonObject({ $type: 'Decimal', value: '123.45' })
    expect(value).toBeInstanceOf(Decimal)
    expect(value).toEqual(new Decimal('123.45'))
  })

  test('Json', () => {
    const value = deserializeJsonObject({ $type: 'Json', value: '{"foo":123}' })
    expect(value).toEqual({ foo: 123 })
  })

  test('object', () => {
    expect(
      deserializeJsonObject({
        name: 'John',
        height: 173.45,
        money: { $type: 'Decimal', value: '123.45' },
        profile: {
          birthday: { $type: 'DateTime', value: '1980-01-02T00:00:00.000Z' },
        },
      }),
    ).toEqual({
      name: 'John',
      height: 173.45,
      money: new Decimal('123.45'),
      profile: {
        birthday: new Date('1980-01-02T00:00:00.000Z'),
      },
    })
  })

  test('array', () => {
    expect(deserializeJsonObject(['foo', 123, { $type: 'BigInt', value: '123' }])).toEqual(['foo', 123, 123n])
  })
})
