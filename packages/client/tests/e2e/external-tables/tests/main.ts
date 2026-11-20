import fs from 'node:fs/promises'
import path from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({
  connectionString: process.env['TEST_E2E_POSTGRES_URI']!,
})

describe('Prisma External Tables and Enums', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = new PrismaClient({ adapter })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Clean up data before each test
    await prisma.posts.deleteMany()
    await prisma.users.deleteMany()
  })

  test('can create and query data', async () => {
    await prisma.posts.create({
      data: { id: 1, title: 'Hello World' },
    })

    await prisma.users.create({
      data: { id: 1, username: 'John Doe', email: 'john.doe@example.com', role: 'customer' },
    })

    const posts = await prisma.posts.findMany()
    expect(posts.length).toBe(1)
    expect(posts[0].title).toBe('Hello World')

    const users = await prisma.users.findMany()
    expect(users.length).toBe(1)
    expect(users[0].username).toBe('John Doe')
  })

  test('created correct migration with relationship only', async () => {
    const migrations = await fs.readdir(path.join(__dirname, '..', 'prisma', 'migrations'))

    expect(migrations.length).toBe(3) // 1 initial migration + 1 migration adding relationship + 1 migration_lock.toml
    const createRelationshipMigration = await fs.readFile(
      path.join(__dirname, '..', 'prisma', 'migrations', migrations[1], 'migration.sql'),
      'utf-8',
    )
    expect(createRelationshipMigration).toMatchInlineSnapshot(`
"-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "author_id" INTEGER;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
"
`)
  })
})

export {}
