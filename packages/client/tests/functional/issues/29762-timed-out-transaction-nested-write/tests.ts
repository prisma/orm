import { NewPrismaClient } from '../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

const TRANSACTION_TIMEOUT = 1_000
const LOCK_HOLD_TIME = 3_000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.post.deleteMany()
      await prisma.user.deleteMany()
    })

    // A nested write runs as several statements. When the transaction times out while one of
    // them is blocked, the statements after it must not run outside the transaction.
    test('a nested write that outlives the transaction timeout commits nothing', async () => {
      const user = await prisma.user.create({ data: {} })

      // FOR NO KEY UPDATE blocks the UPDATE of the user, but not the foreign key checks of the
      // post inserts, so the nested write is still running when the timeout fires.
      const lockHolder = newPrismaClient()
      let markLocked!: () => void
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve
      })
      const lock = lockHolder.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${user.id} FOR NO KEY UPDATE`
          markLocked()
          await delay(LOCK_HOLD_TIME)
        },
        { timeout: LOCK_HOLD_TIME * 2 },
      )
      await locked

      // A batch of one operation does not open a batch transaction, so it needs a second one.
      const write = prisma.$transaction(
        [
          prisma.user.create({ data: { name: 'created' } }),
          prisma.user.update({
            where: { id: user.id },
            data: {
              name: 'updated',
              posts: { createMany: { data: [{ title: 'first' }, { title: 'second' }] } },
            },
          }),
        ],
        { timeout: TRANSACTION_TIMEOUT },
      )

      await expect(write).rejects.toMatchObject({ code: 'P2028' })
      await lock
      await lockHolder.$disconnect()

      expect(await prisma.post.count()).toBe(0)
      expect(await prisma.user.findMany()).toEqual([{ id: user.id, name: null }])
    }, 30_000)
  },
  {
    optOut: {
      from: ['cockroachdb', 'mongodb', 'mysql', 'sqlite', 'sqlserver'],
      reason: 'Uses a Postgres row lock to hold the nested write past the timeout',
    },
  },
)
