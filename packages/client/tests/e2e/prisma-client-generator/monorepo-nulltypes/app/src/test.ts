import assert from 'node:assert/strict'

import { PrismaLibSql } from '@prisma/adapter-libsql'

import { Prisma, PrismaClient } from './generated/prisma/client'

async function main() {
  const adapter = new PrismaLibSql({
    url: 'file:./prisma/dev.db',
  })
  const prisma = new PrismaClient({ adapter })

  await prisma.quote.deleteMany()

  await prisma.quote.createMany({
    data: [
      {
        content: { foo: 'bar' },
      },
      {
        content: Prisma.JsonNull,
      },
      {
        content: Prisma.DbNull,
      },
    ],
  })

  assert.equal(await prisma.quote.count(), 3)
  assert.deepEqual(await prisma.quote.findMany(), [
    {
      id: 1,
      content: { foo: 'bar' },
    },
    {
      id: 2,
      content: null,
    },
    {
      id: 3,
      content: null,
    },
  ])
}

void main()
