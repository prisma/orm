const { PrismaPg } = require('@prisma/adapter-pg')
const { PrismaClient } = require('@prisma/client')

export async function generateStaticParams() {
  return [{ id: '1' }]
}

async function doPrismaQuery(params) {
  if (params.id === '1') return JSON.stringify({})

  const adapter = new PrismaPg({
    connectionString: process.env['TEST_E2E_POSTGRES_URI'],
  })
  const prisma = new PrismaClient({ adapter })

  const result = await prisma.$queryRaw`SELECT 1`

  return JSON.stringify(result)
}

export default async function Page({ params }) {
  return <div>{await doPrismaQuery(params)}</div>
}
