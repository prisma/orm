import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { prismaQueryInsights } from '@prisma/sqlcommenter-query-insights'

import { Prisma, PrismaClient } from './generated/prisma/client.js'

// Helper to decode base64url and parse JSON
function decodePayload(base64url: string): unknown {
  const json = Buffer.from(base64url, 'base64url').toString('utf-8')
  return JSON.parse(json)
}

// Helper to parse prismaQuery comment value
function parsePrismaQuery(value: string): { prefix: string; payload?: unknown } {
  const colonIndex = value.indexOf(':')
  if (colonIndex === -1) {
    return { prefix: value }
  }
  const prefix = value.slice(0, colonIndex)
  const encoded = value.slice(colonIndex + 1)
  const payload = decodePayload(encoded)
  return { prefix, payload }
}

// Helper to extract prismaQuery from SQL comment
function extractPrismaQuery(sql: string): string | null {
  // Match /*...prismaQuery='...'...*/
  const match = sql.match(/prismaQuery='((?:[^'\\]|\\.)*)'/s)
  if (!match) return null
  // Unescape single quotes and URL-decode
  return decodeURIComponent(match[1].replace(/\\'/g, "'"))
}

function isParamPlaceholder(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '$type' in value && value.$type === 'Param'
}

const adapter = new PrismaBetterSqlite3({
  url: './dev.db',
})

const capturedQueries: string[] = []

const prisma = new PrismaClient({
  adapter,
  comments: [prismaQueryInsights()],
  log: [{ emit: 'event', level: 'query' }],
})

prisma.$on('query', (event: Prisma.QueryEvent) => {
  capturedQueries.push(event.query)
})

// Helper to clear captured queries and return what was captured
function flushQueries(): string[] {
  const queries = [...capturedQueries]
  capturedQueries.length = 0
  return queries
}

// Helper to verify queries from an operation
function verifyQueries(
  description: string,
  queries: string[],
  checks: {
    expectedCount?: number
    prefix?: string
    queryIndex?: number
    containsInPayload?: (payload: unknown) => boolean
    notContains?: string[]
  },
) {
  const queryIndex = checks.queryIndex ?? 0

  if (checks.expectedCount !== undefined) {
    assert.strictEqual(
      queries.length,
      checks.expectedCount,
      `${description}: expected ${checks.expectedCount} queries, got ${queries.length}`,
    )
  }

  const sql = queries[queryIndex]
  assert(sql, `${description}: query at index ${queryIndex} not found (got ${queries.length} queries)`)

  const prismaQuery = extractPrismaQuery(sql)
  assert(prismaQuery, `${description}: should have prismaQuery comment`)

  const parsed = parsePrismaQuery(prismaQuery)

  if (checks.prefix) {
    assert.strictEqual(parsed.prefix, checks.prefix, `${description}: prefix mismatch`)
  }

  if (checks.containsInPayload) {
    assert(
      checks.containsInPayload(parsed.payload),
      `${description}: payload check failed: ${JSON.stringify(parsed.payload, null, 2)}`,
    )
  }

  if (checks.notContains) {
    for (const value of checks.notContains) {
      assert(!prismaQuery.includes(value), `${description}: should not contain "${value}"`)
    }
  }

  console.log(`✓ ${description}`)
}

// We need to store the user id for the post creation test
let createdUserId: number

// Test 1: Simple findMany - should have Model.action format with empty payload (all scalars)
{
  console.log('Test 1: Simple findMany')

  await prisma.user.findMany()

  verifyQueries('findMany', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as Record<string, unknown>
      return Object.keys(payload).length === 0
    },
  })
}

// Test 2: Create with data - data values should be parameterized
{
  console.log('Test 2: Create with data')

  const user = await prisma.user.create({
    data: { email: 'secret@private.com', name: 'Secret Name' },
  })

  createdUserId = user.id

  verifyQueries('create with data', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.createOne',
    containsInPayload: (p) => {
      const payload = p as { data?: { email?: unknown; name?: unknown } }
      const data = payload.data
      return data !== undefined && isParamPlaceholder(data.email) && isParamPlaceholder(data.name)
    },
    notContains: ['secret@private.com', 'Secret Name'],
  })
}

