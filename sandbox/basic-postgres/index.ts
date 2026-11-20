import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
import 'dotenv/config'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_POSTGRES_URI }) })

  const email = `user.${Date.now()}@prisma.io`
  await prisma.user.create({
    data: {
      email,
    },
  })

  const users = await prisma.user.findMany()

  console.log(users)
}

void main().catch((e) => {
  console.log(e.message)
  process.exit(1)
})
