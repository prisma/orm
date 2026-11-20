import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    const chatId = 'chat-id'
    const userIds = ['bob', 'eve', 'alice', 'david', 'charlie']

    beforeEach(async () => {
      await prisma.chatUser.deleteMany()
      await prisma.chat.deleteMany()
      await prisma.user.deleteMany()

      await prisma.user.createMany({
        data: userIds.map((id) => ({ id })),
      })

      await prisma.chat.create({
        data: {
          id: chatId,
          chatUsers: {
            create: [{ userId: 'bob' }, { userId: 'eve' }],
          },
        },
      })
    })

    test('all missing records reject in concurrent findUniqueOrThrow batches', async () => {
      const results = await Promise.allSettled(
        userIds.map((userId) =>
          prisma.chat.findUniqueOrThrow({
            where: {
              id: chatId,
              chatUsers: { some: { userId } },
            },
          }),
        ),
      )

      expect(results).not.toContainEqual({ status: 'fulfilled', value: undefined })
      expect(results).toMatchObject([
        { status: 'fulfilled', value: { id: chatId } },
        { status: 'fulfilled', value: { id: chatId } },
        { status: 'rejected', reason: expect.objectContaining({ code: 'P2025' }) },
        { status: 'rejected', reason: expect.objectContaining({ code: 'P2025' }) },
        { status: 'rejected', reason: expect.objectContaining({ code: 'P2025' }) },
      ])
    })
  },
  {
    optOut: {
      from: ['mongodb'],
      reason: 'MongoDB does not support compound primary keys (@@id)',
    },
  },
)
