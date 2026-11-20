import { Providers } from '../_utils/providers'
import { providersNotSupportingRelationJoins } from './_common'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  ({ provider }, _suiteMeta, _clientMeta, cliMeta) => {
    const relationJoinsEnabled = cliMeta.previewFeatures.includes('relationJoins')

    describeIf(relationJoinsEnabled)('relationLoadStrategy in unsupported positions', () => {
      test('nested subquery in findMany using include', async () => {
        await expect(
          prisma.user.findMany({
            include: {
              posts: {
                // @ts-expect-error
                relationLoadStrategy: 'query',
                include: {
                  comments: true,
                },
              },
            },
          }),
        ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findMany()\` invocation in
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

            XX describeIf(relationJoinsEnabled)('relationLoadStrategy in unsupported positions', () => {
            XX   test('nested subquery in findMany using include', async () => {
            XX     await expect(
          → XX       prisma.user.findMany({
                       include: {
                         posts: {
                           relationLoadStrategy: "query",
                           ~~~~~~~~~~~~~~~~~~~~
                           include: {
                             comments: true
                           },
                     ?     where?: PostWhereInput,
                     ?     orderBy?: PostOrderByWithRelationInput[] | PostOrderByWithRelationInput,
                     ?     cursor?: PostWhereUniqueInput,
                     ?     take?: Int,
                     ?     skip?: Int,
                     ?     distinct?: PostScalarFieldEnum | PostScalarFieldEnum[]
                         }
                       }
                     })

          Unknown argument \`relationLoadStrategy\`. Available options are marked with ?."
        `)
      })

      test('nested subquery in findMany using select', async () => {
        await expect(
          prisma.user.findMany({
            select: {
              posts: {
                // @ts-expect-error
                relationLoadStrategy: 'query',
                select: {
                  id: true,
                  comments: true,
                },
              },
            },
          }),
        ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.findMany()\` invocation in
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

            XX 
            XX test('nested subquery in findMany using select', async () => {
            XX   await expect(
          → XX     prisma.user.findMany({
                     select: {
                       posts: {
                         relationLoadStrategy: "query",
                         ~~~~~~~~~~~~~~~~~~~~
                         select: {
                           id: true,
                           comments: true
                         },
                   ?     where?: PostWhereInput,
                   ?     orderBy?: PostOrderByWithRelationInput[] | PostOrderByWithRelationInput,
                   ?     cursor?: PostWhereUniqueInput,
                   ?     take?: Int,
                   ?     skip?: Int,
                   ?     distinct?: PostScalarFieldEnum | PostScalarFieldEnum[]
                       }
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
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
            // @ts-test-if: provider === 'sqlite'
            relationLoadStrategy: 'query',
            data: [{ login: 'user' }],
          }),
        ).rejects.toMatchPrismaErrorInlineSnapshot(`
          "
          Invalid \`prisma.user.createMany()\` invocation in
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
          /client/tests/functional/relation-load-strategy/unsupported-queries.ts:0:0

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
  },
  {
    optOut: {
      from: providersNotSupportingRelationJoins,
      reason: "Doesn't support relation joins",
    },
  },
)
