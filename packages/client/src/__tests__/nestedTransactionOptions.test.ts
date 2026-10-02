import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

import { getTestClient } from '../utils/getTestClient'

test('a nested $transaction does not write into the options object of the caller', async () => {
  const PrismaClient = await getTestClient(path.join(__dirname, 'nested-transaction-options'))
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: ':memory:' }) })
  const options = { maxWait: 5_000, timeout: 5_000 }

  await prisma.$transaction(async (tx: any) => {
    await tx.$transaction(async () => {}, options)
  })

  expect(options).toEqual({ maxWait: 5_000, timeout: 5_000 })

  // A top-level transaction that reuses the options must not join the committed outer one
  await expect(prisma.$transaction(() => Promise.resolve('done'), options)).resolves.toBe('done')

  await prisma.$disconnect()
})
