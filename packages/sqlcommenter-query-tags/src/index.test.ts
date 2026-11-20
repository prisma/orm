import type { SqlCommenterContext, SqlCommenterTags } from '@prisma/sqlcommenter'
import { describe, expect, it } from 'vitest'

import { queryTags, withMergedQueryTags, withQueryTags } from './index'

// Helper to create a mock context - the plugin doesn't actually use the context,
// so we just need something type-compatible
function createMockContext(): SqlCommenterContext {
  return {
    query: {
      type: 'single',
      action: 'findMany',
      modelName: 'User',
      query: {},
    },
  }
}

describe('queryTags', () => {
  it('returns an empty object when no tags are set', () => {
    const plugin = queryTags()
    const mockContext = createMockContext()

    expect(plugin(mockContext)).toEqual({})
  })

  it('returns tags from AsyncLocalStorage when set via withQueryTags', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()
    const tags = { route: '/api/users', requestId: 'abc-123' }

    let capturedTags: SqlCommenterTags | undefined

    await withQueryTags(tags, () => {
      capturedTags = plugin(mockContext)
      return Promise.resolve()
    })

    expect(capturedTags).toEqual(tags)
  })

  it('returns empty object outside withQueryTags scope', async () => {
    expect.assertions(2)

    const plugin = queryTags()
    const mockContext = createMockContext()
    const tags = { route: '/api/users' }

    await withQueryTags(tags, () => {
      // Inside scope, tags are available
      expect(plugin(mockContext)).toEqual(tags)
      return Promise.resolve()
    })

    // Outside scope, no tags
    expect(plugin(mockContext)).toEqual({})
  })
})

describe('withQueryTags', () => {
  it('returns the result of the scope function', async () => {
    expect.assertions(1)

    const expectedResult = { users: [{ id: 1, name: 'Alice' }] }

    const result = await withQueryTags({ route: '/test' }, () => {
      return Promise.resolve(expectedResult)
    })

    expect(result).toBe(expectedResult)
  })

  it('handles nested withQueryTags calls with inner tags taking precedence', async () => {
    expect.assertions(3)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const outerTags = { route: '/outer', user: 'outer-user' }
    const innerTags = { route: '/inner', requestId: 'inner-123' }

    let outerCapture: SqlCommenterTags | undefined
    let innerCapture: SqlCommenterTags | undefined
    let afterInnerCapture: SqlCommenterTags | undefined

    await withQueryTags(outerTags, async () => {
      outerCapture = plugin(mockContext)

      await withQueryTags(innerTags, () => {
        innerCapture = plugin(mockContext)
        return Promise.resolve()
      })

      afterInnerCapture = plugin(mockContext)
    })

    expect(outerCapture).toEqual(outerTags)
    expect(innerCapture).toEqual(innerTags) // Inner completely replaces outer
    expect(afterInnerCapture).toEqual(outerTags) // Restored after inner scope
  })

  it('propagates errors from the scope function', async () => {
    expect.assertions(1)

    const error = new Error('Test error')

    await expect(
      withQueryTags({ route: '/test' }, () => {
        return Promise.reject(error)
      }),
    ).rejects.toThrow(error)
  })

  it('returns result from the wrapped function', async () => {
    expect.assertions(2)

    const plugin = queryTags()
    const mockContext = createMockContext()
    const tags = { tag: 'test' }

    const result = await withQueryTags(tags, () => {
      expect(plugin(mockContext)).toEqual(tags)
      return Promise.resolve('result')
    })

    expect(result).toBe('result')
  })

  it('maintains context across async operations', async () => {
    expect.assertions(2)

    const plugin = queryTags()
    const mockContext = createMockContext()
    const tags = { route: '/async-test' }

    await withQueryTags(tags, async () => {
      // Before delay
      expect(plugin(mockContext)).toEqual(tags)

      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10))

      // After delay - context should be preserved
      expect(plugin(mockContext)).toEqual(tags)
    })
  })

  it('isolates tags between concurrent requests', async () => {
    expect.assertions(2)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const tags1 = { requestId: 'request-1' }
    const tags2 = { requestId: 'request-2' }

    const captures: string[] = []

    await Promise.all([
      withQueryTags(tags1, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        captures.push(`1: ${plugin(mockContext).requestId}`)
      }),
      withQueryTags(tags2, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        captures.push(`2: ${plugin(mockContext).requestId}`)
      }),
    ])

    expect(captures).toContain('1: request-1')
    expect(captures).toContain('2: request-2')
  })
})

