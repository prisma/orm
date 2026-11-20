import { describe, expect, test } from 'vitest'

import { maxBy, maxWithComparator } from './max'

describe('maxWithComparator', () => {
  test('empty array', () => {
    expect(maxWithComparator([], () => 0)).toBe(undefined)
  })

  test('with items', () => {
    const items = [{ count: 1 }, { count: 10 }, { count: 5 }]
    expect(maxWithComparator(items, (a, b) => a.count - b.count)).toBe(items[1])
  })
})

describe('maxBy', () => {
  test('empty array', () => {
    expect(maxBy([], () => 1)).toBe(undefined)
  })

  test('with items', () => {
    const items = [{ count: 1 }, { count: 10 }, { count: 5 }]
    expect(maxBy(items, (item) => item.count)).toBe(items[1])
  })
})
