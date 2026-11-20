import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

import { Prisma, PrismaClient } from './generated/prisma/client.js'

// Plugin 1: Adds application info
const appPlugin: SqlCommenterPlugin = () => ({
  application: 'sqlcommenter-e2e-test',
  version: '1.0.0',
})

// Plugin 2: Adds query context (has overlap with plugin 3 on 'source' key)
const contextPlugin: SqlCommenterPlugin = (ctx) => ({
  queryType: ctx.query.type,
  source: 'context-plugin',
  model: ctx.query.modelName ?? 'raw',
  action: ctx.query.action,
})

// Plugin 3: Adds tracing info (overwrites 'source' from plugin 2 to test override behavior)
const tracingPlugin: SqlCommenterPlugin = () => ({
  source: 'tracing-plugin',
  traceId: 'test-trace-123',
})

// Plugin 4: Adds original SQL length (tests that SQL is available when not using Accelerate)
const sqlLengthPlugin: SqlCommenterPlugin = (ctx) => ({
  sqlLen: ctx.sql ? String(ctx.sql.length) : undefined,
})

const adapter = new PrismaBetterSqlite3({
  url: './dev.db',
})

const capturedQueries: string[] = []

const prisma = new PrismaClient({
  adapter,
  comments: [appPlugin, contextPlugin, tracingPlugin, sqlLengthPlugin],
  log: [{ emit: 'event', level: 'query' }],
})

prisma.$on('query', (event: Prisma.QueryEvent) => {
  capturedQueries.push(event.query)
})

// Run various queries
await prisma.user.findMany()
await prisma.user.create({
  data: { email: 'test@example.com', name: 'Test User' },
})
await prisma.user.findFirst({ where: { email: 'test@example.com' } })

await prisma.$disconnect()

// Expected queries with sqlcommenter comments
// Later plugins override earlier ones for the same key ('source' should be 'tracing-plugin')
const expectedQueries = [
  // findMany
  "SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE 1=1 LIMIT ? OFFSET ? /*action='findMany',application='sqlcommenter-e2e-test',model='User',queryType='single',source='tracing-plugin',sqlLen='116',traceId='test-trace-123',version='1.0.0'*/",
  // create - INSERT
  "INSERT INTO `main`.`User` (`email`, `name`) VALUES (?,?) RETURNING `id` AS `id`, `email` AS `email`, `name` AS `name` /*action='createOne',application='sqlcommenter-e2e-test',model='User',queryType='single',source='tracing-plugin',sqlLen='117',traceId='test-trace-123',version='1.0.0'*/",
  // findFirst
  "SELECT `main`.`User`.`id`, `main`.`User`.`email`, `main`.`User`.`name` FROM `main`.`User` WHERE `main`.`User`.`email` = ? LIMIT ? OFFSET ? /*action='findFirst',application='sqlcommenter-e2e-test',model='User',queryType='single',source='tracing-plugin',sqlLen='138',traceId='test-trace-123',version='1.0.0'*/",
]

assert.deepEqual(
  capturedQueries,
  expectedQueries,
  `Captured queries do not match expected.\n\nCaptured:\n${JSON.stringify(capturedQueries, null, 2)}\n\nExpected:\n${JSON.stringify(expectedQueries, null, 2)}`,
)

console.log('✅ SQL commenter e2e test passed!')
