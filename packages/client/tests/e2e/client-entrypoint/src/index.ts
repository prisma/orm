import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './generated/prisma/client'

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: './dev.db',
  })
  const prisma = new PrismaClient({ adapter })

  await prisma.user.create({
    data: { email: 'john@doe.io' },
  })

  assert.equal((await prisma.user.findMany()).length, 1)
}

void main()
