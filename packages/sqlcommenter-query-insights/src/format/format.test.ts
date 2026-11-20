import type { SqlCommenterQueryInfo } from '@prisma/sqlcommenter'
import { describe, expect, it } from 'vitest'

import { formatQueryInsight, toBase64Url } from './format'

const PARAM_PLACEHOLDER = { $type: 'Param' }

// Helper to decode base64url for test assertions
function fromBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

// Helper to parse the prismaQuery value and extract the payload
function parseQueryInsight(insight: string): { prefix: string; payload?: unknown } {
  const colonIndex = insight.indexOf(':')
  if (colonIndex === -1) {
    return { prefix: insight }
  }
  const prefix = insight.slice(0, colonIndex)
  const encoded = insight.slice(colonIndex + 1)
  const payload = JSON.parse(fromBase64Url(encoded))
  return { prefix, payload }
}

describe('toBase64Url', () => {
  it('encodes simple strings without padding', () => {
    expect(toBase64Url('hello')).toBe('aGVsbG8')
  })

  it('encodes JSON objects', () => {
    const json = JSON.stringify({ foo: 'bar' })
    const encoded = toBase64Url(json)
    expect(fromBase64Url(encoded)).toBe(json)
  })

  it('handles unicode characters', () => {
    const text = 'héllo wörld 你好世界'
    const encoded = toBase64Url(text)
    expect(fromBase64Url(encoded)).toBe(text)
  })

  it('produces URL-safe output without + / or =', () => {
    // This string produces + and / in standard base64
    const data = '>>>???'
    const encoded = toBase64Url(data)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    expect(fromBase64Url(encoded)).toBe(data)
  })
})

