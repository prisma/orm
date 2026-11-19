import { NewPrismaClient } from '../../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

testMatrix.setupTestSuite(
  ({ relationMode }) => {
    let prisma: PrismaClient
    const queries: string[] = []

    beforeAll(() => {
      prisma = newPrismaClient({ log: [{ emit: 'event', level: 'query' }] })
      // @ts-expect-error: the generated test client does not expose query event types
      prisma.$on('query', (event: { query: string }) => queries.push(event.query))
    })

    beforeEach(async () => {
      await prisma.child.deleteMany()
      await prisma.relatedCounter.deleteMany()
      await prisma.counter.deleteMany()
      await prisma.compoundCounter.deleteMany()
      await prisma.multipleKeys.deleteMany()
      await prisma.prefixKey.deleteMany()
      queries.length = 0
    })

    afterAll(() => prisma.$disconnect())

    test('concurrent first clicks all increment the same counter and return their own result', async () => {
      const counters = await Promise.all(
        Array.from({ length: 10 }, () =>
          prisma.counter.upsert({
            where: { id: 'counter' },
            create: { id: 'counter', clicks: 1 },
            update: { clicks: { increment: 1 } },
            select: { id: true, clicks: true },
          }),
        ),
      )

      expect(counters.sort((a, b) => a.clicks - b.clicks)).toEqual(
        Array.from({ length: 10 }, (_, i) => ({ id: 'counter', clicks: i + 1 })),
      )
      expect(queries.filter((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toHaveLength(10)
      expect(await prisma.counter.findUnique({ where: { id: 'counter' }, select: { id: true, clicks: true } })).toEqual(
        {
          id: 'counter',
          clicks: 10,
        },
      )
    })

    test('an existing counter preserves createdAt and advances updatedAt', async () => {
      const past = new Date('2020-01-01T00:00:00Z')
      await prisma.counter.create({ data: { id: 'counter', clicks: 1, createdAt: past, updatedAt: past } })

      const result = await prisma.counter.upsert({
        where: { id: 'counter' },
        create: { id: 'counter', clicks: 1 },
        update: { clicks: { increment: 1 } },
      })

      expect(result).toEqual({ id: 'counter', clicks: 2, createdAt: past, updatedAt: expect.any(Date) })
      expect(result.updatedAt.getTime()).toBeGreaterThan(past.getTime())
      expect(queries.some((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toBe(true)
    })

    test('a compound primary key identifies the row for the read after the atomic write', async () => {
      for (let clicks = 1; clicks <= 2; clicks++) {
        expect(
          await prisma.compoundCounter.upsert({
            where: { scope_name: { scope: 'scope', name: 'counter' } },
            create: { scope: 'scope', name: 'counter', clicks: 1 },
            update: { clicks: { increment: 1 } },
          }),
        ).toEqual({ scope: 'scope', name: 'counter', clicks })
      }
      expect(queries.filter((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toHaveLength(2)
    })

    test('models with relations use native upsert only with database foreign keys', async () => {
      for (let clicks = 1; clicks <= 2; clicks++) {
        expect(
          await prisma.relatedCounter.upsert({
            where: { id: 'counter' },
            create: { id: 'counter', clicks: 1 },
            update: { clicks: { increment: 1 } },
          }),
        ).toEqual({ id: 'counter', clicks })
      }

      expect(queries.filter((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toHaveLength(
        relationMode === 'foreignKeys' ? 2 : 0,
      )
    })

    test('a collision on a different unique key still fails instead of updating the wrong row', async () => {
      await prisma.multipleKeys.create({ data: { id: 1, name: 'existing', clicks: 1 } })

      await expect(
        prisma.multipleKeys.upsert({
          where: { id: 2 },
          create: { id: 2, name: 'existing', clicks: 1 },
          update: { clicks: { increment: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
      expect(await prisma.multipleKeys.findMany()).toEqual([{ id: 1, name: 'existing', clicks: 1 }])
      expect(queries.some((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toBe(false)
    })

    test('changing the lookup key returns the renamed record through the existing path', async () => {
      await prisma.counter.create({ data: { id: 'counter', clicks: 1 } })

      expect(
        await prisma.counter.upsert({
          where: { id: 'counter' },
          create: { id: 'counter', clicks: 1 },
          update: { id: 'renamed', clicks: { increment: 1 } },
          select: { id: true, clicks: true },
        }),
      ).toEqual({ id: 'renamed', clicks: 2 })
      expect(queries.some((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toBe(false)
    })

    test('a prefix key collision still fails instead of updating a different full key', async () => {
      await prisma.prefixKey.create({ data: { id: 'counter-one', clicks: 1 } })

      await expect(
        prisma.prefixKey.upsert({
          where: { id: 'counter-two' },
          create: { id: 'counter-two', clicks: 1 },
          update: { clicks: { increment: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
      expect(await prisma.prefixKey.findMany()).toEqual([{ id: 'counter-one', clicks: 1 }])
      expect(queries.some((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toBe(false)
    })

    test('an additional predicate is not dropped from the update decision', async () => {
      await prisma.counter.create({ data: { id: 'counter', clicks: 5 } })

      await expect(
        prisma.counter.upsert({
          where: { id: 'counter', clicks: 1 },
          create: { id: 'counter', clicks: 1 },
          update: { clicks: { increment: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
      expect(await prisma.counter.findUnique({ where: { id: 'counter' }, select: { id: true, clicks: true } })).toEqual(
        {
          id: 'counter',
          clicks: 5,
        },
      )
      expect(queries.some((query) => query.includes('ON DUPLICATE KEY UPDATE'))).toBe(false)
    })
  },
  {
    optOut: {
      from: ['sqlite', 'postgresql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: 'MySQL uses ON DUPLICATE KEY UPDATE and reads the resulting row without RETURNING',
    },
    skipDefaultClientInstance: true,
  },
)
