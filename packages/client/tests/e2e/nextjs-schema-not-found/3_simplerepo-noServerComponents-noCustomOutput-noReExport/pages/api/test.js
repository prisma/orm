const { PrismaPg } = require('@prisma/adapter-pg')
const { PrismaClient } = require('@prisma/client')

async function doPrismaQuery() {
  const adapter = new PrismaPg({
    connectionString: process.env['TEST_E2E_POSTGRES_URI'],
  })
  const prisma = new PrismaClient({ adapter })

  await prisma.user.deleteMany()
  const user = await prisma.user.create({
    data: {
      email: 'test',
    },
  })

  return user
}

export default async function handle(req, res) {
  res.json({ user: await doPrismaQuery() })
}
