import testMatrix from './_matrix'
// @ts-ignore
import type { Event, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('retrieves a cursor against a DATE column', async () => {
      const rows: Event[] = []
      for (let day = 1; day <= 10; day++) {
        rows.push({
          appId: 1,
          createdAt: new Date(`2025-01-${String(day).padStart(2, '0')}Z`),
          value: day * 100,
        })
      }
      await prisma.event.createMany({ data: rows })

      const firstThree = await prisma.event.findMany({
        where: { appId: 1 },
        orderBy: { createdAt: 'asc' },
        take: 3,
      })
      const cursorRow = firstThree[2] // 2025-01-03

      const withCursor = await prisma.event.findMany({
        where: { appId: 1 },
        cursor: {
          appId_createdAt: {
            appId: cursorRow.appId,
            createdAt: cursorRow.createdAt,
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 3,
        skip: 1,
      })

      expect(withCursor).toEqual([
        {
          appId: 1,
          createdAt: new Date('2025-01-04T00:00:00.000Z'),
          value: 400,
        },
        {
          appId: 1,
          createdAt: new Date('2025-01-05T00:00:00.000Z'),
          value: 500,
        },
        {
          appId: 1,
          createdAt: new Date('2025-01-06T00:00:00.000Z'),
          value: 600,
        },
      ])
    })
  },
  {
    optOut: {
      from: ['mongodb', 'sqlite'],
      reason: 'MongoDB and SQLite do not support DATE columns',
    },
  },
)
