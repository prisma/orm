import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.user.findMany({
      where: {
        OR: [
          {
            asd: true,
          },
        ],
      },
    }),
  )
})()
