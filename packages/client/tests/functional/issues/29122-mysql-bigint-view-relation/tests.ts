import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('correctly handles an integer key returned from a view relation in MySQL', async () => {
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE VIEW user_post_summary AS
        SELECT users.id AS user_id,
            (
                SELECT posts.id
                FROM posts
                WHERE posts.user_id = users.id
                ORDER BY posts.id DESC
                LIMIT 1
            ) AS last_post_id
            FROM users
      `)

      await prisma.users.create({
        data: {
          id: 1,
          posts: {
            create: [
              {
                id: 1,
              },
            ],
          },
        },
      })

      const result = await prisma.user_post_summary.findMany({
        include: {
          last_post: true,
        },
      })

      expect(result).toMatchInlineSnapshot(`
      [
        {
          "last_post": {
            "id": 1,
            "user_id": 1,
          },
          "last_post_id": 1,
          "user_id": 1,
        },
      ]
    `)
    })
  },
  {
    optOut: {
      from: ['postgresql', 'sqlite', 'cockroachdb', 'sqlserver', 'mongodb'],
      reason: 'This test is only relevant for MySQL, as it tests a MySQL specific regression.',
    },
  },
)
