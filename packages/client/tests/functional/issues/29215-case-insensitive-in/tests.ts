import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    afterEach(async () => {
      await prisma.attachment.deleteMany()
    })

    test('correctly handles a case insensitive IN filter', async () => {
      await prisma.attachment.createMany({
        data: [{ fileName: 'abc.jpg' }, { fileName: 'DEF.txt' }, { fileName: 'ghi.png' }],
      })

      const results = await prisma.attachment.findMany({
        where: {
          fileName: {
            in: ['AbC.jpg', 'DEF.txt'],
            mode: 'insensitive',
          },
        },
        select: {
          id: true,
          fileName: true,
        },
      })

      expect(results).toHaveLength(2)
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileName: 'abc.jpg' }),
          expect.objectContaining({ fileName: 'DEF.txt' }),
        ]),
      )
    })

    test('correctly handles a case insensitive NOT IN filter', async () => {
      await prisma.attachment.createMany({
        data: [{ fileName: 'bcd.jpg' }, { fileName: 'efg.txt' }, { fileName: 'hij.png' }],
      })
      const results = await prisma.attachment.findMany({
        where: {
          fileName: {
            notIn: ['BcD.jpg', 'efg.txt'],
            mode: 'insensitive',
          },
        },
        select: {
          id: true,
          fileName: true,
        },
      })

      expect(results).toEqual([
        expect.objectContaining({
          fileName: 'hij.png',
        }),
      ])
    })
  },
  {
    optOut: {
      from: ['mysql', 'sqlite', 'sqlserver'],
      reason: 'Case-insensitive filters are not supported in MySQL, SQLite, and SQL Server',
    },
  },
)
