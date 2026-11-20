import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './generated/prisma/client.js'

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: './dev.db',
  })
  const prisma = new PrismaClient({ adapter })

  const user = await prisma.user.create({
    data: { email: 'john@doe.io' },
  })

  assert.strictEqual(user.email, 'john@doe.io')
}

void main()
