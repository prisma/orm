import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: './prisma/dev.db',
  })
  const prisma = new PrismaClient({ adapter })

  const users = await prisma.user.findMany({})

  console.log(users)
}

void main()
