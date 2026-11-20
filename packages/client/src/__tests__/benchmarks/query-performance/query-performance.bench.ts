/**
 * End-to-end Query Performance Benchmarks
 *
 * Tests query performance using in-memory SQLite with better-sqlite3 adapter.
 * Covers various query patterns typical in web applications.
 */
import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Benchmark from 'benchmark'

import { generateInFolder } from '../../../utils/generateInFolder'
import type { PrismaClient } from './node_modules/.prisma/client'
import { SEED_CONFIGS, seedDatabase, type SeedResult } from './seed-data'

let prisma: PrismaClient
let seedResult: SeedResult

async function setup(): Promise<void> {
  if (prisma) return

  console.log('Setting up benchmark environment...')

  await generateInFolder({
    projectDir: __dirname,
  })

  const { PrismaClient } = await import('./node_modules/.prisma/client/index.js')

  prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: ':memory:' }),
  })

  await prisma.$connect()

  await createSchema()

  seedResult = await seedDatabase(prisma, SEED_CONFIGS.small)

  console.log('Setup complete. Stats:', seedResult.stats)
}

async function createSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS User (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      username TEXT NOT NULL UNIQUE,
      bio TEXT,
      avatar TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      firstName TEXT,
      lastName TEXT,
      dateOfBirth TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      country TEXT,
      zipCode TEXT,
      website TEXT,
      company TEXT,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Category (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      parentId INTEGER,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (parentId) REFERENCES Category(id)
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Post (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      excerpt TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      viewCount INTEGER NOT NULL DEFAULT 0,
      authorId INTEGER NOT NULL,
      categoryId INTEGER,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      publishedAt TEXT,
      FOREIGN KEY (authorId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (categoryId) REFERENCES Category(id)
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS PostTag (
      postId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (postId, tagId),
      FOREIGN KEY (postId) REFERENCES Post(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES Tag(id) ON DELETE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      authorId INTEGER NOT NULL,
      postId INTEGER NOT NULL,
      parentId INTEGER,
      isEdited INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (authorId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (postId) REFERENCES Post(id) ON DELETE CASCADE,
      FOREIGN KEY (parentId) REFERENCES Comment(id)
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (senderId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (receiverId) REFERENCES User(id) ON DELETE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Follow (
      followerId INTEGER NOT NULL,
      followingId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (followerId, followingId),
      FOREIGN KEY (followerId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (followingId) REFERENCES User(id) ON DELETE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Like" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      postId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      FOREIGN KEY (postId) REFERENCES Post(id) ON DELETE CASCADE,
      UNIQUE (userId, postId)
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      price REAL NOT NULL,
      comparePrice REAL,
      sku TEXT NOT NULL UNIQUE,
      stock INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      weight REAL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Order" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL NOT NULL DEFAULT 0,
      shipping REAL NOT NULL DEFAULT 0,
      notes TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS OrderItem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (orderId) REFERENCES "Order"(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES Product(id)
    )
  `)

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_user_created ON User(createdAt)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_user_role ON User(role)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_post_author ON Post(authorId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_post_category ON Post(categoryId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_post_published ON Post(published)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_post_created ON Post(createdAt)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_comment_post ON Comment(postId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_comment_author ON Comment(authorId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_message_sender ON Message(senderId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_message_receiver ON Message(receiverId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_order_user ON "Order"(userId)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_order_status ON "Order"(status)`)
}

async function cleanup(): Promise<void> {
  await prisma.$disconnect()
}

function deferredBench(fn: () => Promise<void>): Benchmark.Options {
  return {
    defer: true,
    fn: function (deferred: Benchmark.Deferred) {
      fn()
        .then(() => deferred.resolve())
        .catch((err) => {
          console.error('Benchmark error:', err)
          process.exit(1)
        })
    },
  }
}

async function runBenchmarks(): Promise<void> {
  if (process.env.CODSPEED_BENCHMARK) {
    // Disabled on CI for now.
    // We seem to be getting different SQLite addon instances in the setup code
    // and in benchmarks when running in CodSpeed, breaking the in-memory db.
    return
  }

  await setup()

  const suite = withCodSpeed(new Benchmark.Suite('query-performance'))

  // ============================================
  // Simple Read Operations
  // ============================================

  suite.add(
    'findUnique by id',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.user.findUnique({ where: { id: userId } })
    }),
  )

  suite.add(
    'findFirst with simple where',
    deferredBench(async () => {
      await prisma.user.findFirst({ where: { isActive: true } })
    }),
  )

  // ============================================
  // List Operations (varying sizes)
  // ============================================

  suite.add(
    'findMany 10 records',
    deferredBench(async () => {
      await prisma.user.findMany({ take: 10 })
    }),
  )

  suite.add(
    'findMany with orderBy',
    deferredBench(async () => {
      await prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      })
    }),
  )

  suite.add(
    'findMany with filter',
    deferredBench(async () => {
      await prisma.user.findMany({
        where: { isActive: true, role: 'user' },
        take: 10,
      })
    }),
  )

  suite.add(
    'findMany with pagination',
    deferredBench(async () => {
      await prisma.user.findMany({
        skip: 2,
        take: 5,
        orderBy: { id: 'asc' },
      })
    }),
  )

  // ============================================
  // Relation Loading
  // ============================================

  suite.add(
    'findUnique with 1:1 include',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      })
    }),
  )

  suite.add(
    'findUnique with 1:N include',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.user.findUnique({
        where: { id: userId },
        include: { posts: true },
      })
    }),
  )

  suite.add(
    'findUnique with nested includes',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          posts: {
            include: {
              comments: true,
            },
          },
        },
      })
    }),
  )

  suite.add(
    'findMany with includes',
    deferredBench(async () => {
      await prisma.user.findMany({
        take: 5,
        include: {
          profile: true,
          posts: {
            take: 3,
          },
        },
      })
    }),
  )

  // ============================================
  // Select Operations
  // ============================================

  suite.add(
    'findMany with select',
    deferredBench(async () => {
      await prisma.user.findMany({
        take: 10,
        select: {
          id: true,
          email: true,
          name: true,
        },
      })
    }),
  )

  suite.add(
    'findMany with nested select',
    deferredBench(async () => {
      await prisma.post.findMany({
        take: 5,
        select: {
          id: true,
          title: true,
          author: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      })
    }),
  )

  // ============================================
  // Complex Filters
  // ============================================

  suite.add(
    'findMany with OR filter',
    deferredBench(async () => {
      await prisma.user.findMany({
        where: {
          OR: [{ role: 'admin' }, { role: 'moderator' }],
        },
        take: 10,
      })
    }),
  )

  suite.add(
    'findMany with complex filters',
    deferredBench(async () => {
      await prisma.post.findMany({
        where: {
          published: true,
          OR: [{ featured: true }, { viewCount: { gt: 100 } }],
        },
        take: 10,
      })
    }),
  )

  suite.add(
    'findMany with contains filter',
    deferredBench(async () => {
      await prisma.post.findMany({
        where: {
          title: { contains: 'lorem' },
        },
        take: 10,
      })
    }),
  )

  // ============================================
  // Aggregations
  // ============================================

  suite.add(
    'count all',
    deferredBench(async () => {
      await prisma.user.count()
    }),
  )

  suite.add(
    'count with filter',
    deferredBench(async () => {
      await prisma.post.count({
        where: { published: true },
      })
    }),
  )

  suite.add(
    'aggregate sum/avg',
    deferredBench(async () => {
      await prisma.product.aggregate({
        _sum: { price: true },
        _avg: { price: true },
        _min: { price: true },
        _max: { price: true },
      })
    }),
  )

  suite.add(
    'groupBy with count',
    deferredBench(async () => {
      await prisma.user.groupBy({
        by: ['role'],
        _count: { id: true },
      })
    }),
  )

  // ============================================
  // Write Operations
  // ============================================

  let createCounter = 0
  suite.add(
    'create single record',
    deferredBench(async () => {
      createCounter++
      await prisma.user.create({
        data: {
          email: `bench-create-${createCounter}-${Date.now()}@example.com`,
          username: `benchcreate${createCounter}${Date.now()}`,
          name: 'Benchmark User',
        },
      })
    }),
  )

  let nestedCreateCounter = 0
  suite.add(
    'create with nested',
    deferredBench(async () => {
      nestedCreateCounter++
      await prisma.user.create({
        data: {
          email: `bench-nested-${nestedCreateCounter}-${Date.now()}@example.com`,
          username: `benchnested${nestedCreateCounter}${Date.now()}`,
          name: 'Benchmark User',
          profile: {
            create: {
              firstName: 'Bench',
              lastName: 'Mark',
            },
          },
        },
      })
    }),
  )

  suite.add(
    'update single record',
    deferredBench(async () => {
      const userId = seedResult.userIds[Math.floor(Math.random() * seedResult.userIds.length)]
      await prisma.user.update({
        where: { id: userId },
        data: { name: `Updated ${Date.now()}` },
      })
    }),
  )

  suite.add(
    'updateMany',
    deferredBench(async () => {
      await prisma.post.updateMany({
        where: { published: false },
        data: { viewCount: { increment: 1 } },
      })
    }),
  )

  // ============================================
  // Transactions
  // ============================================

  suite.add(
    'transaction sequential',
    deferredBench(async () => {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirstOrThrow()
        await tx.user.update({
          where: { id: user.id },
          data: { name: `Tx Update ${Date.now()}` },
        })
      })
    }),
  )

  suite.add(
    'transaction batch',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.$transaction([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.post.findMany({ where: { authorId: userId }, take: 3 }),
        prisma.comment.count({ where: { authorId: userId } }),
      ])
    }),
  )

  // ============================================
  // Realistic Query Patterns
  // ============================================

  suite.add(
    'blog post page query',
    deferredBench(async () => {
      const postId = seedResult.postIds[0]
      await prisma.post.findUnique({
        where: { id: postId },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          category: true,
          tags: {
            include: { tag: true },
          },
          comments: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
          _count: {
            select: { likes: true, comments: true },
          },
        },
      })
    }),
  )

  suite.add(
    'blog listing page query',
    deferredBench(async () => {
      await prisma.post.findMany({
        where: { published: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: {
              name: true,
              avatar: true,
            },
          },
          category: {
            select: { name: true, slug: true },
          },
          _count: {
            select: { comments: true, likes: true },
          },
        },
      })
    }),
  )

  suite.add(
    'user profile page query',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          posts: {
            take: 3,
            where: { published: true },
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              posts: true,
              followers: true,
              following: true,
            },
          },
        },
      })
    }),
  )

  suite.add(
    'order history query',
    deferredBench(async () => {
      const userId = seedResult.userIds[0]
      await prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          items: {
            include: {
              product: {
                select: {
                  name: true,
                  slug: true,
                  price: true,
                },
              },
            },
          },
        },
      })
    }),
  )

  suite.add(
    'product search query',
    deferredBench(async () => {
      await prisma.product.findMany({
        where: {
          isActive: true,
          price: { gte: 10, lte: 100 },
          stock: { gt: 0 },
        },
        orderBy: { price: 'asc' },
        take: 10,
      })
    }),
  )

  await new Promise<void>((resolve) => {
    void suite
      .on('cycle', (event: Benchmark.Event) => {
        console.log(String(event.target))
      })
      .on('complete', () => {
        resolve()
      })
      .on('error', (event: Benchmark.Event) => {
        console.error('Benchmark error:', event.target)
      })
      .run({ async: true })
  })

  await cleanup()
}

void runBenchmarks()
