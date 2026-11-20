import { PrismaClient } from '@prisma/client'

// This file will not be executed, just compiled to check if the typings are valid
async function main() {
  const prisma = new PrismaClient()

  const c1 = await prisma.user.count({
    select: true,
  })
  const t1: number = c1

  const c2 = await prisma.user.count({
    select: {
      _all: true,
      age: true,
      email: true,
      followerCount: true,
      id: true,
      name: true,
    },
  })
  const t2: {
    _all: number | null
    age: number | null
    email: number | null
    followerCount: number | null
    id: number | null
    name: number | null
  } = c2
}

main().catch((e) => {
  console.error(e)
})
