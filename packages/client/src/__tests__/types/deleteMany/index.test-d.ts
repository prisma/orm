import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.post.deleteMany({
      where: {
        AND: {
          AND: {
            title: false,
          },
        },
      },
    }),
  )
})()
