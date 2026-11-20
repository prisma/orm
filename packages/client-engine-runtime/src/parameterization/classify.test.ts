import { describe, expect, it } from 'vitest'

import { classifyValue, isPlainObject, isTaggedValue } from './classify'

describe('classifyValue', () => {
  describe('null values', () => {
    it('classifies null as null', () => {
      const result = classifyValue(null)
      expect(result).toEqual({ kind: 'null' })
    })

    it('classifies undefined as null', () => {
      const result = classifyValue(undefined)
      expect(result).toEqual({ kind: 'null' })
    })
  })

  describe('primitive values', () => {
    it('classifies string as primitive', () => {
      const result = classifyValue('hello')
      expect(result).toEqual({ kind: 'primitive', value: 'hello' })
    })

    it('classifies empty string as primitive', () => {
      const result = classifyValue('')
      expect(result).toEqual({ kind: 'primitive', value: '' })
    })

    it('classifies number as primitive', () => {
      const result = classifyValue(42)
      expect(result).toEqual({ kind: 'primitive', value: 42 })
    })

    it('classifies zero as primitive', () => {
      const result = classifyValue(0)
      expect(result).toEqual({ kind: 'primitive', value: 0 })
    })

    it('classifies negative number as primitive', () => {
      const result = classifyValue(-123)
      expect(result).toEqual({ kind: 'primitive', value: -123 })
    })

    it('classifies float as primitive', () => {
      const result = classifyValue(3.14)
      expect(result).toEqual({ kind: 'primitive', value: 3.14 })
    })

    it('classifies true as primitive', () => {
      const result = classifyValue(true)
      expect(result).toEqual({ kind: 'primitive', value: true })
    })

    it('classifies false as primitive', () => {
      const result = classifyValue(false)
      expect(result).toEqual({ kind: 'primitive', value: false })
    })
  })

  describe('array values', () => {
    it('classifies empty array', () => {
      const result = classifyValue([])
      expect(result).toEqual({ kind: 'array', items: [] })
    })

    it('classifies array of primitives', () => {
      const result = classifyValue([1, 2, 3])
      expect(result).toEqual({ kind: 'array', items: [1, 2, 3] })
    })

    it('classifies array of mixed values', () => {
      const items = ['a', 1, true, null]
      const result = classifyValue(items)
      expect(result).toEqual({ kind: 'array', items })
    })

    it('classifies nested arrays', () => {
      const items = [
        [1, 2],
        [3, 4],
      ]
      const result = classifyValue(items)
      expect(result).toEqual({ kind: 'array', items })
    })
  })

  describe('tagged scalar values', () => {
    it('classifies DateTime tagged value', () => {
      const value = { $type: 'DateTime', value: '2024-01-01T00:00:00.000Z' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'DateTime', value: '2024-01-01T00:00:00.000Z' })
    })

    it('classifies Decimal tagged value', () => {
      const value = { $type: 'Decimal', value: '123.456' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'Decimal', value: '123.456' })
    })

    it('classifies BigInt tagged value', () => {
      const value = { $type: 'BigInt', value: '9007199254740993' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'BigInt', value: '9007199254740993' })
    })

    it('classifies Bytes tagged value', () => {
      const value = { $type: 'Bytes', value: 'SGVsbG8gV29ybGQ=' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'Bytes', value: 'SGVsbG8gV29ybGQ=' })
    })

    it('classifies Json tagged value', () => {
      const value = { $type: 'Json', value: { key: 'value' } }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'Json', value: { key: 'value' } })
    })

    it('classifies Raw tagged value', () => {
      const value = { $type: 'Raw', value: { $type: 'Json' } }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'taggedScalar', tag: 'Raw', value: { $type: 'Json' } })
    })
  })

  describe('structural tagged values', () => {
    it('classifies FieldRef as structural', () => {
      const fieldRefValue = { _ref: 'balance', _container: 'Account' }
      const value = { $type: 'FieldRef', value: fieldRefValue }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'structural', value: fieldRefValue })
    })

    it('classifies Enum as structural', () => {
      const value = { $type: 'Enum', value: 'ACTIVE' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'structural', value: 'ACTIVE' })
    })

    it('classifies Param as structural', () => {
      const value = { $type: 'Param', value: 'query.arguments.where.id' }
      const result = classifyValue(value)
      expect(result).toEqual({ kind: 'structural', value: 'query.arguments.where.id' })
    })
  })

  describe('plain object values', () => {
    it('classifies empty object', () => {
      const result = classifyValue({})
      expect(result).toEqual({ kind: 'object', entries: {} })
    })

    it('classifies object with primitive values', () => {
      const obj = { name: 'John', age: 30 }
      const result = classifyValue(obj)
      expect(result).toEqual({ kind: 'object', entries: obj })
    })

    it('classifies nested object', () => {
      const obj = { user: { name: 'John' }, active: true }
      const result = classifyValue(obj)
      expect(result).toEqual({ kind: 'object', entries: obj })
    })

    it('classifies object with array values', () => {
      const obj = { ids: [1, 2, 3] }
      const result = classifyValue(obj)
      expect(result).toEqual({ kind: 'object', entries: obj })
    })
  })
})

describe('isPlainObject', () => {
  it('returns true for empty object', () => {
    expect(isPlainObject({})).toBe(true)
  })

  it('returns true for object with properties', () => {
    expect(isPlainObject({ a: 1, b: 2 })).toBe(true)
  })

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false)
  })

  it('returns false for array', () => {
    expect(isPlainObject([1, 2, 3])).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isPlainObject([])).toBe(false)
  })

  it('returns false for tagged value', () => {
    expect(isPlainObject({ $type: 'DateTime', value: '2024-01-01' })).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isPlainObject('string')).toBe(false)
    expect(isPlainObject(123)).toBe(false)
    expect(isPlainObject(true)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isPlainObject(undefined)).toBe(false)
  })
})

describe('isTaggedValue', () => {
  it('returns true for valid tagged value', () => {
    expect(isTaggedValue({ $type: 'DateTime', value: '2024-01-01' })).toBe(true)
  })

  it('returns true for any string $type', () => {
    expect(isTaggedValue({ $type: 'Custom', value: 'test' })).toBe(true)
  })

  it('returns false for object without $type', () => {
    expect(isTaggedValue({ value: 'test' })).toBe(false)
  })

  it('returns false for object with non-string $type', () => {
    expect(isTaggedValue({ $type: 123, value: 'test' })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTaggedValue(null)).toBe(false)
  })

  it('returns false for array', () => {
    expect(isTaggedValue([{ $type: 'Test' }])).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isTaggedValue('string')).toBe(false)
    expect(isTaggedValue(123)).toBe(false)
    expect(isTaggedValue(true)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTaggedValue(undefined)).toBe(false)
  })
})
