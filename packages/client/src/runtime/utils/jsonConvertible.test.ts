import { isJSONConvertible } from './jsonConvertible'

describe('isJSONConvertible', () => {
  test('true for object with own toJSON method', () => {
    expect(isJSONConvertible({ toJSON: () => 'value' })).toBe(true)
  })

  test('true for class instance with toJSON on its prototype', () => {
    class Id {
      toJSON() {
        return 'value'
      }
    }
    expect(isJSONConvertible(new Id())).toBe(true)
  })

  test('false for null', () => {
    expect(isJSONConvertible(null)).toBe(false)
  })

  test('false for primitives', () => {
    expect(isJSONConvertible(1)).toBe(false)
    expect(isJSONConvertible('one')).toBe(false)
    expect(isJSONConvertible(true)).toBe(false)
  })

  test('false for plain object without toJSON', () => {
    expect(isJSONConvertible({ equals: 'value' })).toBe(false)
  })

  test('false when toJSON is not a function', () => {
    expect(isJSONConvertible({ toJSON: 'value' })).toBe(false)
  })
})
