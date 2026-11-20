import { expectError } from 'tsd'

import { PrismaClient } from '.'

const prisma = new PrismaClient()

;(async () => {
  expectError(
    await prisma.userTest.findUnique({
      where: {
        id: 'Example',
      },
      select: {
        id: true,
        globalConfiguration: {
          select: {
            accounts: {
              select: {
                config: {
                  select: {
                    list: true,
                    data: false,
                    asd: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  )
})()
