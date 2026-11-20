import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('should not crash when submitting a batch with relationLoadStrategy join', async () => {
      await expect(
        Promise.all([
          prisma.user.findUnique({ where: { id: '1' }, relationLoadStrategy: 'join' }),
          prisma.user.findUnique({ where: { id: '2' }, relationLoadStrategy: 'join' }),
        ]),
      ).resolves.toEqual([null, null])
    })
  },
  {
    skip: (skip, conf) => {
      skip(!conf.previewFeatures?.includes('relationJoins'), 'this test is only for relation joins')
    },
    optOut: {
      from: ['mongodb', 'sqlite', 'sqlserver'],
      reason: 'this test is only for relationJoins capable databases',
    },
  },
)
