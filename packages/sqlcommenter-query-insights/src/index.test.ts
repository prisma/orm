import type { SqlCommenterContext, SqlCommenterQueryInfo } from '@prisma/sqlcommenter'
import { describe, expect, it } from 'vitest'

import { prismaQueryInsights } from './index'

// Helper to create a mock context
function createMockContext(queryInfo: SqlCommenterQueryInfo): SqlCommenterContext {
  return {
    query: queryInfo,
  }
}

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

describe('prismaQueryInsights plugin', () => {
  it('returns prismaQuery tag', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      modelName: 'User',
      action: 'findMany',
      query: { selection: { $scalars: true } },
    })

    const result = plugin(context)
    expect(result).toHaveProperty('prismaQuery')
    expect(typeof result.prismaQuery).toBe('string')
  })

  it('formats raw queries correctly', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      action: 'queryRaw',
      query: {},
    })

    const result = plugin(context)
    expect(result.prismaQuery).toBe('queryRaw')
  })

  it('includes model and action in output', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      modelName: 'Post',
      action: 'findFirst',
      query: { selection: { $scalars: true } },
    })

    const result = plugin(context)
    expect(result.prismaQuery).toMatch(/^Post\.findFirst:/)
  })

  it('parameterizes user data in queries', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: { email: 'secret@example.com' },
        },
        selection: { $scalars: true },
      },
    })

    const result = plugin(context)
    // The actual email should not appear in the output
    expect(result.prismaQuery).not.toContain('secret@example.com')
    // But the structure should be preserved (base64url encoded)
    expect(result.prismaQuery).toMatch(/^User\.findMany:[A-Za-z0-9_-]+$/)
  })

  it('handles compacted batch queries', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'compacted',
      modelName: 'User',
      action: 'findUnique',
      queries: [
        { arguments: { where: { id: 1 } }, selection: { $scalars: true } },
        { arguments: { where: { id: 2 } }, selection: { $scalars: true } },
      ],
    })

    const result = plugin(context)
    expect(result.prismaQuery).toMatch(/^User\.findUnique:[A-Za-z0-9_-]+$/)

    // Decode and verify it's an array
    const parsed = parseQueryInsight(result.prismaQuery!)
    expect(Array.isArray(parsed.payload)).toBe(true)
    expect((parsed.payload as unknown[]).length).toBe(2)
  })

  it('creates new plugin instance each time', () => {
    const plugin1 = prismaQueryInsights()
    const plugin2 = prismaQueryInsights()
    expect(plugin1).not.toBe(plugin2)
  })

  it('preserves orderBy shorthand sort direction', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          orderBy: { createdAt: 'desc' },
        },
        selection: { $scalars: true },
      },
    })

    const result = plugin(context)
    const parsed = parseQueryInsight(result.prismaQuery!)

    expect(parsed.prefix).toBe('User.findMany')
    // The orderBy with shorthand format should preserve 'desc'
    expect(parsed.payload).toEqual({
      orderBy: { createdAt: 'desc' },
    })
  })

  it('preserves orderBy long format sort direction', () => {
    const plugin = prismaQueryInsights()
    const context = createMockContext({
      type: 'single',
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          orderBy: { createdAt: { sort: 'desc', nulls: 'last' } },
        },
        selection: { $scalars: true },
      },
    })

    const result = plugin(context)
    const parsed = parseQueryInsight(result.prismaQuery!)

    expect(parsed.prefix).toBe('User.findMany')
    // The orderBy with long format should preserve sort and nulls
    expect(parsed.payload).toEqual({
      orderBy: { createdAt: { sort: 'desc', nulls: 'last' } },
    })
  })
})