describe('formatQueryInsight', () => {
  describe('raw queries', () => {
    it('formats queryRaw without payload', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        action: 'queryRaw',
        query: {},
      }
      expect(formatQueryInsight(queryInfo)).toBe('queryRaw')
    })

    it('formats executeRaw without payload', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        action: 'executeRaw',
        query: {},
      }
      expect(formatQueryInsight(queryInfo)).toBe('executeRaw')
    })
  })

  describe('single queries', () => {
    it('formats findMany query with $scalars to empty object', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: { selection: { $scalars: true } },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findMany')
      // After shaping: $scalars only = no select/include needed
      expect(parsed.payload).toEqual({})
    })

    it('formats findUnique query with shaped where clause', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findUnique',
        query: {
          arguments: { where: { id: PARAM_PLACEHOLDER } },
          selection: { $scalars: true },
        },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findUnique')
      // After shaping: arguments spread to top level, $scalars only = no select/include
      expect(parsed.payload).toEqual({
        where: { id: PARAM_PLACEHOLDER },
      })
    })

    it('formats createOne query with shaped data', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'createOne',
        query: {
          arguments: {
            data: { email: PARAM_PLACEHOLDER, name: PARAM_PLACEHOLDER },
          },
          selection: { $scalars: true },
        },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.createOne')
      // After shaping: arguments spread to top level, $scalars only = no select/include
      expect(parsed.payload).toEqual({
        data: { email: PARAM_PLACEHOLDER, name: PARAM_PLACEHOLDER },
      })
    })

    it('formats query with relation using include', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { active: PARAM_PLACEHOLDER } },
          selection: {
            $scalars: true,
            $composites: true,
            posts: {
              $scalars: true,
              $composites: true,
            },
          },
        },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findMany')
      // After shaping: $scalars + relation = include
      expect(parsed.payload).toEqual({
        where: { active: PARAM_PLACEHOLDER },
        include: { posts: true },
      })
    })

    it('formats query with explicit field selection using select', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: {},
          selection: {
            name: true,
            email: true,
          },
        },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findMany')
      // After shaping: explicit fields without $scalars = select
      expect(parsed.payload).toEqual({
        select: { name: true, email: true },
      })
    })
  })

  describe('compacted queries', () => {
    it('formats compacted findUnique batch with shaped queries', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'compacted',
        modelName: 'User',
        action: 'findUnique',
        queries: [
          { arguments: { where: { id: PARAM_PLACEHOLDER } }, selection: { $scalars: true } },
          { arguments: { where: { id: PARAM_PLACEHOLDER } }, selection: { $scalars: true } },
        ],
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findUnique')
      // After shaping: each query has arguments spread and $scalars removed
      expect(parsed.payload).toEqual([{ where: { id: PARAM_PLACEHOLDER } }, { where: { id: PARAM_PLACEHOLDER } }])
    })

    it('formats compacted batch with relations', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'compacted',
        modelName: 'User',
        action: 'findUnique',
        queries: [
          {
            arguments: { where: { id: PARAM_PLACEHOLDER } },
            selection: { $scalars: true, posts: { $scalars: true, $composites: true } },
          },
          {
            arguments: { where: { id: PARAM_PLACEHOLDER } },
            selection: { $scalars: true, posts: { $scalars: true, $composites: true } },
          },
        ],
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findUnique')
      expect(parsed.payload).toEqual([
        { where: { id: PARAM_PLACEHOLDER }, include: { posts: true } },
        { where: { id: PARAM_PLACEHOLDER }, include: { posts: true } },
      ])
    })
  })

  describe('edge cases', () => {
    it('handles empty query object', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: {},
      }
      const result = formatQueryInsight(queryInfo)
      expect(result).toMatch(/^User\.findMany:/)
      const parsed = parseQueryInsight(result)
      expect(parsed.payload).toEqual({})
    })

    it('handles query with only explicit field selection', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: { selection: { id: true, email: true } },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)
      expect(parsed.prefix).toBe('User.findMany')
      // After shaping: explicit fields = select
      expect(parsed.payload).toEqual({ select: { id: true, email: true } })
    })

    it('handles empty compacted queries array', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'compacted',
        modelName: 'User',
        action: 'findUnique',
        queries: [],
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)
      expect(parsed.prefix).toBe('User.findUnique')
      expect(parsed.payload).toEqual([])
    })

    it('handles very long queries with explicit field selection', () => {
      const manyFields: Record<string, boolean> = {}
      for (let i = 0; i < 100; i++) {
        manyFields[`field${i}`] = true
      }

      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'LargeModel',
        action: 'findMany',
        query: { selection: manyFields },
      }

      const result = formatQueryInsight(queryInfo)
      expect(result).toMatch(/^LargeModel\.findMany:/)
      // Should not throw and should produce valid base64url
      const parsed = parseQueryInsight(result)
      // After shaping: explicit fields = select with all 100 fields
      expect(Object.keys((parsed.payload as Record<string, unknown>).select as object).length).toBe(100)
    })

    it('handles special characters in values', () => {
      const specialValue = 'test\'value"with<special>chars&more'

      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findFirst',
        query: {
          arguments: { where: { name: specialValue } },
          selection: { $scalars: true },
        },
      }

      const result = formatQueryInsight(queryInfo)
      // Should not contain the special value
      expect(result).not.toContain(specialValue)
      // Should still be valid
      expect(() => parseQueryInsight(result)).not.toThrow()
    })

    it('handles nested relations with mixed select/include', () => {
      const queryInfo: SqlCommenterQueryInfo = {
        type: 'single',
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { active: PARAM_PLACEHOLDER } },
          selection: {
            name: true,
            posts: {
              arguments: { take: 10 },
              selection: {
                $scalars: true,
                $composites: true,
                comments: {
                  arguments: {},
                  selection: {
                    $scalars: true,
                    $composites: true,
                  },
                },
              },
            },
          },
        },
      }
      const result = formatQueryInsight(queryInfo)
      const parsed = parseQueryInsight(result)

      expect(parsed.prefix).toBe('User.findMany')
      // After shaping: top level uses select (no $scalars), posts uses include ($scalars)
      expect(parsed.payload).toEqual({
        where: { active: PARAM_PLACEHOLDER },
        select: {
          name: true,
          posts: {
            take: 10, // take is preserved as structural pagination value
            include: {
              comments: true,
            },
          },
        },
      })
    })
  })
})
