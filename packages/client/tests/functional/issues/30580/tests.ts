import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.appSetting.deleteMany()
    })

    test('commit-time write conflicts are surfaced as P2034', async () => {
      const prefix = 'probe-'
      let reads = 0
      let releaseReads!: () => void
      const readsCompleted = new Promise<void>((resolve) => {
        releaseReads = resolve
      })
      let completedInserts = 0
      let successfulInserts = 0
      let releaseInserts!: () => void
      const insertsCompleted = new Promise<void>((resolve) => {
        releaseInserts = resolve
      })

      const run = (suffix: number) =>
        prisma.$transaction(
          async (tx) => {
            await tx.appSetting.count({ where: { key: { startsWith: prefix } } })

            reads += 1
            if (reads === 2) releaseReads()
            await readsCompleted

            try {
              await tx.appSetting.create({
                data: { key: `${prefix}${suffix}`, value: 'x' },
              })
              successfulInserts += 1
            } finally {
              // Always release the post-insert barrier once both attempts have
              // completed, even if one insert fails before COMMIT.
              completedInserts += 1
              if (completedInserts === 2) releaseInserts()
            }

            await insertsCompleted
          },
          { isolationLevel: 'Serializable' },
        )

      const results = await Promise.allSettled([run(1), run(2)])
      const rejected = results.filter((r) => r.status === 'rejected')
      const fulfilled = results.filter((r) => r.status === 'fulfilled')

      expect(successfulInserts).toBe(2)
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]).toMatchObject({
        reason: {
          name: 'PrismaClientKnownRequestError',
          code: 'P2034',
        },
      })

      await expect(prisma.appSetting.count()).resolves.toBe(1)
    })
  },
  {
    optOut: {
      from: ['mongodb', 'mysql', 'sqlite', 'sqlserver', 'cockroachdb'],
      reason: 'Serializable write skew surfaced as SQLSTATE 40001 at COMMIT is the PostgreSQL behavior from the issue',
    },
  },
)
