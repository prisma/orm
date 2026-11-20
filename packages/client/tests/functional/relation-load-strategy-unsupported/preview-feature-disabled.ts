import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(({ provider }, _suiteMeta, _clientMeta, cliMeta) => {
  const relationJoinsDisabled = !cliMeta.previewFeatures.includes('relationJoins')

  describeIf(relationJoinsDisabled)('relationLoadStrategy with no relationJoins preview feature', () => {
    test('findMany', async () => {
      await expect(
        prisma.user.findMany({
          // @ts-expect-error
          relationLoadStrategy: 'query',
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findMany()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX describeIf(relationJoinsDisabled)('relationLoadStrategy with no relationJoins preview feature', () => {
            XX   test('findMany', async () => {
            XX     await expect(
          → XX       prisma.user.findMany({
                       relationLoadStrategy: "query",
                       ~~~~~~~~~~~~~~~~~~~~
                     ? where?: UserWhereInput,
                     ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                     ? cursor?: UserWhereUniqueInput,
                     ? take?: Int,
                     ? skip?: Int,
                     ? distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
                     })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('findFirst', async () => {
      await expect(
        prisma.user.findFirst({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findFirst()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('findFirst', async () => {
            XX   await expect(
          → XX     prisma.user.findFirst({
                     relationLoadStrategy: "query",
                     ~~~~~~~~~~~~~~~~~~~~
                     where: {
                       login: "user"
                     },
                   ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                   ? cursor?: UserWhereUniqueInput,
                   ? take?: Int,
                   ? skip?: Int,
                   ? distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
                   })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('findFirstOrThrow', async () => {
      await expect(
        prisma.user.findFirstOrThrow({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findFirstOrThrow()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('findFirstOrThrow', async () => {
            XX   await expect(
          → XX     prisma.user.findFirstOrThrow({
                     relationLoadStrategy: "query",
                     ~~~~~~~~~~~~~~~~~~~~
                     where: {
                       login: "user"
                     },
                   ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                   ? cursor?: UserWhereUniqueInput,
                   ? take?: Int,
                   ? skip?: Int,
                   ? distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
                   })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('findUnique', async () => {
      await expect(
        prisma.user.findUnique({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findUnique()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('findUnique', async () => {
            XX   await expect(
          → XX     prisma.user.findUnique({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      where: {
                        login: "user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('findUniqueOrThrow', async () => {
      await expect(
        prisma.user.findUniqueOrThrow({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findUniqueOrThrow()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('findUniqueOrThrow', async () => {
            XX   await expect(
          → XX     prisma.user.findUniqueOrThrow({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      where: {
                        login: "user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('create', async () => {
      await expect(
        prisma.user.create({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          data: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.create()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('create', async () => {
            XX   await expect(
          → XX     prisma.user.create({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      data: {
                        login: "user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('update', async () => {
      await expect(
        prisma.user.update({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
          data: {
            login: 'new-user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.update()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('update', async () => {
            XX   await expect(
          → XX     prisma.user.update({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      where: {
                        login: "user"
                      },
                      data: {
                        login: "new-user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('delete', async () => {
      await expect(
        prisma.user.delete({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.delete()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('delete', async () => {
            XX   await expect(
          → XX     prisma.user.delete({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      where: {
                        login: "user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('upsert', async () => {
      await expect(
        prisma.user.upsert({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          where: {
            login: 'user',
          },
          create: {
            login: 'user',
          },
          update: {
            login: 'new-user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.upsert()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('upsert', async () => {
            XX   await expect(
          → XX     prisma.user.upsert({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      where: {
                        login: "user"
                      },
                      create: {
                        login: "user"
                      },
                      update: {
                        login: "new-user"
                      }
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('aggregate', async () => {
      await expect(
        prisma.user.aggregate({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          _count: {
            _all: true,
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.aggregate()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('aggregate', async () => {
            XX   await expect(
          → XX     prisma.user.aggregate({
                      select: {
                        _count: {
                          select: {
                            _all: true
                          }
                        }
                      },
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                    ? where?: UserWhereInput,
                    ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                    ? cursor?: UserWhereUniqueInput,
                    ? take?: Int,
                    ? skip?: Int
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('groupBy', async () => {
      await expect(
        prisma.user.groupBy({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          by: 'id',
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.groupBy()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('groupBy', async () => {
            XX   await expect(
          → XX     prisma.user.groupBy({
                      select: {
                        id: true
                      },
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      by: "id",
                    ? where?: UserWhereInput,
                    ? orderBy?: UserOrderByWithAggregationInput[] | UserOrderByWithAggregationInput,
                    ? having?: UserScalarWhereWithAggregatesInput,
                    ? take?: Int,
                    ? skip?: Int
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    testIf(![Providers.SQLITE, Providers.SQLSERVER, Providers.MONGODB].includes(provider))('createMany', async () => {
      await expect(
        prisma.user.createMany({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          data: [{ login: 'user' }],
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.createMany()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX testIf(![Providers.SQLITE, Providers.SQLSERVER, Providers.MONGODB].includes(provider))('createMany', async () => {
            XX   await expect(
          → XX     prisma.user.createMany({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      data: [
                        {
                          login: "user"
                        }
                      ],
                    ? skipDuplicates?: Boolean
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    testIf([Providers.SQLSERVER, Providers.MONGODB].includes(provider))('createMany (sqlserver, mongodb)', async () => {
      await expect(
        prisma.user.createMany({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          data: [{ login: 'user' }],
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
            "
            Invalid \`prisma.user.createMany()\` invocation in
            /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

              XX 
              XX testIf([Providers.SQLSERVER, Providers.MONGODB].includes(provider))('createMany (sqlserver, mongodb)', async () => {
              XX   await expect(
            → XX     prisma.user.createMany({
                        relationLoadStrategy: "query",
                        ~~~~~~~~~~~~~~~~~~~~
                        data: [
                          {
                            login: "user"
                          }
                        ]
                      })

            Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
          `)
    })

    test('updateMany', async () => {
      await expect(
        prisma.user.updateMany({
          // @ts-expect-error
          relationLoadStrategy: 'query',
          data: {
            login: 'user',
          },
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.updateMany()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('updateMany', async () => {
            XX   await expect(
          → XX     prisma.user.updateMany({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                      data: {
                        login: "user"
                      },
                    ? where?: UserWhereInput,
                    ? limit?: Int
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('deleteMany', async () => {
      await expect(
        prisma.user.deleteMany({
          // @ts-expect-error
          relationLoadStrategy: 'query',
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.deleteMany()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('deleteMany', async () => {
            XX   await expect(
          → XX     prisma.user.deleteMany({
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                    ? where?: UserWhereInput,
                    ? limit?: Int
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })

    test('count', async () => {
      await expect(
        prisma.user.count({
          // @ts-expect-error
          relationLoadStrategy: 'query',
        }),
      ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.count()\` invocation in
          /client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts:0:0

            XX 
            XX test('count', async () => {
            XX   await expect(
          → XX     prisma.user.count({
                      select: {
                        _count: {
                          select: {
                            _all: true
                          }
                        }
                      },
                      relationLoadStrategy: "query",
                      ~~~~~~~~~~~~~~~~~~~~
                    ? where?: UserWhereInput,
                    ? orderBy?: UserOrderByWithRelationInput[] | UserOrderByWithRelationInput,
                    ? cursor?: UserWhereUniqueInput,
                    ? take?: Int,
                    ? skip?: Int
                    })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
    })
  })
})