describe('withMergedQueryTags', () => {
  it('merges tags with existing context', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const outerTags = { requestId: 'req-123', source: 'api' }
    const innerTags = { userId: 'user-456' }

    await withQueryTags(outerTags, async () => {
      await withMergedQueryTags(innerTags, () => {
        expect(plugin(mockContext)).toEqual({
          requestId: 'req-123',
          source: 'api',
          userId: 'user-456',
        })
        return Promise.resolve()
      })
    })
  })

  it('overrides existing tags with same key', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const outerTags = { requestId: 'req-123', source: 'api' }
    const innerTags = { source: 'handler', userId: 'user-456' }

    await withQueryTags(outerTags, async () => {
      await withMergedQueryTags(innerTags, () => {
        expect(plugin(mockContext)).toEqual({
          requestId: 'req-123',
          source: 'handler',
          userId: 'user-456',
        })
        return Promise.resolve()
      })
    })
  })

  it('removes keys when undefined is passed', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const outerTags = { requestId: 'req-123', debug: 'true', source: 'api' }

    await withQueryTags(outerTags, async () => {
      // Explicitly remove 'debug' by setting it to undefined
      await withMergedQueryTags({ userId: 'user-456', debug: undefined }, () => {
        // debug should be removed (undefined), requestId and source preserved, userId added
        expect(plugin(mockContext)).toEqual({
          requestId: 'req-123',
          source: 'api',
          userId: 'user-456',
          debug: undefined,
        })
        return Promise.resolve()
      })
    })
  })

  it('works without existing context', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()
    const tags = { route: '/test' }

    await withMergedQueryTags(tags, () => {
      expect(plugin(mockContext)).toEqual(tags)
      return Promise.resolve()
    })
  })

  it('restores outer context after scope ends', async () => {
    expect.assertions(1)

    const plugin = queryTags()
    const mockContext = createMockContext()

    const outerTags = { requestId: 'req-123' }
    const innerTags = { userId: 'user-456' }

    await withQueryTags(outerTags, async () => {
      await withMergedQueryTags(innerTags, () => {
        return Promise.resolve()
      })

      // After inner scope, should be back to outer tags only
      expect(plugin(mockContext)).toEqual(outerTags)
    })
  })

  it('supports multiple levels of nesting', async () => {
    expect.assertions(3)

    const plugin = queryTags()
    const mockContext = createMockContext()

    await withQueryTags({ level: '1' }, async () => {
      await withMergedQueryTags({ level: '2', extra: 'a' }, async () => {
        await withMergedQueryTags({ level: '3', more: 'b' }, () => {
          expect(plugin(mockContext)).toEqual({
            level: '3',
            extra: 'a',
            more: 'b',
          })
          return Promise.resolve()
        })

        // Back to level 2
        expect(plugin(mockContext)).toEqual({
          level: '2',
          extra: 'a',
        })
      })

      // Back to level 1
      expect(plugin(mockContext)).toEqual({ level: '1' })
    })
  })

  it('returns the result of the scope function', async () => {
    expect.assertions(1)

    const expectedResult = { data: 'test' }

    const result = await withMergedQueryTags({ tag: 'value' }, () => {
      return Promise.resolve(expectedResult)
    })

    expect(result).toBe(expectedResult)
  })

  it('propagates errors from the scope function', async () => {
    expect.assertions(1)

    const error = new Error('Test error')

    await expect(
      withMergedQueryTags({ tag: 'value' }, () => {
        return Promise.reject(error)
      }),
    ).rejects.toThrow(error)
  })
})

describe('multiple plugin instances', () => {
  it('all instances share the same AsyncLocalStorage context', async () => {
    expect.assertions(2)

    const plugin1 = queryTags()
    const plugin2 = queryTags()
    const mockContext = createMockContext()
    const tags = { shared: 'value' }

    await withQueryTags(tags, () => {
      expect(plugin1(mockContext)).toEqual(tags)
      expect(plugin2(mockContext)).toEqual(tags)
      return Promise.resolve()
    })
  })
})
