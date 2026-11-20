import { PrismaPg } from '@prisma/adapter-pg'
import { expectTypeOf } from 'expect-type'

import { PrismaClient } from './generated/prisma/client'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.TEST_E2E_POSTGRES_URI! })
  const prisma = new PrismaClient({
    adapter,
  })

  const user = await prisma.user.findFirst({
    select: {
      id: true,
    },
  })

  expectTypeOf(user).toEqualTypeOf<{ id: number } | null>()
}

void main()
