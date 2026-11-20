import { PrismaClient } from '@prisma/client'

// This file will not be executed, just compiled to check if the typings are valid
async function main() {
  const prisma = new PrismaClient()

  await prisma.user.findMany({
    distinct: ['id', 'email', 'age', 'followerCount', 'name'],
  })

  await prisma.user.findMany({
    distinct: 'id',
  })

  await prisma.user.findMany({
    distinct: 'email',
  })
}

main().catch((e) => {
  console.error(e)
})
