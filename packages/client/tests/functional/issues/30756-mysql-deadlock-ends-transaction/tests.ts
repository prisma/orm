import { AdapterProviders, Providers } from '../../_utils/providers'
import testMatrix from './_matrix'

// @ts-ignore this is just for type checks
declare let prisma: import('./generated/prisma/client').PrismaClient

// https://github.com/prisma/orm/issues/30756
testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.item.deleteMany()
      await prisma.account.deleteMany()
      await prisma.account.createMany({
        data: [
          { id: 1, balance: 100 },
          { id: 2, balance: 100 },
        ],
      })
    })

    test('the deadlock victim rejects and none of its writes are committed', async () => {
      // Both transactions take their first lock before either asks for its second one,
      // so A (1 then 2) and B (2 then 1) always deadlock and InnoDB rolls back one of them.
      let arrived = 0
      let bothHoldFirstLock!: () => void
      const barrier = new Promise<void>((resolve) => (bothHoldFirstLock = resolve))
      const waitForTheOther = () => {
        arrived += 1
        if (arrived === 2) bothHoldFirstLock()
        return barrier
      }

      // The callback catches the deadlock and carries on, which is the case the issue is about.
      const run = (name: string, first: number, second: number) =>
        prisma.$transaction(
          async (tx) => {
            await tx.account.update({ where: { id: first }, data: { balance: { decrement: 10 } } })
            await tx.item.create({ data: { name: `${name}: before the deadlock` } })
            await waitForTheOther()
            try {
              await tx.account.update({ where: { id: second }, data: { balance: { decrement: 10 } } })
            } catch {
              await tx.item.create({ data: { name: `${name}: after catching the deadlock` } }).catch(() => {})
            }
          },
          { timeout: 15_000, maxWait: 5_000 },
        )

      const results = await Promise.allSettled([run('A', 1, 2), run('B', 2, 1)])

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toMatchObject({ code: 'P2034' })

      const winner = results[0].status === 'fulfilled' ? 'A' : 'B'
      const items = await prisma.item.findMany({ select: { name: true }, orderBy: { id: 'asc' } })
      expect(items).toEqual([{ name: `${winner}: before the deadlock` }])

      const accounts = await prisma.account.findMany({ orderBy: { id: 'asc' } })
      expect(accounts).toEqual([
        { id: 1, balance: 90 },
        { id: 2, balance: 90 },
      ])
    })
  },
  {
    optOut: {
      from: [Providers.POSTGRESQL, Providers.COCKROACHDB, Providers.SQLITE, Providers.SQLSERVER, Providers.MONGODB],
      reason: 'The issue is about InnoDB rolling back a deadlock victim, so it only applies to MySQL',
    },
    skipDriverAdapter: {
      from: [AdapterProviders.JS_PLANETSCALE],
      reason: 'The fix is in @prisma/adapter-mariadb',
    },
  },
)
