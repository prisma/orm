import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:prisma/dev.db' }) })

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
