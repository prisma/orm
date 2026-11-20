import { PrismaClient } from '@prisma/client'

// This file will not be executed, just compiled to check if the typings are valid
async function main() {
  const prisma = new PrismaClient()

  await prisma.user.aggregate({
    cursor: {
      email: 'a@a.de',
    },
    orderBy: {
      age: 'asc',
    },
    skip: 12,
    take: 10,
    where: {
      age: { gt: 500 },
    },
    _count: true,
    _avg: {
      age: true,
      followerCount: true,
    },
    _max: {
      age: true,
      email: true,
      followerCount: true,
    },
    _min: {
      age: true,
      email: true,
      followerCount: true,
    },
    _sum: {
      age: true,
      followerCount: true,
    },
  })
}

main().catch((e) => {
  console.error(e)
})
