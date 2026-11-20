import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('should not duplicate rows for a nested "some ... in" query', async () => {
      await prisma.organization.create({
        data: {
          types: {
            createMany: {
              data: [{ type: 1 }, { type: 10 }],
            },
          },
        },
      })

      expect(
        await prisma.organization.count({
          where: {
            types: {
              some: {
                type: {
                  in: [1, 10],
                },
              },
            },
          },
        }),
      ).toBe(1)
    })
  },
  {
    optOut: {
      from: ['mongodb', 'sqlserver', 'postgresql', 'mysql', 'cockroachdb'],
      reason: 'this test is for a SQLite implementation bug',
    },
  },
)
