import { faker } from '@snaplet/copycat'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

function daysBefore(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

testMatrix.setupTestSuite(() => {
  const contactId1 = faker.database.mongodbObjectId()
  const contactId2 = faker.database.mongodbObjectId()
  const contactId3 = faker.database.mongodbObjectId()

  afterEach(async () => {
    await prisma.contactAnalytics.deleteMany()
    await prisma.contact.deleteMany()
  })

  beforeEach(async () => {
    await prisma.contact.createMany({
      data: [{ id: contactId1 }, { id: contactId2 }, { id: contactId3 }],
    })
    await prisma.contactAnalytics.createMany({
      data: [
        {
          contactId: contactId1,
          date1: daysBefore(180),
          date2: daysBefore(30),
          val1: 50,
          bool1: true,
        },
        {
          contactId: contactId2,
          date3: daysBefore(14),
          date4: daysBefore(7),
          val2: 100,
        },
        {
          contactId: contactId3,
          date5: daysBefore(3),
          val3: 10,
        },
      ],
    })
  })

  const fullStress = process.env.PRISMA_CREATE_MANY_STRESS === 'true'
  const iterations = fullStress ? 200 : 5
  const batchSize = fullStress ? 10000 : 20
  const timeout = fullStress ? 5 * 60 * 1000 : 10 * 1000

  test(
    'createMany stress test for cache bloat',
    async () => {
      console.log(`Running createMany stress test with ${iterations} iterations and batch size of ${batchSize}`)
      for (let i = 0; i < iterations; i++) {
        const rows = Array.from({ length: batchSize }, (_, j) => {
          return {
            contactId: i % 2 === 0 ? contactId1 : j % 2 === 0 ? contactId2 : contactId3,
            // Vary which DateTime fields are set to create different parameter patterns
            date1: j % 3 === 0 ? daysBefore(Math.floor(Math.random() * 180)) : undefined,
            date2: j % 5 === 0 ? daysBefore(Math.floor(Math.random() * 30)) : undefined,
            date3: j % 7 === 0 ? daysBefore(Math.floor(Math.random() * 14)) : undefined,
            date4: j % 4 === 0 ? daysBefore(Math.floor(Math.random() * 7)) : undefined,
            date5: j % 6 === 0 ? daysBefore(Math.floor(Math.random() * 10)) : undefined,
            date6: j % 8 === 0 ? daysBefore(Math.floor(Math.random() * 5)) : undefined,
            date7: j % 2 === 0 ? daysBefore(Math.floor(Math.random() * 3)) : undefined,
            val1: j % 2 === 0 ? Math.floor(Math.random() * 100) : undefined,
            val2: j % 3 === 0 ? Math.floor(Math.random() * 100) : undefined,
            val3: j % 4 === 0 ? Math.floor(Math.random() * 100) : undefined,
            val4: j % 5 === 0 ? Math.floor(Math.random() * 100) : undefined,
            val5: j % 6 === 0 ? Math.floor(Math.random() * 100) : undefined,
            float1: j % 4 === 0 ? Math.random() * 100 : undefined,
            float2: j % 5 === 0 ? Math.random() * 100 : undefined,
            bool1: j % 9 === 0 ? Math.random() > 0.8 : undefined,
            bool2: j % 10 === 0 ? Math.random() > 0.2 : undefined,
            bool3: j % 7 === 0 ? Math.random() > 0.5 : undefined,
          }
        })

        const result = await prisma.contactAnalytics.createMany({ data: rows })
        expect(result.count).toBe(batchSize)
      }

      const count = await prisma.contactAnalytics.count()
      expect(count).toBe(iterations * batchSize + 3)
    },
    timeout,
  ) // Increase timeout for stress test
})