// Test 3: findFirst with where clause - filter values should be parameterized
{
  console.log('Test 3: findFirst with where clause')

  await prisma.user.findFirst({
    where: { email: 'secret@private.com' },
  })

  verifyQueries('findFirst with where', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findFirst',
    containsInPayload: (p) => {
      const payload = p as { where?: { email?: unknown } }
      return isParamPlaceholder(payload.where?.email)
    },
    notContains: ['secret@private.com'],
  })
}

// Test 4: findMany with pagination - take/skip should be preserved
{
  console.log('Test 4: findMany with pagination')

  await prisma.user.findMany({
    take: 10,
    skip: 5,
  })

  verifyQueries('findMany with pagination', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as { take?: number; skip?: number }
      return payload.take === 10 && payload.skip === 5
    },
  })
}

// Test 5: findMany with orderBy - sort direction should be preserved
{
  console.log('Test 5: findMany with orderBy')

  await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
  })

  verifyQueries('findMany with orderBy', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as { orderBy?: { createdAt?: string } }
      return payload.orderBy?.createdAt === 'desc'
    },
  })
}

// Test 6: Create post with relation - nested data should be parameterized
{
  console.log('Test 6: Create with relation')

  await prisma.post.create({
    data: {
      title: 'Secret Title',
      content: 'Secret Content',
      authorId: createdUserId,
    },
  })

  verifyQueries('create post', flushQueries(), {
    expectedCount: 1,
    prefix: 'Post.createOne',
    containsInPayload: (p) => {
      const payload = p as { data?: { title?: unknown; content?: unknown } }
      const data = payload.data
      return data !== undefined && isParamPlaceholder(data.title) && isParamPlaceholder(data.content)
    },
    notContains: ['Secret Title', 'Secret Content'],
  })
}

// Test 7: findMany with include - relation selection should use include
// Note: include generates 2 SQL queries (one for User, one for Post), both with the same comment
{
  console.log('Test 7: findMany with include')

  await prisma.user.findMany({
    include: { posts: true },
  })

  verifyQueries('findMany with include', flushQueries(), {
    expectedCount: 2,
    queryIndex: 0,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as { include?: { posts?: unknown } }
      return payload.include?.posts === true
    },
  })
}

// Test 8: Complex where with AND/OR - all values should be parameterized
{
  console.log('Test 8: Complex where with AND/OR')

  await prisma.user.findMany({
    where: {
      AND: [{ email: { contains: '@private.com' } }, { OR: [{ name: 'Alice' }, { name: 'Bob' }] }],
    },
  })

  verifyQueries('complex where', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as {
        where?: { AND?: Array<{ email?: { contains?: unknown }; OR?: Array<{ name?: unknown }> }> }
      }
      const and = payload.where?.AND
      if (!and || !Array.isArray(and)) return false

      // Check email.contains is parameterized
      const emailCondition = and[0]?.email?.contains
      if (!isParamPlaceholder(emailCondition)) return false

      // Check OR conditions are parameterized
      const orConditions = and[1]?.OR
      if (!orConditions || !Array.isArray(orConditions)) return false

      return orConditions.every((cond) => isParamPlaceholder(cond.name))
    },
    notContains: ['@private.com', 'Alice', 'Bob'],
  })
}

// Test 9: findMany with select - verify select is in payload
{
  console.log('Test 9: findMany with select')

  await prisma.user.findMany({
    select: { id: true, email: true },
  })

  verifyQueries('findMany with select', flushQueries(), {
    expectedCount: 1,
    prefix: 'User.findMany',
    containsInPayload: (p) => {
      const payload = p as { select?: { id?: boolean; email?: boolean } }
      return payload.select?.id === true && payload.select?.email === true
    },
  })
}

await prisma.$disconnect()

console.log('\n✅ SQL commenter query insights e2e test passed!')
