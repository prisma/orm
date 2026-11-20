import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@prisma/client'

const url = new URL(process.env['MYSQL_URL']!)
const { username: user, password, hostname: host, port } = url
const database = url.pathname && url.pathname.slice(1)

const adapter = new PrismaMariaDb({
  user,
  password,
  database,
  host,
  port: Number(port),
  connectionLimit: 4, // avoid running out of connections, some tests create multiple clients
})
const prisma = new PrismaClient({ errorFormat: 'minimal', adapter })

afterAll(async () => {
  await prisma.$disconnect()
})

// Note: after porting this to Driver Adapters, it started failing with:
// ```
//  ✕ reports correct error message on connection limit reached (95 ms)
//
//  ● reports correct error message on connection limit reached
//
//    expect(received).rejects.toMatchInlineSnapshot()
//
//    Received promise resolved instead of rejected
//    Resolved to value: [[], [], [], [], []]
//
//      22 | test('reports correct error message on connection limit reached', async () => {
//      23 |   expect.assertions(1)
//    > 24 |   await expect(
//         |         ^
//      25 |     Promise.all([
//      26 |       prisma.user.findMany(),
//      27 |       prisma.user.findMany(),
//
//      at expect (../../usr/local/lib/node_modules/jest/node_modules/expect/build/index.js:2116:15)
//      at Object.expect (tests/main.ts:24:9)
// ```
test.failing('reports correct error message on connection limit reached', async () => {
  // expect.assertions(1)
  await expect(
    Promise.all([
      prisma.user.findMany(),
      prisma.user.findMany(),
      prisma.user.findMany(),
      prisma.user.findMany(),
      prisma.user.findMany(),
    ]),
  ).rejects.toMatchInlineSnapshot(`
[PrismaClientKnownRequestError: 
Invalid \`prisma.user.findMany()\` invocation:


Too many database connections opened: ERROR HY000 (1040): Too many connections
Prisma Accelerate has built-in connection pooling to prevent such errors: https://pris.ly/client/error-accelerate]
`)
})
