import assert from 'node:assert/strict'

import { PrismaLibSql } from '@prisma/adapter-libsql'

import { PrismaClient } from './generated/prisma/client'

const adapter = new PrismaLibSql({
  url: 'file:./prisma/dev.db',
})
const prisma = new PrismaClient({ adapter })

await prisma.user.deleteMany()

const user = await prisma.user.create({
  data: { email: 'john@doe.io' },
})

console.log(user)

assert.equal(await prisma.user.count(), 1)
