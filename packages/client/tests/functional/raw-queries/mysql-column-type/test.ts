import { Providers } from '../../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      // Prisma Schema does not support specifying column collation
      await prisma.$executeRaw`ALTER TABLE \`User\` MODIFY \`char_bin_collation\` CHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`
      await prisma.$executeRaw`ALTER TABLE \`User\` MODIFY \`varchar_bin_collation\` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`
      await prisma.$executeRaw`ALTER TABLE \`User\` MODIFY \`text_bin_collation\` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`
    })

    beforeEach(async () => {
      await prisma.user.deleteMany()
    })

    test('columns with _bin collation return strings, not Uint8Array', async () => {
      await prisma.user.create({
        data: {
          char_bin_collation: 'hello',
          varchar_bin_collation: 'hello',
          text_bin_collation: 'hello',
        },
      })

      const result =
        (await prisma.$queryRaw`SELECT \`char_bin_collation\`, \`varchar_bin_collation\`, \`text_bin_collation\` FROM \`User\``) as Array<
          Record<string, unknown>
        >

      expect(result).toHaveLength(1)
      expect(result[0].char_bin_collation).toBe('hello')
      expect(result[0].varchar_bin_collation).toBe('hello')
      expect(result[0].text_bin_collation).toBe('hello')
    })
  },
  {
    optOut: {
      from: [Providers.POSTGRESQL, Providers.SQLITE, Providers.MONGODB, Providers.COCKROACHDB, Providers.SQLSERVER],
      reason: 'This test is for MySQL-specific column type detection',
    },
  },
)
