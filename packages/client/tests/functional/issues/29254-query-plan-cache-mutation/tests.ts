import { faker } from '@snaplet/copycat'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(() => {
  const id1 = faker.database.mongodbObjectId()
  const id2 = faker.database.mongodbObjectId()
  const id3 = faker.database.mongodbObjectId()

  afterEach(async () => {
    await prisma.item.deleteMany()
  })

  beforeEach(async () => {
    await prisma.item.createMany({
      data: [
        { id: id1, price: 10 },
        { id: id2, price: 20 },
        { id: id3, price: 30 },
      ],
    })
  })

  test('correctly handles two subsequent queries with a different cursor', async () => {
    const ORDER_BY_NULLABLE = [{ price: 'asc' as const }, { id: 'asc' as const }]

    const result1 = await prisma.item.findMany({
      orderBy: ORDER_BY_NULLABLE,
      cursor: { id: id1 },
      skip: 1,
      take: 1,
    })
    expect(result1).toEqual([{ id: id2, price: 20 }])

    const result2 = await prisma.item.findMany({
      orderBy: ORDER_BY_NULLABLE,
      cursor: { id: id2 },
      skip: 1,
      take: 1,
    })
    expect(result2).toEqual([{ id: id3, price: 30 }])
  })
})
