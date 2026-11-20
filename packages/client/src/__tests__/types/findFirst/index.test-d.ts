import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.findFirst({
      prop: true,
    }),
  )

  expectError(
    await prisma.user.findFirst({
      include: {
        posts: true,
      },
      select: {
        id: true,
      },
    }),
  )
})()
