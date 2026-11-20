import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.count({
      select: 0,
    }),
  )

  expectError(
    await prisma.user.count({
      where: {
        name: { not: null },
      },
      select: {
        $all: true,
      },
    }),
  )

  // See https://github.com/prisma/prisma/issues/19598
  expectError(
    await prisma.user.count({
      distinct: ['name'],
    }),
  )
})()
