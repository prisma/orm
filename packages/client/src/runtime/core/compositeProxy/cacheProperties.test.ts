import { expect, test, vi } from 'vitest'

import { cacheProperties } from './cacheProperties'
import { createCompositeProxy } from './createCompositeProxy'

test('caches getPropertyValue calls', () => {
  const getPropertyValue = vi.fn().mockReturnValue(1)
  const layer = cacheProperties({
    getKeys() {
      return ['prop']
    },
    getPropertyValue,
  })

  const proxy = createCompositeProxy({} as Record<string, number>, [layer])

  expect(proxy.prop).toBe(1)
  expect(proxy.prop).toBe(1)

  expect(getPropertyValue).toHaveBeenCalledTimes(1)
})

test('forwards getPropertyDescriptor calls', () => {
  const layer = cacheProperties({
    getKeys() {
      return ['prop1', 'prop2']
    },
    getPropertyValue() {
      return 1
    },

    getPropertyDescriptor(key) {
      return key === 'prop1' ? { enumerable: false } : undefined
    },
  })

  const proxy = createCompositeProxy({}, [layer])

  expect(Object.keys(proxy)).toEqual(['prop2'])
})

test('keeps separate cache entries for separate properties', () => {
  const getPropertyValue = vi.fn().mockImplementation((key) => {
    return key === 'first' ? 1 : 2
  })

  const layer = cacheProperties({
    getKeys() {
      return ['first', 'second']
    },
    getPropertyValue,
  })

  const proxy = createCompositeProxy({} as Record<string, number>, [layer])

  expect(proxy.first).toBe(1)
  expect(proxy.first).toBe(1)
  expect(proxy.second).toBe(2)
  expect(proxy.second).toBe(2)

  expect(getPropertyValue).toHaveBeenCalledTimes(2)
})
