import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({
  connectionString: process.env['TEST_E2E_POSTGRES_URI']!,
})
const prisma = new PrismaClient({ adapter })

test('should not create a Foo record because the database trigger always throws an exception', async () => {
  await expect(
    prisma.$transaction(async (transactionClient: PrismaClient) => {
      await transactionClient.foo.create({})
    }),
  ).rejects.toThrow('Foo cannot be created!')
})
