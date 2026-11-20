import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../generated/client'

export async function somePrismaCall(email: string) {
  const adapter = new PrismaPg({
    connectionString: process.env['TEST_E2E_POSTGRES_URI'],
  })
  const prisma = new PrismaClient({ adapter })

  const user = await prisma.user.create({
    data: { email },
  })

  return user
}
