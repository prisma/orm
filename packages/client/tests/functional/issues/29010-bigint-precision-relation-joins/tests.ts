import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

// BigInt IDs that exceed Number.MAX_SAFE_INTEGER (2^53 - 1 = 9007199254740991)
const USER_ID = BigInt('312590077454712834')
const POST_ID = BigInt('412590077454712834')

testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      await prisma.post.deleteMany()
      await prisma.user.deleteMany()

      await prisma.user.create({
        data: {
          id: USER_ID,
          name: 'Alice',
          posts: {
            create: {
              id: POST_ID,
              title: 'Hello World',
            },
          },
        },
      })
    })

    test('preserves BigInt precision in relationJoins queries', async () => {
      const user = await prisma.user.findUnique({
        where: { id: USER_ID },
        relationLoadStrategy: 'join',
        include: { posts: true },
      })

      expect(user).not.toBeNull()
      expect(user!.id).toBe(USER_ID)
      expect(user!.posts).toHaveLength(1)
      expect(user!.posts[0].id).toBe(POST_ID)
      expect(user!.posts[0].authorId).toBe(USER_ID)
    })

    test('preserves BigInt precision in nested relationJoins queries', async () => {
      const post = await prisma.post.findUnique({
        where: { id: POST_ID },
        relationLoadStrategy: 'join',
        include: {
          author: {
            include: { posts: true },
          },
        },
      })

      expect(post).not.toBeNull()
      expect(post!.id).toBe(POST_ID)
      expect(post!.authorId).toBe(USER_ID)
      expect(post!.author.id).toBe(USER_ID)
      expect(post!.author.posts).toHaveLength(1)
      expect(post!.author.posts[0].id).toBe(POST_ID)
    })
  },
  {
    optOut: {
      from: ['mongodb', 'sqlite', 'sqlserver'],
      reason: 'relationJoins not supported',
    },
  },
)
