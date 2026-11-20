import { expectTypeOf } from 'expect-type'

import { PrismaClient } from './generated/prisma/client'

async function main() {
  const prisma = new PrismaClient({})

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  })

  expectTypeOf(user).toEqualTypeOf<{ id: number } | null>()
}

void main()
