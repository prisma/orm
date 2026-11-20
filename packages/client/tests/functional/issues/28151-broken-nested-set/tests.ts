import { faker } from '@snaplet/copycat'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(() => {
  test('nested set should result in all expected linked rows', async () => {
    const post1Id = faker.database.mongodbObjectId()
    const post2Id = faker.database.mongodbObjectId()
    const post3Id = faker.database.mongodbObjectId()

    const user = await prisma.user.create({
      data: {
        posts: {
          create: [{ id: post1Id }, { id: post2Id }],
        },
      },
    })

    await prisma.post.create({
      data: { id: post3Id },
    })

    await prisma.user.update({
      where: { id: user.id },
      data: {
        posts: {
          set: [{ id: post1Id }, { id: post2Id }, { id: post3Id }],
        },
      },
    })

    const userWithPosts = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        posts: true,
      },
    })

    expect(userWithPosts?.posts).toPartiallyContain({ id: post1Id })
    expect(userWithPosts?.posts).toPartiallyContain({ id: post2Id })
    expect(userWithPosts?.posts).toPartiallyContain({ id: post3Id })
  })
})
