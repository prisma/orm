import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { getEmail } from '@prisma/client/sql'

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env['TEST_E2E_POSTGRES_URI'],
  })
  const prisma = new PrismaClient({ adapter })

  const { id } = await prisma.user.create({
    data: { email: 'john@doe.io' },
  })

  const userRaw = await prisma.$queryRawTyped(getEmail(id))

  console.log(userRaw)
}

void main()
