import assert from 'node:assert/strict'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from './generated/compatibility-client/client'

const client = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: 'file:./compatibility.db' }),
})

async function main() {
  try {
    const createdNote = await client.note.create({ data: { value: 'generated through prisma7' } })

    const note = await client.note.findUniqueOrThrow({ where: { id: createdNote.id } })
    assert.equal(note.value, 'generated through prisma7')
  } finally {
    await client.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
