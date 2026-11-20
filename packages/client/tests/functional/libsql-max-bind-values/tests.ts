import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

const CLIPS = 1000

testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      await prisma.clip.createMany({ data: Array.from({ length: CLIPS }, (_, i) => ({ id: i + 1 })) })
      await prisma.marker.createMany({
        data: Array.from({ length: CLIPS }, (_, i) => ({ id: i + 1, clipId: i + 1, beat: CLIPS - i })),
      })
    })

    test('include with a nested orderBy over more than 999 parents succeeds', async () => {
      const clips = await prisma.clip.findMany({ include: { markers: { orderBy: { beat: 'asc' } } } })

      expect(clips).toHaveLength(CLIPS)
      expect(clips.every((clip) => clip.markers.length === 1)).toBe(true)
    })
  },
  {
    optOut: {
      from: ['postgresql', 'mysql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: 'Covers the SQLite bind parameter limit reported by the driver adapter.',
    },
    skipDriverAdapter: {
      from: ['js_d1'],
      reason: 'D1 caps bind parameters at 100, below what this query needs in a single statement.',
    },
  },
)
