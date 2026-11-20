import { describe, expect, test } from 'vitest'

import { deepGet } from '../runtime/utils/deep-set'

describe('deepGet', () => {
  test('work with 0', () => {
    const obj = {
      aggregateUser: {
        count: 0,
      },
    }
    const path = ['aggregateUser', 'count']
    const result = deepGet(obj, path)
    expect(result).toMatchInlineSnapshot(`0`)
  })

  test('work with false', () => {
    const obj = {
      aggregateUser: {
        count: false,
      },
    }
    const path = ['aggregateUser', 'count']
    expect(deepGet(obj, path)).toMatchInlineSnapshot(`false`)
  })

  test('work with deep object', () => {
    const obj = {
      very: {
        deep: {
          obj: {
            with: {
              deep: 'stuff',
            },
          },
        },
      },
    }
    const path = ['very', 'deep', 'obj']
    expect(deepGet(obj, path)).toMatchInlineSnapshot(`
      {
        "with": {
          "deep": "stuff",
        },
      }
    `)
  })

  test('return undefined for invalid path', () => {
    const obj = {
      very: {
        deep: {
          obj: {
            with: {
              deep: 'stuff',
            },
          },
        },
      },
    }
    const path = ['very', 'deep', 'obj2']
    expect(deepGet(obj, path)).toMatchInlineSnapshot(`undefined`)
  })

  test('work with array', () => {
    const obj = [
      {
        id: 1,
      },
    ]

    const path = ['0', 'id']
    expect(deepGet(obj, path)).toMatchInlineSnapshot(`1`)
  })
})
