import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.update({
      where: {},
      data: {
        posts: {
          connectOrCreate: {
            where: {
              id: '123',
            },
            create: {
              published: true,
            },
          },
        },
      },
    }),
  )
})()
