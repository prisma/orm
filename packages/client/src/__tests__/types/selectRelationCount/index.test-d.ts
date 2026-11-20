import { expectError, expectType } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.findMany({
      include: {
        _count: {
          select: {
            asd: true,
          },
        },
      },
    }),
  )

  {
    const users = await prisma.user.findMany()
    expectError(users[0]._count.posts)
  }

  {
    const users = await prisma.user.findMany({
      include: {
        _count: false,
      },
    })
    expectError(users[0]._count.posts)
  }

  {
    const users = await prisma.user.findMany({
      include: {
        _count: true,
      },
    })
    expectType<number>(users[0]._count.posts)
  }
})()
