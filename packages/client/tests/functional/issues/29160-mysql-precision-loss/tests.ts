import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  () => {
    test('preserves precision for large decimal values', async () => {
      await prisma.assetAccount.create({
        data: {
          assetId: '1',
          amount: new Prisma.Decimal('0'),
        },
      })

      await expect(
        prisma.assetAccount.update({
          where: { assetId: '1' },
          data: { amount: { increment: new Prisma.Decimal('5000000000000000000000000000') } },
        }),
      ).resolves.toMatchObject({
        assetId: '1',
        amount: new Prisma.Decimal('5000000000000000000000000000'),
      })

      // First withdrawal
      await expect(
        prisma.assetAccount.update({
          where: { assetId: '1' },
          data: { amount: { decrement: new Prisma.Decimal('1000000000000000000000') } },
        }),
      ).resolves.toMatchObject({
        assetId: '1',
        amount: new Prisma.Decimal('4999999000000000000000000000'),
      })

      await expect(
        prisma.assetAccount.update({
          where: { assetId: '1' },
          data: { amount: { decrement: new Prisma.Decimal('1000000000000000000000') } },
        }),
      ).resolves.toMatchObject({
        assetId: '1',
        amount: new Prisma.Decimal('4999998000000000000000000000'),
      })
    })
  },
  {
    optOut: {
      from: ['sqlserver', 'cockroachdb', 'mongodb', 'postgresql', 'sqlite'],
      reason:
        'This test is specific to MySQL/MariaDB and the precision loss issue with large decimal values. It does not apply to other databases that do not have this issue.',
    },
    skipDriverAdapter: {
      from: ['js_planetscale'],
      reason: 'This issue currently cannot be addressed in Planetscale due to limitations of their API',
    },
  },
)
