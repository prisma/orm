import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'
import { expectTypeOf } from 'expect-type'

async function main() {
  const prisma = new PrismaClient({
    accelerateUrl: 'prisma+postgresql://accelerate.example.com',
  }).$extends(withAccelerate())

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  })

  expectTypeOf(user).toEqualTypeOf<{ id: number } | null>()

  await prisma.user.findFirst({
    select: {
      // @ts-expect-error
      wrong: true,
    },
  })
}

void main()
