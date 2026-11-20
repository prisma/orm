import { faker } from '@faker-js/faker'
import { match } from 'ts-pattern'

import { Providers } from '../_utils/providers'
import { waitFor } from '../_utils/tests/waitFor'
import { NewPrismaClient } from '../_utils/types'
import { providersNotSupportingRelationJoins, providersSupportingRelationJoins, RelationLoadStrategy } from './_common'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

let prisma: PrismaClient<'query'>
declare const newPrismaClient: NewPrismaClient<typeof prisma, typeof PrismaClient>

testMatrix.setupTestSuite(
  (suiteConfig, _suiteMeta, _clientMeta, cliMeta) => {
    const relationJoinsEnabled = cliMeta.previewFeatures.includes('relationJoins')

    // We can't use `Object.keys(Prisma.RelationLoadStrategy).includes(suiteConfig.strategy)` here to let
    // the DMMF tell us because the `Prisma` object is not injected at this point yet.
    const strategySupportedForProvider = match(suiteConfig.strategy)
      .with('join', () => providersSupportingRelationJoins.includes(suiteConfig.provider))
      .with('query', () => true)
      .exhaustive()

    describeIf(relationJoinsEnabled && strategySupportedForProvider)(
      'relationLoadStrategy in supported queries',
      () => {
        const relationLoadStrategy = suiteConfig.strategy as PrismaNamespace.RelationLoadStrategy

        const postId = faker.database.mongodbObjectId()

        const logs: PrismaNamespace.QueryEvent[] = []

        async function expectQueryCountAtLeast(count: Record<RelationLoadStrategy, number>) {
          await waitFor(() => {
            let expected = count[suiteConfig.strategy]
            if (suiteConfig.driverAdapter !== undefined) {
              // Driver adapters do not issue BEGIN through the query engine.
              expected -= 1
            }
            expect(logs.length).toBeGreaterThanOrEqual(expected)
          })
        }

        const lateralJoinQueryMatcher = expect.stringMatching('LEFT JOIN LATERAL')

        const relationJoinQueryMatcher = match(suiteConfig.provider)
          .with(Providers.MYSQL, () => {
            // For MySQL, JSON_OBJECT is the only available indicator. We use correlated subqueries
            // rather than lateral joins, and 1:1 queries don't even have JSON aggregations or the
            // `__prisma_data__` column.
            return expect.stringMatching('JSON_OBJECT')
          })
          .otherwise(() => lateralJoinQueryMatcher)

        const relationJoinLogsMatcher = expect.arrayContaining([
          expect.objectContaining({ query: relationJoinQueryMatcher }),
        ])

        function expectRelationJoinToBeUsed() {
          expect(logs).toEqual(relationJoinLogsMatcher)
        }

        function expectRelationJoinNotToBeUsed() {
          expect(logs).not.toEqual(relationJoinLogsMatcher)
        }

        function expectRelationJoinToBeUsedIfRequested() {
          if (suiteConfig.strategy === 'join') {
            expectRelationJoinToBeUsed()
          } else {
            expectRelationJoinNotToBeUsed()
          }
        }

        beforeAll(async () => {
          prisma = newPrismaClient({
            log: [
              {
                emit: 'event',
                level: 'query',
              },
            ],
          })

          prisma.$on('query', (event) => {
            logs.push(event)
          })

          await prisma.$connect()
        })

        beforeEach(async () => {
          await prisma.comment.deleteMany()
          await prisma.post.deleteMany()
          await prisma.user.deleteMany()

          await prisma.user.create({
            data: {
              login: 'author',
              posts: {
                create: {
                  id: postId,
                  title: 'first post',
                  content: 'insightful content',
                },
              },
            },
          })

          await prisma.user.create({
            data: {
              login: 'commenter',
              comments: {
                create: {
                  post: {
                    connect: { id: postId },
                  },
                  body: 'a comment',
                },
              },
            },
          })

          logs.length = 0
        })

        test('findMany', async () => {
          const users = await prisma.user.findMany({
            relationLoadStrategy,
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      author: {
                        select: { login: true },
                      },
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(users).toMatchObject([
            {
              login: 'author',
              posts: [
                {
                  comments: [
                    {
                      author: {
                        login: 'commenter',
                      },
                      body: 'a comment',
                    },
                  ],
                  title: 'first post',
                },
              ],
            },
            {
              login: 'commenter',
              posts: [],
            },
          ])

          await expectQueryCountAtLeast({
            join: 1,
            query: 4,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('findFirst', async () => {
          const user = await prisma.user.findFirst({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      author: {
                        select: {
                          login: true,
                        },
                      },
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'author',
            posts: [
              {
                comments: [
                  {
                    author: {
                      login: 'commenter',
                    },
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 1,
            query: 4,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('findFirstOrThrow', async () => {
          const user = await prisma.user.findFirstOrThrow({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      author: {
                        select: {
                          login: true,
                        },
                      },
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'author',
            posts: [
              {
                comments: [
                  {
                    author: {
                      login: 'commenter',
                    },
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 1,
            query: 4,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('findUnique', async () => {
          const user = await prisma.user.findUnique({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      author: {
                        select: {
                          login: true,
                        },
                      },
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'author',
            posts: [
              {
                comments: [
                  {
                    author: {
                      login: 'commenter',
                    },
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 1,
            query: 4,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('findUniqueOrThrow', async () => {
          const user = await prisma.user.findUniqueOrThrow({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      author: {
                        select: {
                          login: true,
                        },
                      },
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'author',
            posts: [
              {
                comments: [
                  {
                    author: {
                      login: 'commenter',
                    },
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 1,
            query: 4,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('create', async () => {
          const user = await prisma.user.create({
            relationLoadStrategy,
            data: {
              login: 'reader',
              comments: {
                create: {
                  post: {
                    connect: { id: postId },
                  },
                  body: 'most insightful indeed!',
                },
              },
            },
            select: {
              login: true,
              comments: {
                select: {
                  post: {
                    select: {
                      title: true,
                    },
                  },
                  body: true,
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'reader',
            comments: [
              {
                body: 'most insightful indeed!',
                post: {
                  title: 'first post',
                },
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 6,
            query: suiteConfig.provider === Providers.MONGODB ? 6 : 8,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('update', async () => {
          const user = await prisma.user.update({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            data: {
              login: 'distinguished author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'distinguished author',
            posts: [
              {
                comments: [
                  {
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 4,
            query: 6,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('delete', async () => {
          const user = await prisma.user.delete({
            relationLoadStrategy,
            where: {
              login: 'author',
            },
            select: {
              login: true,
              posts: {
                select: {
                  title: true,
                  comments: {
                    select: {
                      body: true,
                    },
                  },
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'author',
            posts: [
              {
                comments: [
                  {
                    body: 'a comment',
                  },
                ],
                title: 'first post',
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 4,
            query: 6,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('upsert', async () => {
          const user = await prisma.user.upsert({
            relationLoadStrategy,
            where: {
              login: 'commenter',
            },
            create: {
              login: 'commenter',
            },
            update: {
              login: 'ardent commenter',
            },
            select: {
              login: true,
              comments: {
                select: {
                  post: {
                    select: {
                      title: true,
                    },
                  },
                  body: true,
                },
              },
            },
          })

          expect(user).toMatchObject({
            login: 'ardent commenter',
            comments: [
              {
                body: 'a comment',
                post: {
                  title: 'first post',
                },
              },
            ],
          })

          await expectQueryCountAtLeast({
            join: 5,
            query: suiteConfig.provider === Providers.MONGODB ? 6 : 7,
          })

          expectRelationJoinToBeUsedIfRequested()
        })

        test('create with no relation selection', async () => {
          const user = await prisma.user.create({
            // Doesn't influence the generated queries in this case as we only select scalars.
            relationLoadStrategy,
            data: {
              login: 'reader',
              comments: {
                create: {
                  post: {
                    connect: { id: postId },
                  },
                  body: 'most insightful indeed!',
                },
              },
            },
            select: {
              login: true,
            },
          })

          expect(user).toEqual({ login: 'reader' })

          // Query count is equal in this test since no relations are loaded.
          await expectQueryCountAtLeast({
            join: 6,
            query: suiteConfig.provider === Providers.MONGODB ? 4 : 6,
          })

          expectRelationJoinNotToBeUsed()
        })
      },
    )
  },
  {
    optOut: {
      from: providersNotSupportingRelationJoins,
      reason: "Doesn't support relation joins",
    },
  },
)
