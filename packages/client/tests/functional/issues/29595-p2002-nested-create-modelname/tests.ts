import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

/**
 * Regression test for https://github.com/prisma/prisma/issues/29595
 * P2002 error should report the nested model where the violation occurred, not the top-level model.
 * AppMajorVersion is mapped via @@map to a differently-named table, so this also covers the case
 * where the Prisma model name and the underlying database table name differ.
 */
testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.appVersion.deleteMany()
      await prisma.appMajorVersion.deleteMany()

      await prisma.appVersion.create({
        data: {
          number: 1,
          majorVersion: {
            create: {
              appId: 'my-app',
              number: 1,
            },
          },
        },
      })
    })

    test('P2002 modelName reflects the nested model where the violation occurred', async () => {
      const error = await prisma.appVersion
        .create({
          data: {
            number: 2,
            majorVersion: {
              create: {
                appId: 'my-app',
                number: 1,
              },
            },
          },
        })
        .catch((e) => e)

      expect(error.name).toBe('PrismaClientKnownRequestError')
      expect(error.code).toBe('P2002')
      expect(error.meta.modelName).toBe('AppMajorVersion')
    })
  },
  {
    optOut: {
      from: ['mongodb'],
      reason: 'MongoDB does not use relational unique constraints',
    },
  },
)
