import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { queryTags, withMergedQueryTags, withQueryTags } from '@prisma/sqlcommenter-query-tags'

import { PrismaClient } from './generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({
  url: './dev.db',
})

const capturedQueries: string[] = []

const prisma = new PrismaClient({
  adapter,
  comments: [queryTags()],
  log: [{ emit: 'event', level: 'query' }],
})

prisma.$on('query', (event) => {
  capturedQueries.push(event.query)
})

// Test 1: Query without withQueryTags - should have no tags
await prisma.user.findMany()

// Test 2: Query with withQueryTags - should have dynamic tags
await withQueryTags({ route: '/api/users', requestId: 'req-123' }, async () => {
  await prisma.user.create({
    data: { email: 'test@example.com', name: 'Test User' },
  })
})

// Test 3: Query after withQueryTags scope - should have no tags again
await prisma.user.findFirst({ where: { email: 'test@example.com' } })

// Test 4: Nested withQueryTags - inner tags should completely replace outer tags
await withQueryTags({ outer: 'value', shared: 'outer' }, async () => {
  await prisma.user.findMany({ where: { name: 'Test User' } })

  await withQueryTags({ inner: 'value', shared: 'inner' }, async () => {
    await prisma.user.count()
  })
})

// Test 5: withMergedQueryTags - should merge with outer context
await withQueryTags({ requestId: 'req-456', source: 'api' }, async () => {
  // First query with outer tags only
  await prisma.user.findMany()

  // Inner query with merged tags (userId added, source overridden)
  await withMergedQueryTags({ userId: 'user-789', source: 'handler' }, async () => {
    await prisma.user.findFirst()
  })

  // After inner scope, should be back to outer tags only
  await prisma.user.count()
})

await prisma.$disconnect()

const expectedQueries = [
  // Test 1: No tags
  'SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ?',

  // Test 2: Dynamic tags from withQueryTags
  "INSERT INTO `main`.`User` (`email`, `name`) VALUES (?,?) RETURNING `id` AS `id`, `email` AS `email`, `name` AS `name` /*requestId='req-123',route='%2Fapi%2Fusers'*/",

  // Test 3: Back to no tags after scope ends
  'SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE `main`.`User`.`email` = ? LIMIT ? OFFSET ?',

  // Test 4a: Outer withQueryTags scope
  "SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE `main`.`User`.`name` = ? LIMIT ? OFFSET ? /*outer='value',shared='outer'*/",

  // Test 4b: Inner withQueryTags scope (replaces outer tags entirely)
  "SELECT COUNT(*) AS `_count$_all` FROM (SELECT `main`.`User`.`id` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ?) AS `sub` /*inner='value',shared='inner'*/",

  // Test 5a: Outer withQueryTags scope
  "SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ? /*requestId='req-456',source='api'*/",

  // Test 5b: withMergedQueryTags - merged tags (requestId preserved, source overridden, userId added)
  "SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ? /*requestId='req-456',source='handler',userId='user-789'*/",

  // Test 5c: Back to outer tags after withMergedQueryTags scope ends
  "SELECT COUNT(*) AS `_count$_all` FROM (SELECT `main`.`User`.`id` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ?) AS `sub` /*requestId='req-456',source='api'*/",
]

assert.deepEqual(
  capturedQueries,
  expectedQueries,
  `Captured queries do not match expected.\n\nCaptured:\n${JSON.stringify(capturedQueries, null, 2)}\n\nExpected:\n${JSON.stringify(expectedQueries, null, 2)}`,
)

console.log('✅ SQL commenter query tags e2e test passed!')
